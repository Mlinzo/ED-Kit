from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app import db, mining, spansh, views
from app.mining import MiningFinder
from app.projector import Projector
from app.shop import Item, ShopFinder
from tests.test_projector import CMDR, feed, jump
from tests.test_shop import raw

TYPE9 = {"timestamp": "2026-10-15T20:01:00Z", "event": "Loadout", "Ship": "Type9"}
PERMIT_SYSTEM = 777


def bid(name: str, demand: int, price: int) -> dict[str, Any]:
    """A market row of a station buying `name`, as Spansh sends it."""
    return {
        "commodity": name,
        "category": "Minerals",
        "buy_price": 0,
        "sell_price": price,
        "supply": 0,
        "demand": demand,
    }


def ring(name: str, kind: str, signals: dict[str, int]) -> dict[str, Any]:
    return {
        "name": name,
        "type": kind,
        "signals": [{"name": k, "count": v} for k, v in signals.items()],
        "signals_updated_at": "2026-10-26T16:22:27Z",
    }


def body(
    name: str, system: str, x: float, rings: list[dict[str, Any]], reserve: str = "Pristine"
) -> dict[str, Any]:
    return {
        "name": name,
        "system_name": system,
        "system_id64": abs(hash(system)) % 10**9,
        "system_x": x,
        "system_y": 0.0,
        "system_z": 0.0,
        "distance_to_arrival": 812.4,
        "reserve_level": reserve,
        "rings": rings,
    }


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "test.db")
    db.init_schema(c)
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    conn.execute("PRAGMA foreign_keys=OFF")
    return Projector(conn, position=lambda ts: (34.4, 30.3))


class FakeFinder(MiningFinder):
    """Spansh's stations and bodies given as they come, read as the searches read them."""

    def __init__(
        self, stations: list[dict[str, Any]], bodies: list[dict[str, Any]] | None = None
    ) -> None:
        self.asked: list[str] = []

        def buyers(item: Item, here: tuple[float, float, float], large: bool) -> list[Any]:
            self.asked.append(f"buyers {item.symbol} {'L' if large else '-'}")
            return [b for r in stations if (b := mining.bid(r, item)) is not None]

        def rings(item: Item, here: tuple[float, float, float]) -> list[dict[str, Any]]:
            self.asked.append(f"rings {item.symbol}")
            return bodies or []

        super().__init__(ShopFinder(None, permits=lambda: {PERMIT_SYSTEM}), buyers, rings)


def state(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return views.cmdr_state(conn, "F1")


def test_the_commodities_to_mine() -> None:
    offered = mining.commodities()
    assert len(offered) == 14
    by_symbol = {c.symbol: c for c in offered}
    assert by_symbol["lowtemperaturediamond"].name == "Low Temperature Diamonds"
    assert by_symbol["opal"].name == "Void Opal"
    assert by_symbol["painite"].hotspots and not by_symbol["osmium"].hotspots


def test_states_before_any_search(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR])
    assert mining.mining_view(conn, state(conn), FakeFinder([]), "painite").state == (
        "unknown_position"
    )
    feed(conn, proj, [jump()])
    assert mining.mining_view(conn, state(conn), None, "painite").state == "offline"
    assert mining.mining_view(conn, state(conn), FakeFinder([]), "nope").state == "unknown_item"
    # In the Shop's catalog, but nobody mines it.
    assert mining.mining_view(conn, state(conn), FakeFinder([]), "titanium").state == (
        "unknown_item"
    )
    nothing = FakeFinder([])
    view = mining.mining_view(conn, state(conn), nothing, None)
    assert view.state == "ready" and view.item is None and len(view.commodities) == 14
    assert nothing.asked == []


def test_where_to_sell_and_where_to_mine(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, TYPE9, jump()])  # at (1, 2, 3), a ship for large pads
    finder = FakeFinder(
        [
            raw("Floor", "Diso", 30, market=[bid("Painite", 50_000, 211_587)]),
            raw("Big Port", "Lave", 11, market=[bid("Painite", 1_666, 528_968)]),
            raw(
                "Small",
                "Leesti",
                5,
                kind="Outpost",
                pads=(4, 2, 0),
                market=[bid("Painite", 900, 300_000)],
            ),  # fmt: skip
            raw(
                "Locked",
                "Achenar",
                40,
                system_id=PERMIT_SYSTEM,
                market=[bid("Painite", 100, 250_000)],
            ),  # fmt: skip
            raw("Full", "Zaonce", 8, market=[bid("Painite", 0, 400_000)]),
            raw(
                "X5K-9TZ",
                "Caria",
                20,
                kind="Drake-Class Carrier",
                access="All",
                seen=datetime.now(UTC),
                market=[bid("Painite", 600, 715_960)],
            ),  # fmt: skip
        ],
        [
            body(
                "Diso 5",
                "Diso",
                31,
                [
                    ring("Diso 5 A Ring", "Metal Rich", {"Platinum": 1, "Painite": 2}),
                    ring("Diso 5 B Ring", "Icy", {"Tritium": 1}),
                ],
            ),  # fmt: skip
            body(
                "Lave 3", "Lave", 12, [ring("Lave 3 A Ring", "Metallic", {"Painite": 1})], "Major"
            ),
        ],
    )
    view = mining.mining_view(conn, state(conn), finder, "painite")
    assert view.state == "ready" and view.item == "painite" and view.name == "Painite"
    assert view.hotspots and view.pad == "L" and view.searched_at is not None
    assert finder.asked == ["buyers painite L", "rings painite"]

    # Where to sell: the best price first; no outpost for a Type-9, no market without demand,
    # the carrier only named (it pays more than every station).
    assert [b.station for b in view.buyers] == ["Big Port", "Locked", "Floor"]
    big, locked, _ = view.buyers
    assert (big.price, big.demand, big.system_name, big.pad) == (528_968, 1_666, "Lave", "L")
    assert big.distance_ly == pytest.approx(10.6, abs=0.05) and not big.permit and locked.permit
    assert view.better_carrier is not None
    assert (view.better_carrier.station, view.better_carrier.price) == ("X5K-9TZ", 715_960)

    # Where to mine: the nearest rings with its hotspots, each with its nearest buyer.
    assert [r.name for r in view.rings] == ["Lave 3 A Ring", "Diso 5 A Ring"]
    lave, diso = view.rings
    assert (diso.body, diso.type, diso.reserve, diso.count) == (
        "Diso 5",
        "Metal Rich",
        "Pristine",
        2,
    )
    assert [(o.name, o.count) for o in diso.others] == [("Platinum", 1)]
    assert (lave.reserve, lave.count, lave.others) == ("Major", 1, [])
    assert lave.sell is not None and diso.sell is not None
    assert (lave.sell.station, lave.sell.distance_ly) == ("Big Port", 1.0)
    assert (diso.sell.station, diso.sell.price) == ("Floor", 211_587)

    # The shortest trip: to the ring, then to its buyer.
    assert view.trip is not None
    assert view.trip.ring == "Lave 3 A Ring" and view.trip.sell.station == "Big Port"
    assert view.trip.total_ly == pytest.approx(lave.distance_ly + 1.0, abs=0.05)

    # Carriers asked for: listed with the stations, none named apart.
    with_carriers = mining.mining_view(conn, state(conn), finder, "painite", carriers=True)
    assert (
        with_carriers.buyers[0].station == "X5K-9TZ" and with_carriers.buyers[0].kind == "carrier"
    )
    assert with_carriers.better_carrier is None


def test_osmium_has_no_hotspots(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump()])
    finder = FakeFinder(
        [raw("Port", "Lave", 11, pads=(0, 0, 0), market=[bid("Osmium", 300, 40_000)])]
    )
    view = mining.mining_view(conn, state(conn), finder, "osmium")
    assert view.state == "ready" and not view.hotspots and view.rings == [] and view.trip is None
    assert [(b.station, b.pad) for b in view.buyers] == [("Port", None)]  # pads not reported
    assert finder.asked == ["buyers osmium -"]


def test_rings_with_no_buyer_near(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump()])
    finder = FakeFinder(
        [raw("Port", "Lave", 11, market=[bid("Platinum", 300, 200_000)])],  # buys something else
        [
            body("Far 1", "Far", 300, [ring("Far 1 A Ring", "Icy", {"Void Opal": 3})]),
            body("Lost 1", "Lost", 5, [ring("Lost 1 A Ring", "Icy", {"Void Opal": 1})])
            | {"system_x": None},  # no position: left out
        ],
    )
    view = mining.mining_view(conn, state(conn), finder, "opal")
    assert view.buyers == [] and view.trip is None
    [far] = view.rings
    assert (far.name, far.count, far.sell) == ("Far 1 A Ring", 3, None)


def test_failed_search(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump()])

    def fail(item: Item, here: tuple[float, float, float], large: bool) -> list[Any]:
        raise spansh.SpanshError("down")

    finder = MiningFinder(ShopFinder(None, permits=lambda: set()), fail, lambda item, here: [])
    assert mining.mining_view(conn, state(conn), finder, "painite").state == "failed"


def test_searches_ask_spansh_for_buyers_by_price_and_rings_with_hotspots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asked: list[tuple[str, dict[str, Any], Any]] = []

    def stations(
        filters: dict[str, Any], coords: Any, size: int, types: Any = None, sort: Any = None
    ) -> list[dict[str, Any]]:
        asked.append(("stations", filters, sort))
        return [raw("Port", "Lave", 11, market=[bid("Painite", 10, 300_000)])]

    def bodies(
        filters: dict[str, Any], coords: Any, size: int, fields: Any = None
    ) -> list[dict[str, Any]]:
        asked.append(("bodies", filters, fields))
        return []

    monkeypatch.setattr(spansh, "station_search", stations)
    monkeypatch.setattr(spansh, "body_search", bodies)
    painite = mining.find("painite")
    assert painite is not None
    found = mining.search_buyers(painite, (0, 0, 0), large=True)
    assert {(b["name"], b["price"], b["demand"]) for b in found} == {("Port", 300_000, 10)}
    station_asks = [a for a in asked if a[0] == "stations"]
    assert len(station_asks) == 2  # stations and carriers
    for _, filters, sort in station_asks:
        assert filters["market"] == [{"name": "Painite", "demand": mining.IN_DEMAND}]
        assert filters["has_large_pad"] == {"value": True}
        assert sort[0] == {"market_sell_price": [{"name": "Painite", "direction": "desc"}]}

    mining.search_rings(painite, (0, 0, 0))
    [(_, filters, fields)] = [a for a in asked if a[0] == "bodies"]
    assert filters == {"ring_signals": [{"name": "Painite", "value": [1, 99], "comparison": "<=>"}]}
    assert "rings" in fields and "reserve_level" in fields


def test_endpoint_lists_the_commodities_offline(tmp_path: Path) -> None:
    from tests.test_health import make_client

    with make_client(tmp_path) as client:
        view = client.get("/api/view/mining").json()
        assert view["state"] == "ready" and len(view["commodities"]) == 14
        assert view["reachLy"] == mining.REACH_LY
        assert view["commodities"][0] == {
            "symbol": "platinum",
            "name": "Platinum",
            "hotspots": True,
        }
        assert client.get("/api/view/mining?item=painite").json()["state"] == "offline"

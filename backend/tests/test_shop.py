from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app import db, shop, spansh, views
from app.projector import Projector
from app.shop import Item, ShopFinder, find, offer, pick
from tests.test_projector import CMDR, feed, jump

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
FSD_5A = "int_hyperdrive_size5_class5"
MC_GIMBAL = "hpt_multicannon_gimbal_medium"


def raw(
    name: str,
    system: str,
    x: float,
    *,
    kind: str = "Coriolis Starport",
    pads: tuple[int, int, int] = (4, 4, 2),
    ls: float = 100.0,
    modules: list[dict[str, Any]] | None = None,
    ships: list[dict[str, Any]] | None = None,
    seen: datetime = NOW,
    access: str | None = None,
    services: tuple[str, ...] = ("Shipyard", "Outfitting"),
    system_id: int | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "type": kind,
        "system_name": system,
        "system_id64": system_id or abs(hash(system)) % 10**9,
        "system_x": x,
        "system_y": 0.0,
        "system_z": 0.0,
        "distance_to_arrival": ls,
        "small_pads": pads[0],
        "medium_pads": pads[1],
        "large_pads": pads[2],
        "updated_at": seen.isoformat(),
        "carrier_docking_access": access,
        "shipyard_updated_at": "2026-10-01T10:00:00Z",
        "outfitting_updated_at": "2026-10-02T10:00:00Z",
        "services": [{"name": s} for s in services],
        "ships": ships or [],
        "modules": modules or [],
    }


def module(symbol: str, price: int = 1000) -> dict[str, Any]:
    return {"ed_symbol": symbol, "name": "x", "class": 5, "rating": "A", "price": price}


def test_catalog_items_and_labels() -> None:
    fsd, mc, ship = find(FSD_5A), find(MC_GIMBAL.upper()), find("anaconda")
    assert fsd is not None and fsd.label() == "Frame Shift Drive 5A"
    assert mc is not None and mc.label() == "Multi-Cannon 2F Gimballed" and mc.mount == "Gimballed"
    assert ship is not None and ship.kind == "ship" and ship.label() == "Anaconda"
    guardian = find("int_guardianfsdbooster_size5")
    assert guardian is not None and guardian.unlock == "techbroker"
    assert find("nonsense") is None
    catalog = shop.catalog_view()
    assert len(catalog.ships) > 40 and {m.category for m in catalog.modules} == {
        "core",
        "optional",
        "hardpoint",
        "utility",
    }


def test_offer_needs_the_exact_item() -> None:
    mc = find(MC_GIMBAL)
    assert mc is not None
    fixed = raw("A", "S", 1, modules=[module("Hpt_MultiCannon_Fixed_Medium")])
    assert offer(fixed, mc) is None  # Spansh ignores the mount: checked here
    gimbal = raw("B", "S", 1, modules=[module("Hpt_MultiCannon_Gimbal_Medium", 48450)])
    got = offer(gimbal, mc)
    assert got is not None and got["price"] == 48450
    assert got["offer_at"] == "2026-10-02T10:00:00Z" and "modules" not in got
    ship = Item("ship", "anaconda", "Anaconda")
    yard = raw("C", "S", 1, ships=[{"symbol": "Anaconda", "name": "Anaconda", "price": 9}])
    assert offer(yard, ship)["offer_at"] == "2026-10-01T10:00:00Z"  # type: ignore[index]


def test_shops_count_what_they_sell() -> None:
    both = shop.shop(raw("A", "S", 1, ships=[{"symbol": "x"}] * 3, modules=[module("y")] * 7))
    assert both is not None and (both["ship_count"], both["module_count"]) == (3, 7)
    outfitting = shop.shop(raw("B", "S", 1, services=("Outfitting",)))
    assert outfitting is not None and (outfitting["ship_count"], outfitting["module_count"]) == (
        None,
        0,
    )
    assert shop.shop(raw("C", "S", 1, services=("Refuel",))) is None


def test_pick_groups_systems_and_hides_carriers() -> None:
    offers = [
        raw("Far", "Two", 20),
        raw("Outpost", "One", 10, pads=(2, 2, 0), ls=50),  # no large pad
        raw("Port", "One", 10, ls=900),
        raw("Carrier", "Near", 3, kind="Drake-Class Carrier", access="All"),
        raw("Closed", "Nearer", 2, kind="Drake-Class Carrier", access="Friends"),
        raw("Stale", "Nearer", 2, kind="Drake-Class Carrier", seen=NOW - timedelta(days=40)),
    ]
    places, nearer = pick(offers, (0, 0, 0), "L", NOW)
    assert [(d, [o["name"] for o in shown]) for d, shown, _ in places] == [
        (10, ["Port"]),
        (20, ["Far"]),
    ]
    assert nearer is not None and nearer[1]["name"] == "Carrier"
    places, nearer = pick(offers, (0, 0, 0), "M", NOW, carriers=True)
    assert [shown[0]["name"] for _, shown, _ in places] == ["Carrier", "Outpost", "Far"]
    assert places[1][1][1]["name"] == "Port" and nearer is None


def test_pick_keeps_three_stations_a_system() -> None:
    offers = [raw(f"S{i}", "One", 5, ls=i) for i in range(5)]
    [(_, shown, more)] = pick(offers, (0, 0, 0), None, NOW)[0]
    assert [o["name"] for o in shown] == ["S0", "S1", "S2"] and more == 2


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "test.db")
    db.init_schema(c)
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    conn.execute("PRAGMA foreign_keys=OFF")
    return Projector(conn, position=lambda ts: (34.4, 30.3))


class FakeFinder(ShopFinder):
    """Spansh's stations given as they come (`raw`), filtered as `shop.search` does."""

    def __init__(self, stations: list[dict[str, Any]], permits: set[int] | None = None) -> None:
        self.asked: list[tuple[str | None, tuple[float, float, float]]] = []

        def find(item: Item | None, here: tuple[float, float, float]) -> list[dict[str, Any]]:
            self.asked.append((item.symbol if item else None, here))
            kept = (offer(r, item) if item else shop.shop(r) for r in stations)
            return [o for o in kept if o is not None]

        super().__init__(None, find, lambda: permits or set())


def test_shop_view(conn: sqlite3.Connection, proj: Projector) -> None:
    def state() -> sqlite3.Row | None:
        return views.cmdr_state(conn, "F1")

    feed(conn, proj, [CMDR])
    assert shop.shop_view(conn, state(), FakeFinder([]), FSD_5A).state == "unknown_position"
    feed(conn, proj, [jump()])
    assert shop.shop_view(conn, state(), None, FSD_5A).state == "offline"
    assert shop.shop_view(conn, state(), FakeFinder([]), "nope").state == "unknown_item"

    permit_system = 777
    finder = FakeFinder(
        [
            raw("Port", "Sol", 11, modules=[module("Int_Hyperdrive_Size5_Class5", 5_103_950)]),
            raw("Locked", "Achenar", 40, system_id=permit_system, modules=[module(FSD_5A)]),
            raw("Other", "Lave", 30, modules=[module("Int_Hyperdrive_Size4_Class5")]),
        ],
        permits={permit_system},
    )
    view = shop.shop_view(conn, state(), finder, FSD_5A)
    assert view.state == "ready" and view.item == "Frame Shift Drive 5A"
    assert [p.system_name for p in view.places] == ["Sol", "Achenar"]
    assert view.places[0].stations[0].price == 5_103_950
    assert [p.stations[0].permit for p in view.places] == [False, True]

    nearby = shop.shop_view(conn, state(), finder, None)
    assert nearby.item is None and len(nearby.places) == 3
    assert nearby.places[0].stations[0].module_count == 1


def test_rank_and_unlock(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump()])
    feed(
        conn,
        proj,
        [
            {"timestamp": "2026-10-15T20:01:00Z", "event": "Rank", "Empire": 6, "Federation": 4},
            {"timestamp": "2026-10-15T21:00:00Z", "event": "Promotion", "Empire": 7},
        ],
    )
    state = views.cmdr_state(conn, "F1")
    clipper = shop.shop_view(conn, state, FakeFinder([]), "empire_trader").rank
    assert clipper is not None and (clipper.need, clipper.have, clipper.ok) == (
        "Baron",
        "Baron",
        True,
    )
    corvette = shop.shop_view(conn, state, FakeFinder([]), "federation_corvette").rank
    assert corvette is not None and (corvette.have, corvette.ok) == ("Petty Officer", False)
    assert shop.shop_view(conn, state, FakeFinder([]), "anaconda").rank is None
    gauss = shop.shop_view(conn, state, FakeFinder([]), "hpt_guardian_gausscannon_fixed_small")
    assert gauss.unlock == "techbroker"


def test_failed_search(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump()])

    def fail(item: Item | None, here: tuple[float, float, float]) -> list[dict[str, Any]]:
        raise spansh.SpanshError("down")

    finder = ShopFinder(None, fail, lambda: set())
    assert shop.shop_view(conn, views.cmdr_state(conn, "F1"), finder, FSD_5A).state == "failed"


def test_finder_reuses_an_answer_nearby() -> None:
    finder = FakeFinder([])
    fsd = find(FSD_5A)
    finder.stations(fsd, (0, 0, 0))
    finder.stations(fsd, (15, 0, 0))  # within 20 ly: reused
    finder.stations(None, (15, 0, 0))  # the shops: an answer of their own
    finder.stations(fsd, (30, 0, 0))  # 30 ly away: asked again
    assert finder.asked == [(FSD_5A, (0, 0, 0)), (None, (15, 0, 0)), (FSD_5A, (30, 0, 0))]


def test_catalog_carries_prices_and_figures() -> None:
    catalog = shop.catalog_view()
    anaconda = next(s for s in catalog.ships if s.symbol == "anaconda")
    assert anaconda.stats is not None and anaconda.stats.pad == "L" and anaconda.stats.price
    assert len(anaconda.stats.core) == 7 and anaconda.stats.hardpoints[0] == 4
    corvette = next(s for s in catalog.ships if s.symbol == "federation_corvette")
    assert corvette.rank is not None and corvette.rank.need == "Rear Admiral"
    # A fighter hangar fits a few big ships only.
    bays = {s.symbol for s in catalog.ships if s.stats and s.stats.fighter_bay}
    assert {"anaconda", "explorer_nx", "federation_corvette", "type9"} <= bays
    assert not {"sidewinder", "asp", "mandalay"} & bays
    # A ship newer than FDevIDs stays in the catalog, marked: no station sells it yet.
    mk2 = next(s for s in catalog.ships if s.symbol == "anacondamkii")
    assert mk2.unsold and mk2.stats is not None and mk2.stats.pad == "L"
    assert not anaconda.unsold
    fsd = next(m for m in catalog.modules if m.name == "Frame Shift Drive")
    assert fsd.type == "cfsd"
    five_a = next(v for v in fsd.variants if v.symbol == FSD_5A)
    assert five_a.price and five_a.stats["fsdoptmass"] > 0 and five_a.stats["maxfuel"] > 0
    # The starter kit's copies are never sold: left out.
    assert not any(v.symbol.endswith("_free") for m in catalog.modules for v in m.variants)


def test_catalog_endpoint_is_gzipped(tmp_path: Path) -> None:
    from tests.test_health import make_client

    with make_client(tmp_path) as client:
        packed = client.get("/api/shop/catalog", headers={"Accept-Encoding": "gzip"})
        assert packed.headers["content-encoding"] == "gzip"
        assert packed.json()["ships"][0]["name"]  # the client unpacks it
        plain = client.get("/api/shop/catalog", headers={"Accept-Encoding": "identity"})
        assert "content-encoding" not in plain.headers and plain.json() == packed.json()

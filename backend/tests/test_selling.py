from __future__ import annotations

import json
import math
import sqlite3
import threading
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from app import db, selling, views
from app.navroute import PlottedRoute, PlottedSystem
from app.projector import Projector
from app.selling import Station, covers, fits, merge, pick
from app.ships import pad_size, ship_name
from tests.test_projector import CMDR, SA, feed, jump, scan_planet

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)


def station(
    name: str,
    system: str,
    x: float,
    *,
    kind: selling.Kind = "starport",
    uc: bool = True,
    vg: bool = True,
    pads: tuple[int, int, int] | None = (2, 4, 2),
    seen: datetime | None = None,
    market: int | None = None,
    ls: float = 100.0,
    access: selling.Access | None = None,
) -> Station:
    return Station(
        name=name,
        market_id=market,
        kind=kind,
        system_name=system,
        system_address=abs(hash(system)) % 10**9,
        position=(x, 0.0, 0.0),
        dist_ls=ls,
        cartographics=uc,
        genomics=vg,
        pads=pads,
        seen_at=seen,
        access=access if access or kind != "carrier" else "all",
    )


def carrier(name: str, system: str, x: float, days: float = 2, **kw: object) -> Station:
    return station(name, system, x, kind="carrier", seen=NOW - timedelta(days=days), **kw)  # type: ignore[arg-type]


def test_ships_and_pads() -> None:
    assert (ship_name("Mandalay"), pad_size("mandalay")) == ("Mandalay", "M")
    assert pad_size("cobramkv") == "S" and pad_size("anaconda") == "L"
    assert pad_size("something_new") is None and pad_size(None) is None


def test_fits() -> None:
    outpost = (4, 2, 0)
    settlement_small = (1, 0, 0)
    assert fits(outpost, "M") and not fits(outpost, "L")
    assert not fits(settlement_small, "M") and fits(settlement_small, "S")
    assert fits(None, "L") and fits((0, 0, 0), "L") and fits(settlement_small, None)


def test_access_of() -> None:
    assert selling.access_of("All") == "all"
    assert selling.access_of(None) == "unknown"
    for closed in ("Squadron", "Friends", "Squadron Friends", "None"):
        assert selling.access_of(closed) == "restricted"


def test_pick_nearest_systems_and_best_station() -> None:
    stations = [
        station("Far Port", "Far", 500.0),
        carrier("Carrier", "Near", 10.0),
        station("Near Port", "Near", 10.0, ls=3000.0),
        station("Uc Only", "Mid", 50.0, vg=False, ls=10.0),
        station("Vg Only", "Mid", 50.0, uc=False, ls=20.0),
        station("Uc Only 2", "Mid", 50.0, vg=False, ls=900.0),
    ]
    places, _ = pick(stations, (0.0, 0.0, 0.0), "M", NOW, carriers=True)
    assert [p[1][0].system_name for p in places] == ["Near", "Mid", "Far"]
    # Near: a real station beats a nearer carrier; the carrier counts as "more"
    assert [s.name for s in places[0][1]] == ["Near Port"] and places[0][2] == 1
    # Mid: none buys both, so the best of each kind
    assert [s.name for s in places[1][1]] == ["Uc Only", "Vg Only"] and places[1][2] == 1
    assert places[0][0] == pytest.approx(10.0)


def test_pick_drops_stale_and_closed_carriers_and_pads_too_small() -> None:
    stations = [
        carrier("Old Carrier", "A", 5.0, days=45),
        carrier("Squadron Only", "E", 2.0, access="restricted"),
        station("Small Pads", "B", 6.0, pads=(2, 0, 0)),
        carrier("Fresh Carrier", "C", 7.0, access="unknown"),
        station("Nothing To Buy", "D", 1.0, uc=False, vg=False),
    ]
    places, _ = pick(stations, (0.0, 0.0, 0.0), "M", NOW, carriers=True)
    assert [p[1][0].name for p in places] == ["Fresh Carrier"]


def test_carriers_hidden_by_default_with_a_hint() -> None:
    stations = [carrier("Near Carrier", "A", 300.0), station("Colonia Hub", "B", 2000.0)]
    places, nearer = pick(stations, (0.0, 0.0, 0.0), "M", NOW)
    assert [p[1][0].name for p in places] == ["Colonia Hub"]
    assert nearer is not None and nearer[1].name == "Near Carrier"
    assert nearer[0] == pytest.approx(300.0)
    # no hint when a station is nearer anyway
    _, nearer = pick([*stations, station("Bubble", "C", 100.0)], (0, 0, 0), "M", NOW)
    assert nearer is None
    # a carrier closed to the public is no hint either
    _, nearer = pick([carrier("Closed", "A", 1.0, access="restricted")], (0, 0, 0), "M", NOW)
    assert nearer is None


def test_stronghold_carriers_only_for_their_power() -> None:
    sc = replace(station("Stronghold Carrier", "Maia", 1.0), owner="Li Yong-Rui")
    stations = [sc, station("Port", "Far", 50.0)]
    for pledged, nearest in (
        (None, "Port"),
        ("Aisling Duval", "Port"),  # a rival's pledge: turned away and fired at
        ("Li Yong-Rui", "Stronghold Carrier"),
    ):
        places, _ = pick(stations, (0.0, 0.0, 0.0), "M", NOW, pledged=pledged)
        assert places[0][1][0].name == nearest
    assert not selling.may_dock("Stronghold Carrier", None, "Li Yong-Rui")  # owner unknown
    assert selling.may_dock("Port", "Some Faction", None)


def test_megaships_not_heard_of_for_a_year_are_gone() -> None:
    stations = [
        station("Rescue Ship", "Old", 1.0, kind="megaship", seen=NOW - timedelta(days=900)),
        station("The Penitent", "Live", 2.0, kind="megaship", seen=NOW - timedelta(days=180)),
        station("Port", "Far", 50.0),  # a station: its date does not matter
    ]
    places, _ = pick(stations, (0.0, 0.0, 0.0), "M", NOW)
    assert [p[1][0].name for p in places] == ["The Penitent", "Port"]


def test_pledged_power(conn: sqlite3.Connection, proj: Projector) -> None:
    def ev(event: str, **fields: str) -> dict:
        return {"timestamp": "2026-10-15T20:00:00Z", "event": event, **fields}

    assert selling.pledged_power(conn) is None
    feed(conn, proj, [ev("Powerplay", Power="Aisling Duval"), ev("LoadGame")])
    assert selling.pledged_power(conn) == "Aisling Duval"  # not every login repeats it
    feed(conn, proj, [ev("PowerplayDefect", FromPower="Aisling Duval", ToPower="Li Yong-Rui")])
    assert selling.pledged_power(conn) == "Li Yong-Rui"
    feed(conn, proj, [ev("PowerplayLeave", Power="Li Yong-Rui")])
    assert selling.pledged_power(conn) is None
    feed(conn, proj, [ev("PowerplayJoin", Power="Zemina Torval")])
    assert selling.pledged_power(conn) == "Zemina Torval"


def test_pick_keeps_the_nearest_of_each_kind() -> None:
    stations = [station(f"UC {i}", f"S{i}", float(i), vg=False) for i in range(1, 8)]
    stations.append(station("Genomics", "Far", 900.0, uc=False))
    places, _ = pick(stations, (0.0, 0.0, 0.0), None, NOW, limit=5)
    assert len(places) == 6 and places[-1][1][0].name == "Genomics"


def test_merge_marks_docked_and_joins_services() -> None:
    found = [
        station("Port", "A", 1.0, uc=True, vg=False, market=7),
        station("Port", "A", 1.0, uc=False, vg=True, market=7),
    ]
    yours = [
        Station(
            name="Port",
            market_id=7,
            kind="starport",
            system_name="A",
            system_address=1,
            position=(1.0, 0.0, 0.0),
            dist_ls=None,
            cartographics=True,
            genomics=True,
            pads=None,
            seen_at=None,
            docked=True,
        )
    ]
    (only,) = merge(found, yours)
    assert only.cartographics and only.genomics and only.docked and only.dist_ls == 100.0


def _row(fetched: datetime, origin: tuple[float, float, float], stations: list[dict], ok=1):
    return {
        "fetched_at": fetched.isoformat(),
        "x": origin[0],
        "y": origin[1],
        "z": origin[2],
        "ok": ok,
        "stations": json.dumps(stations),
    }


def raw_station(name: str, x: float, **extra: Any) -> dict[str, Any]:
    return {
        "name": name,
        "type": "Coriolis Starport",
        "market_id": abs(hash(name)) % 10**9,
        "system_id64": abs(hash(name + "sys")) % 10**9,
        "system_name": f"{name} System",
        "system_x": x,
        "system_y": 0.0,
        "system_z": 0.0,
        "distance_to_arrival": 120.0,
        "small_pads": 2,
        "medium_pads": 4,
        "large_pads": 2,
        "updated_at": "2026-10-18T10:00:00Z",
        "services": ["Universal Cartographics", "Vista Genomics"],
        **extra,
    }


def test_covers_reuses_a_search_nearby() -> None:
    now = datetime.now(UTC)
    deep = _row(now, (0.0, 0.0, 0.0), [raw_station("Far", 3000.0)])
    assert covers(deep, (250.0, 0.0, 0.0), now)  # a tenth of 3000 ly
    assert not covers(deep, (350.0, 0.0, 0.0), now)
    bubble = _row(now, (0.0, 0.0, 0.0), [raw_station("Near", 8.0)])
    assert covers(bubble, (15.0, 0.0, 0.0), now) and not covers(bubble, (25.0, 0.0, 0.0), now)
    assert not covers(_row(now - timedelta(hours=7), (0, 0, 0), []), (0.0, 0.0, 0.0), now)
    failed = _row(now - timedelta(minutes=5), (0, 0, 0), [], ok=0)
    assert covers(failed, (900.0, 0.0, 0.0), now)  # do not hammer Spansh after a failure
    assert covers(None, (0.0, 0.0, 0.0), now) is False


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "test.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    return Projector(conn, position=lambda ts: (0.0, 0.0))


def docked(ts: str, services: list[str], **extra: Any) -> dict[str, Any]:
    return {
        "timestamp": ts,
        "event": "Docked",
        "StationName": "Garay Terminal",
        "StationType": "Coriolis",
        "StarSystem": "Col 285 Sector TT-H c10-4",
        "SystemAddress": SA,
        "MarketID": 3229756160,
        "StationServices": services,
        "DistFromStarLS": 62.5,
        "LandingPads": {"Small": 4, "Medium": 8, "Large": 4},
        **extra,
    }


def test_docks_and_sale_station(conn: sqlite3.Connection, proj: Projector) -> None:
    loadout = {"timestamp": "2026-10-15T20:01:00Z", "event": "Loadout", "Ship": "Mandalay"}
    feed(conn, proj, [CMDR, loadout, jump(), scan_planet()])
    feed(
        conn,
        proj,
        [
            docked("2026-10-15T21:00:00Z", ["dock", "exploration", "vistagenomics"]),
            {
                "timestamp": "2026-10-15T21:01:00Z",
                "event": "SellOrganicData",
                "BioData": [],
            },
        ],
    )
    session = views.session_view(conn, "F1")
    assert session.last_docked_station == "Garay Terminal"
    assert session.last_docked_system == "Col 285 Sector TT-H c10-4"
    assert session.last_sale_station == "Garay Terminal"
    assert conn.execute("SELECT ship_type FROM cmdr_state").fetchone()[0] == "mandalay"

    # offline: the stations you docked at, checked against the pad
    sell = selling.sell_view(conn, "F1", views.cmdr_state(conn, "F1"), None)
    assert sell.state == "offline" and sell.ship == "Mandalay" and sell.pad == "M"
    assert [p.stations[0].name for p in sell.places] == ["Garay Terminal"]
    place = sell.places[0]
    assert place.distance_ly == 0 and place.stations[0].docked
    assert sell.here_carto_bodies == 1  # its own data sells only in another system


def test_growth_system_by_system(conn: sqlite3.Connection, proj: Projector) -> None:
    second = {**jump("2026-10-15T21:00:00Z"), "SystemAddress": SA + 1, "StarSystem": "Next"}
    second["StarPos"] = [10.0, 2.0, 3.0]
    feed(conn, proj, [CMDR, jump(), scan_planet(), second])
    feed(
        conn,
        proj,
        [
            scan_planet(
                body_id=5, timestamp="2026-10-15T21:05:00Z", SystemAddress=SA + 1, StarSystem="Next"
            )
        ],
    )
    growth = views.session_view(conn, "F1").growth
    assert [p.system_name for p in growth] == ["Col 285 Sector TT-H c10-4", "Next"]
    assert 0 < growth[0].carto < growth[1].carto and growth[1].bio == 0


class FakeSpansh:
    def __init__(self) -> None:
        self.calls: list[tuple[float, float, float]] = []

    def __call__(self, coords: tuple[float, float, float]) -> list[dict[str, Any]]:
        self.calls.append(coords)
        x, y, z = coords
        seen = datetime.now(UTC).isoformat(timespec="seconds")
        return [
            raw_station("Hub", x + 30.0, system_y=y, system_z=z),
            raw_station(
                "FC",
                x + 5.0,
                system_y=y,
                system_z=z,
                type="Drake-Class Carrier",
                carrier_docking_access="All",
                updated_at=seen,
            ),
        ]


def test_finder_searches_once_and_the_view_lists_it(
    tmp_path: Path, conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(conn, proj, [CMDR, jump()])
    path = tmp_path / "test.db"
    fake = FakeSpansh()
    changed = threading.Event()
    hub = raw_station("Hub", 0.0)["system_id64"]
    finder = selling.SellFinder(path, changed.set, find=fake, permits=lambda: {hub})

    first = selling.sell_view(conn, "F1", views.cmdr_state(conn, "F1"), finder)
    assert first.state in ("pending", "ready")
    assert changed.wait(5)
    for _ in range(50):  # the permit list comes after the search
        if finder.permit_locked():
            break
        changed.wait(0.1)
        changed.clear()
    sell = selling.sell_view(conn, "F1", views.cmdr_state(conn, "F1"), finder)
    assert sell.state == "ready" and sell.searched_at
    assert [p.system_name for p in sell.places] == ["Hub System"]
    assert sell.places[0].distance_ly == 30.0
    assert sell.places[0].stations[0].permit
    assert sell.nearer_carrier is not None and sell.nearer_carrier.name == "FC"
    assert sell.nearer_carrier.distance_ly == 5.0

    with_carriers = selling.sell_view(conn, "F1", views.cmdr_state(conn, "F1"), finder, True)
    assert [p.system_name for p in with_carriers.places] == ["FC System", "Hub System"]
    assert with_carriers.places[0].stations[0].access == "all"
    assert with_carriers.nearer_carrier is None
    assert len(fake.calls) == 1  # the stored search covers the same spot


def test_pick_puts_the_first_place_on_the_route_first() -> None:
    stations = [
        station("Near Port", "Near", 10.0),
        station("Mid Port", "Mid", 50.0),
        station("Ahead Port", "Ahead", 60.0, uc=False),
    ]
    mid, ahead = stations[1].system_address, stations[2].system_address
    route = {ahead: 2, mid: 5}
    places, _ = pick(stations, (0.0, 0.0, 0.0), "M", NOW, route=route)
    assert [p[1][0].system_name for p in places] == ["Ahead", "Near", "Mid"]
    # Where you are stays on top.
    places, _ = pick(
        [station("Here Port", "Here", 0.0), *stations], (0.0, 0.0, 0.0), "M", NOW, route=route
    )
    assert [p[1][0].system_name for p in places] == ["Here", "Ahead", "Near", "Mid"]
    # Nowhere to sell on the route: the nearest first, as always.
    places, _ = pick(stations, (0.0, 0.0, 0.0), "M", NOW, route={123: 1})
    assert [p[1][0].system_name for p in places] == ["Near", "Mid", "Ahead"]


def test_systems_ahead_on_the_plotted_route() -> None:
    systems = tuple(
        PlottedSystem(n, a, x, 0.0, 0.0, "K")
        for n, a, x in [("A", 1, 0), ("B", 2, 30), ("C", 3, 60)]
    )
    route = PlottedRoute("2026-10-22T10:00:00Z", systems)
    assert selling.ahead(route, 1) == systems[1:]
    assert selling.ahead(route, 2) == systems[2:]
    assert selling.ahead(route, 3) == ()  # its end
    assert selling.ahead(route, 9) == ()  # off it
    assert selling.ahead(None, 1) == ()


def _wait(finder: selling.SellFinder, changed: threading.Event) -> None:
    for _ in range(50):
        if not finder.busy and not finder._asking:  # noqa: SLF001 - the test waits for the worker
            return
        changed.wait(0.1)
        changed.clear()


def test_the_view_lists_the_first_place_on_the_route_first(
    tmp_path: Path, conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(conn, proj, [CMDR, jump()])
    empty = PlottedSystem("Empty System", 776, 31.0, 2.0, 3.0, "K")
    ahead = PlottedSystem("Ahead System", 777, 61.0, 2.0, 3.0, "K")
    route = PlottedRoute(
        "2026-10-22T10:00:00Z",
        (PlottedSystem("Col 285 Sector TT-H c10-4", SA, 1.0, 2.0, 3.0, "K"), empty, ahead),
    )
    asked: list[list[str]] = []

    def find_route(
        systems: Sequence[PlottedSystem], here: tuple[float, float, float]
    ) -> tuple[list[dict[str, Any]], float]:
        asked.append([s.name for s in systems])
        port = raw_station("Ahead", ahead.x, system_y=ahead.y, system_z=ahead.z)
        return [{**port, "system_id64": ahead.address, "services": ["Vista Genomics"]}], math.inf

    changed = threading.Event()
    finder = selling.SellFinder(
        tmp_path / "test.db",
        changed.set,
        find=FakeSpansh(),
        find_route=find_route,
        permits=lambda: set(),
    )
    state = views.cmdr_state(conn, "F1")
    selling.sell_view(conn, "F1", state, finder, plotted=route)
    _wait(finder, changed)
    sell = selling.sell_view(conn, "F1", state, finder, plotted=route)
    assert [p.system_name for p in sell.places] == ["Ahead System", "Hub System"]
    assert sell.places[0].route_jump == 2 and sell.places[1].route_jump is None
    assert sell.places[0].stations[0].genomics and not sell.places[0].stations[0].cartographics
    # The hidden carrier is still nearer than every station listed.
    assert sell.nearer_carrier is not None and sell.nearer_carrier.name == "FC"
    selling.sell_view(conn, "F1", state, finder, plotted=route)
    assert asked == [["Empty System", "Ahead System"]]  # asked once


def test_the_route_is_asked_about_again_only_while_needed(tmp_path: Path) -> None:
    systems = tuple(
        PlottedSystem(n, a, x, 0.0, 0.0, "K")
        for n, a, x in [("A", 1, 30.0), ("B", 2, 60.0), ("C", 3, 90.0)]
    )
    answers: list[tuple[list[dict[str, Any]], float]] = []
    asked: list[list[str]] = []

    def find_route(
        ahead: Sequence[PlottedSystem], here: tuple[float, float, float]
    ) -> tuple[list[dict[str, Any]], float]:
        asked.append([s.name for s in ahead])
        return answers.pop(0)

    def port_in(system: PlottedSystem) -> dict[str, Any]:
        return {**raw_station(system.name, system.x), "system_id64": system.address}

    changed = threading.Event()
    finder = selling.SellFinder(
        tmp_path / "test.db", changed.set, find=FakeSpansh(), find_route=find_route,
        permits=lambda: set(),
    )  # fmt: skip
    here = (0.0, 0.0, 0.0)
    # A full page up to 45 ly: A is known (nothing there), B and C are not: asked next time.
    answers += [([], 45.0), ([port_in(systems[2])], math.inf)]
    finder.request_route(systems, here)
    _wait(finder, changed)
    finder.request_route(systems, here)
    _wait(finder, changed)
    finder.request_route(systems, here)
    _wait(finder, changed)
    assert asked == [["A", "B", "C"], ["B", "C"]]
    assert [len(finder.system_stations(s.address)) for s in systems] == [0, 0, 1]

    # A place known before the first unknown system: the rest is not asked about.
    finder = selling.SellFinder(
        tmp_path / "test.db", changed.set, find=FakeSpansh(), find_route=find_route,
        permits=lambda: set(),
    )  # fmt: skip
    asked.clear()
    answers += [([port_in(systems[0])], 45.0)]
    finder.request_route(systems, here)
    _wait(finder, changed)
    finder.request_route(systems, here)
    _wait(finder, changed)
    assert asked == [["A", "B", "C"]]


def test_the_route_far_ahead_waits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(selling, "ROUTE_ASK_WITHIN", 1)
    systems = tuple(
        PlottedSystem(n, a, x, 0.0, 0.0, "K") for n, a, x in [("A", 1, 30.0), ("B", 2, 60.0)]
    )
    asked: list[list[str]] = []

    def find_route(
        ahead: Sequence[PlottedSystem], here: tuple[float, float, float]
    ) -> tuple[list[dict[str, Any]], float]:
        asked.append([s.name for s in ahead])
        return [], 45.0  # A known, B not

    changed = threading.Event()
    finder = selling.SellFinder(
        tmp_path / "test.db", changed.set, find=FakeSpansh(), find_route=find_route,
        permits=lambda: set(),
    )  # fmt: skip
    finder.request_route(systems, (0.0, 0.0, 0.0))
    _wait(finder, changed)
    finder.request_route(systems, (0.0, 0.0, 0.0))  # B is the 2nd jump: not yet
    _wait(finder, changed)
    assert asked == [["A", "B"]]

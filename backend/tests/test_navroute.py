from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app import db, discovery, fuel
from app.navroute import NavRouteReader, PlottedRoute, navroute_view, parse_navroute, star_kind
from app.projector import Projector

CMDR = {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}
DRIVE = "int_hyperdrive_overcharge_size5_class5"
K = 3.9e-10  # the drive's fuel constant in these tests (fuelmul / optimal mass ** power)
POWER = 2.45
UNLADEN = 383.2
CAPACITY = 32.0
FAR = (5000.0, 0.0, 20000.0)  # far from the bubble and Colonia


def jump_fuel(distance: float, fuel_before: float, cargo: float = 0.0) -> float:
    return K * (distance * (UNLADEN + fuel_before + cargo)) ** POWER


def loadout(scoop: bool = True, item: str = DRIVE, optimal: float | None = None) -> dict:
    fsd: dict = {"Slot": "FrameShiftDrive", "Item": item}
    if optimal is not None:
        fsd["Engineering"] = {
            "BlueprintName": "FSD_LongRange",
            "Modifiers": [{"Label": "FSDOptimalMass", "Value": optimal}],
        }
    modules = [fsd]
    if scoop:
        modules.append({"Slot": "Slot06_Size3", "Item": "int_fuelscoop_size3_class4"})
    return {
        "timestamp": "2026-10-17T10:00:01Z",
        "event": "Loadout",
        "Ship": "mandalay",
        "ShipID": 3,
        "UnladenMass": UNLADEN,
        "MaxJumpRange": 34.9,
        "FuelCapacity": {"Main": CAPACITY, "Reserve": 0.5},
        "Modules": modules,
    }


def fsd_jump(
    address: int,
    ts: str,
    distance: float,
    fuel_before: float,
    pos: tuple[float, float, float] = FAR,
    boost: int = 0,
    name: str | None = None,
) -> dict:
    used = jump_fuel(distance, fuel_before)
    ev = {
        "timestamp": ts,
        "event": "FSDJump",
        "StarSystem": name or f"Sys {address}",
        "SystemAddress": address,
        "StarPos": list(pos),
        "JumpDist": distance,
        "FuelUsed": used,
        "FuelLevel": fuel_before - used,
    }
    if boost:
        ev["BoostUsed"] = boost
    return ev


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    return Projector(conn)


def feed(conn: sqlite3.Connection, proj: Projector, *events: dict) -> None:
    for ev in events:
        n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (n, ev["timestamp"], ev["event"], json.dumps(ev)),
        )
        proj.apply(ev, int(cur.lastrowid))


# --------------------------------------------------------------------------- fuel


def test_fuel_power_by_drive_size() -> None:
    assert fuel.fuel_power("int_hyperdrive_size2_class1") == pytest.approx(2.0)
    assert fuel.fuel_power("int_hyperdrive_overcharge_size5_class5") == pytest.approx(2.45)
    assert fuel.fuel_power("int_hyperdrive_overcharge_size8_class5") == pytest.approx(2.9)
    assert fuel.fuel_power("int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii") == (
        pytest.approx(2.5025)
    )
    assert fuel.fuel_power("int_something_else") is None
    assert fuel.supercharge_multiplier(DRIVE) == 4
    assert (
        fuel.supercharge_multiplier(DRIVE.replace("size5", "size8") + "_overchargebooster_mkii")
        == 6
    )


def test_fuel_curve_is_learnt_from_the_drive_s_jumps(
    conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(
        conn,
        proj,
        CMDR,
        loadout(),
        fsd_jump(1, "2026-10-17T10:01:00Z", 20.0, 30.0),
        fsd_jump(2, "2026-10-17T10:02:00Z", 33.0, 28.0),
        # A supercharged jump burns fuel for a quarter of its length: never learnt from.
        fsd_jump(3, "2026-10-17T10:03:00Z", 120.0, 20.0, boost=4),
    )
    ship = fuel.ship_fuel(conn, "F1")
    assert ship is not None and ship.curve is not None
    assert ship.curve.samples == 2
    assert ship.curve.k == pytest.approx(K, rel=1e-6)
    assert ship.capacity == CAPACITY and ship.has_scoop
    assert ship.jump_fuel(25.0, 10.0) == pytest.approx(jump_fuel(25.0, 10.0), rel=1e-6)


def test_fuel_level_follows_scooping_and_refuelling(
    conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(conn, proj, CMDR, loadout(), fsd_jump(1, "2026-10-17T10:01:00Z", 20.0, 30.0))
    level = lambda: fuel.ship_fuel(conn, "F1").level  # noqa: E731
    assert level() == pytest.approx(30.0 - jump_fuel(20.0, 30.0))
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:02:00Z", "event": "FuelScoop", "Scooped": 1.0, "Total": 29.5},
    )
    assert level() == 29.5
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:03:00Z", "event": "RefuelPartial", "Amount": 5.0, "Cost": 1},
    )
    assert level() == CAPACITY  # capped at the tank
    feed(conn, proj, {"timestamp": "2026-10-17T10:04:00Z", "event": "FuelScoop", "Total": 3.0})
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:05:00Z", "event": "RefuelAll", "Amount": 29.0, "Cost": 1},
    )
    assert level() == CAPACITY


def test_cargo_counts_in_the_jump_mass(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        loadout(),
        {"timestamp": "2026-10-17T10:00:30Z", "event": "Cargo", "Vessel": "Ship", "Count": 40},
        {"timestamp": "2026-10-17T10:00:31Z", "event": "Cargo", "Vessel": "SRV", "Count": 2},
    )
    ev = fsd_jump(1, "2026-10-17T10:01:00Z", 20.0, 30.0)
    ev["FuelUsed"] = jump_fuel(20.0, 30.0, cargo=40.0)
    ev["FuelLevel"] = 30.0 - ev["FuelUsed"]
    feed(conn, proj, ev)
    ship = fuel.ship_fuel(conn, "F1")
    assert ship is not None and ship.cargo == 40.0
    assert ship.curve is not None and ship.curve.k == pytest.approx(K, rel=1e-6)


def test_a_new_drive_starts_a_new_curve(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, CMDR, loadout(), fsd_jump(1, "2026-10-17T10:01:00Z", 20.0, 30.0))
    feed(conn, proj, loadout(optimal=1800.0))  # engineered: another optimal mass
    ship = fuel.ship_fuel(conn, "F1")
    assert ship is not None and ship.curve is None
    feed(conn, proj, loadout())  # back to the stock drive: its jumps count again
    assert fuel.ship_fuel(conn, "F1").curve is not None


# --------------------------------------------------------------------------- the plotted route


def test_star_kinds() -> None:
    assert star_kind("K") == "scoopable"
    assert star_kind("M_RedGiant") == "scoopable"
    assert star_kind("A_BlueWhiteSuperGiant") == "scoopable"
    assert star_kind("AeBe") == "other"
    assert star_kind("MS") == "other"
    assert star_kind("TTS") == "other"
    assert star_kind("L") == "other"
    assert star_kind("N") == "neutron"
    assert star_kind("DA") == "white_dwarf"
    assert star_kind("DCV") == "white_dwarf"
    assert star_kind("H") == "black_hole"


def route_json(classes: list[str], hop: float = 30.0, ts: str = "2026-10-17T10:10:00Z") -> dict:
    return {
        "timestamp": ts,
        "event": "NavRoute",
        "Route": [
            {
                "StarSystem": f"Hop {i}",
                "SystemAddress": 100 + i,
                "StarPos": [FAR[0] + hop * i, FAR[1], FAR[2]],
                "StarClass": c,
            }
            for i, c in enumerate(classes)
        ],
    }


def test_navroute_reader(tmp_path: Path) -> None:
    path = tmp_path / "NavRoute.json"
    reader = NavRouteReader(path)
    assert reader.poll() is False and reader.current is None
    path.write_text(json.dumps(route_json(["K", "N"])), encoding="utf-8")
    assert reader.poll() is True
    assert [s.name for s in reader.current.systems] == ["Hop 0", "Hop 1"]
    assert reader.poll() is False
    path.write_text('{ "timestamp":"x", "event":"NavRoute", "Rou', encoding="utf-8")  # mid-write
    assert reader.poll() is False and len(reader.current.systems) == 2
    path.write_text(
        json.dumps({"timestamp": "y", "event": "NavRouteClear", "Route": []}), encoding="utf-8"
    )
    assert reader.poll() is True and reader.current.systems == ()


class FakeChecker:
    def __init__(self) -> None:
        self.asked: list[tuple[int, str]] = []
        self.busy = False

    def request(self, conn: sqlite3.Connection, systems: list[tuple[int, str]]) -> None:
        self.asked.extend(systems)


def plotted(classes: list[str]) -> PlottedRoute:
    return parse_navroute(route_json(classes))


def at_start(conn: sqlite3.Connection, proj: Projector, *, scoop: bool = True) -> None:
    """Learnt curve, then at Hop 0 (where the route was plotted)."""
    feed(
        conn,
        proj,
        CMDR,
        loadout(scoop=scoop),
        fsd_jump(1, "2026-10-17T10:01:00Z", 20.0, 30.0),
        fsd_jump(100, "2026-10-17T10:05:00Z", 25.0, 30.0, name="Hop 0"),
        {
            "timestamp": "2026-10-17T10:05:05Z",
            "event": "Scan",
            "ScanType": "AutoScan",
            "BodyName": "Hop 0",
            "BodyID": 0,
            "StarSystem": "Hop 0",
            "SystemAddress": 100,
            "DistanceFromArrivalLS": 0.0,
            "StarType": "K",
            "WasDiscovered": False,
            "WasMapped": False,
        },
    )


def test_fuel_forecast_scoops_on_the_way(conn: sqlite3.Connection, proj: Projector) -> None:
    at_start(conn, proj)
    view = navroute_view(conn, "F1", plotted(["K", "M", "L", "G", "T"]), 30.0, FakeChecker())
    assert view.here_index == 0 and view.jumps_left == 4 and view.ly_left == pytest.approx(120.0)
    assert [h.status for h in view.hops] == ["here", "ahead", "ahead", "ahead", "ahead"]
    first = view.hops[1]
    assert first.fuel_used == pytest.approx(jump_fuel(30.0, 30.0), abs=1e-3)
    assert first.fuel_after == pytest.approx(30.0 - jump_fuel(30.0, 30.0), abs=0.01)
    assert first.refuel  # M: scoopable
    # After scooping full at Hop 1, Hop 2 (L) is reached from a full tank.
    assert view.hops[2].fuel_after == pytest.approx(CAPACITY - jump_fuel(30.0, CAPACITY), abs=0.01)
    assert not view.hops[2].refuel
    assert view.fuel.enough is True and view.fuel.jumps_to_scoop == 1
    assert view.fuel.longest_dry == 2  # Hop 1 (scoop) -> Hop 2 -> Hop 3 (scoop)
    assert view.warnings == []
    assert view.hops[0].discovered_by_you is True


def test_fuel_runs_out_before_the_next_scoopable_star(
    conn: sqlite3.Connection, proj: Projector
) -> None:
    at_start(conn, proj)
    one = jump_fuel(30.0, 10.0)
    route = plotted(["K", "N", "DA", "L", "G"])
    view = navroute_view(conn, "F1", route, one * 2.2, FakeChecker())
    assert view.fuel.enough is False and view.fuel.short_at == 3
    assert view.hops[3].short and view.hops[3].fuel_after is None
    # You are at a scoopable star: scoop before jumping.
    assert "refuel_here" in view.warnings and "fuel_short" not in view.warnings
    assert "neutron_next" in view.warnings
    assert view.next_neutron == 1 and view.next_white_dwarf == 2
    assert view.neutrons_ahead == 1 and view.white_dwarfs_ahead == 1
    # Not at a scoopable star (or no scoop): plain short.
    at_dwarf = plotted(["DA", "N", "DA", "L", "G"])
    view = navroute_view(conn, "F1", at_dwarf, one * 2.2, FakeChecker())
    assert "fuel_short" in view.warnings


def test_tight_fuel_and_a_dry_stretch(conn: sqlite3.Connection, proj: Projector) -> None:
    at_start(conn, proj)
    level = 8.0  # just enough for two jumps (heavier at first: a fixed point)
    for _ in range(20):
        first = jump_fuel(30.0, level)
        level = first + jump_fuel(30.0, level - first) + 0.05
    view = navroute_view(conn, "F1", plotted(["K", "L", "G"]), level, FakeChecker())
    assert view.fuel.enough is True and view.fuel.fuel_at_scoop == pytest.approx(0.05, abs=0.01)
    assert "fuel_tight" in view.warnings
    # Long stretch of brown dwarfs: more than a full tank even from full.
    many = ["K"] + ["L"] * 40 + ["G"]
    view = navroute_view(conn, "F1", plotted(many), CAPACITY, FakeChecker())
    assert view.fuel.longest_dry == 41
    # Scooping here would not help: plainly short.
    assert "dry_stretch" in view.warnings and "fuel_short" in view.warnings
    assert "refuel_here" not in view.warnings


def test_no_curve_no_fuel_forecast(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, CMDR, loadout())
    view = navroute_view(conn, "F1", plotted(["K", "L"]), 10.0, FakeChecker())
    assert view.fuel.learnt_from == 0 and view.fuel.enough is None
    assert view.hops[1].fuel_used is None
    assert view.here_index is None and "off_route" in view.warnings


def test_discovery_chances_ahead(conn: sqlite3.Connection, proj: Projector) -> None:
    at_start(conn, proj)
    conn.executemany(
        "INSERT INTO discovery(id64, fetched_at, spansh, edsm) VALUES(?, ?, ?, ?)",
        [
            (101, "2026-10-17T10:00:00+00:00", discovery.SPANSH_STAR, None),
            (102, "2026-10-17T10:00:00+00:00", discovery.SPANSH_SYSTEM, discovery.EDSM_NONE),
            (104, "2026-10-17T10:00:00+00:00", discovery.SPANSH_NONE, discovery.EDSM_NONE),
        ],
    )
    checker = FakeChecker()
    view = navroute_view(conn, "F1", plotted(["K", "G", "DA", "M", "F"]), 30.0, checker)
    chances = [h.discovery.probability if h.discovery else None for h in view.hops]
    states = [h.discovery.state if h.discovery else None for h in view.hops]
    assert states == [None, "scanned", "seen", "pending", "unknown"]
    seen_dwarf = round(discovery.P_SEEN * discovery.POPULAR_STAR, 2)  # a white dwarf
    assert chances == [None, discovery.P_SCANNED, seen_dwarf, None, discovery.P_UNKNOWN]
    expected = discovery.P_SCANNED + seen_dwarf + discovery.P_UNKNOWN
    assert view.undiscovered_expected == pytest.approx(expected)
    # Asked about everything ahead (the cache decides what is fetched), not Hop 0 (scanned).
    assert [a for a, _ in checker.asked] == [101, 102, 103, 104]


def test_chance_rules() -> None:
    d = discovery
    assert d.chance(None, None, FAR, "scoopable").state == "pending"
    assert d.chance(0, 2, FAR, "scoopable").probability == d.P_SCANNED
    assert d.chance(2, None, FAR, "scoopable").probability == d.P_BODIES
    assert d.chance(1, None, FAR, "scoopable").probability == d.P_SEEN
    assert d.chance(0, 1, FAR, "scoopable").probability == d.P_SEEN
    far = d.chance(0, 0, FAR, "scoopable")
    assert far.probability == d.P_UNKNOWN and far.reasons == ("not_in_databases",)
    assert d.chance(None, 0, FAR, "neutron").probability == round(d.P_UNKNOWN * d.POPULAR_STAR, 2)


@pytest.mark.parametrize(
    ("position", "factor", "reason"),
    [
        ((10.0, 0.0, 10.0), 0.1, "busy_area"),  # the bubble
        ((0.0, 0.0, 2000.0), 0.3, "busy_area"),  # just outside it
        ((0.0, 0.0, 5000.0), 0.8, "inner_area"),
        ((-9530.5, -910.0, 19900.0), 0.5, "busy_area"),  # Colonia
        (FAR, 1.0, None),
        (None, 1.0, None),  # position unknown
    ],
)
def test_chance_by_area(position: tuple | None, factor: float, reason: str | None) -> None:
    c = discovery.chance(0, 0, position, "scoopable")
    assert c.probability == round(discovery.P_UNKNOWN * factor, 2)
    assert c.reasons == ("not_in_databases", reason) if reason else ("not_in_databases",)


def test_checker_asks_spansh_then_edsm(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    conn = db.connect(path)
    db.init_schema(conn)
    asked_edsm: list[list[str]] = []
    changed: list[int] = []

    def spansh(ids: list[int]) -> dict[int, int]:
        return {1: discovery.SPANSH_STAR, 2: discovery.SPANSH_SYSTEM, 3: discovery.SPANSH_NONE}

    def edsm(names: list[str]) -> dict[str, int]:
        asked_edsm.append(names)
        return {"two": discovery.EDSM_NONE, "three": discovery.EDSM_STAR}

    checker = discovery.DiscoveryChecker(path, lambda: changed.append(1), spansh, edsm)
    checker.request(conn, [(1, "One"), (2, "Two"), (3, "Three")])
    for _ in range(200):
        if not checker.busy:
            break
        import time

        time.sleep(0.01)
    rows = {r["id64"]: (r["spansh"], r["edsm"]) for r in conn.execute("SELECT * FROM discovery")}
    assert rows == {1: (3, None), 2: (1, 0), 3: (0, 2)}
    assert asked_edsm == [["Two", "Three"]]
    assert changed
    # Fresh answers are not asked again.
    before = len(asked_edsm)
    checker.request(conn, [(1, "One"), (2, "Two")])
    assert not checker.busy and len(asked_edsm) == before


def test_spansh_and_edsm_answers_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(url: str, data: bytes | None = None) -> object:
        if "spansh" in url:
            return {
                "results": [
                    {"id64": 1, "bodies": [{"is_main_star": True}]},
                    {"id64": 2, "bodies": [{"is_main_star": None}]},
                    {"id64": 3, "bodies": []},
                ]
            }
        return [{"name": "Two", "primaryStar": {"type": "K"}}, {"name": "Three"}]

    monkeypatch.setattr(discovery, "_request", fake)
    assert discovery.spansh_lookup([1, 2, 3, 4]) == {1: 3, 2: 2, 3: 1, 4: 0}
    assert discovery.edsm_lookup(["Two", "Three", "Four"]) == {"two": 2, "three": 1, "four": 0}

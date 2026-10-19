"""Routes that just get there: Spansh's neutron route, its waypoints as the stops."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from app import db, neutron, routes
from app.neutron import NeutronError, NeutronRequest, Waypoint
from app.projector import Projector
from app.routeplan import PlanError, Point
from app.schemas import RouteRequest
from tests.test_routes import Planner, feed

CMDR = {"timestamp": "2026-10-19T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}
LOADOUT = {
    "timestamp": "2026-10-19T10:00:01Z",
    "event": "Loadout",
    "MaxJumpRange": 60.0,
    "Modules": [{"Slot": "FrameShiftDrive", "Item": "int_hyperdrive_overcharge_size5_class5"}],
}
START = {
    "timestamp": "2026-10-19T10:00:02Z",
    "event": "Location",
    "StarSystem": "Start",
    "SystemAddress": 1,
    "StarPos": [0.0, 0.0, 0.0],
}
WAYPOINTS = [
    Waypoint("Start", 1, 0.0, 0.0, 0.0, 0, False, 1000.0),
    Waypoint("Neutron A", 2, 300.0, 0.0, 0.0, 5, True, 700.0),
    Waypoint("Neutron B", 3, 600.0, 0.0, 0.0, 2, True, 400.0),
    Waypoint("Home", 4, 1000.0, 0.0, 0.0, 3, False, 0.0),
]


def jump(ts: str, name: str, address: int, x: float) -> dict:
    return {
        "timestamp": ts,
        "event": "FSDJump",
        "StarSystem": name,
        "SystemAddress": address,
        "StarPos": [x, 0.0, 0.0],
        "JumpDist": 50.0,
    }


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


def transit(destination: str | None = "Home") -> RouteRequest:
    return RouteRequest(mode="line", goal="transit", destination=destination)


def test_plan_transit_takes_the_waypoints(conn: sqlite3.Connection) -> None:
    feed(conn, Projector(conn), CMDR, LOADOUT, START)
    asked: list[NeutronRequest] = []

    def plotter(req: NeutronRequest) -> list[Waypoint]:
        asked.append(req)
        return WAYPOINTS

    plan = routes.plan_transit(conn, "F1", transit(), Point("Start", 0, 0, 0), plotter)
    assert asked[0].source == "Start" and asked[0].destination == "Home"
    assert asked[0].range_ly == 60.0 and asked[0].multiplier == 4
    assert [s.name for s in plan.stops] == ["Neutron A", "Neutron B", "Home"]
    assert [s.jumps for s in plan.stops] == [5, 2, 3]
    assert [s.neutron for s in plan.stops] == [True, True, False]
    assert plan.stops[0].hop_ly == 300.0 and plan.destination is not None
    assert plan.destination.name == "Home"


def test_plan_transit_errors(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(conn, proj, CMDR, START)
    here = Point("Start", 0, 0, 0)
    with pytest.raises(PlanError) as no_dest:
        routes.plan_transit(conn, "F1", transit(None), here, lambda r: WAYPOINTS)
    assert no_dest.value.code == "no_destination"
    with pytest.raises(PlanError) as no_range:
        routes.plan_transit(conn, "F1", transit(), here, lambda r: WAYPOINTS)
    assert no_range.value.code == "no_jump_range"
    feed(conn, proj, LOADOUT)

    def unknown(req: NeutronRequest) -> list[Waypoint]:
        raise NeutronError("unknown_system", "Nowhere")

    with pytest.raises(PlanError) as bad:
        routes.plan_transit(conn, "F1", transit(), here, unknown)
    assert bad.value.code == "unknown_system"

    def down(req: NeutronRequest) -> list[Waypoint]:
        raise NeutronError("spansh_unavailable", "HTTP 502")

    with pytest.raises(PlanError) as unavailable:
        routes.plan_transit(conn, "F1", transit(), here, down)
    assert unavailable.value.code == "spansh_unavailable"


def test_transit_route_ticks_off_waypoints(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    conn = db.connect(path)
    db.init_schema(conn)
    conn.execute("PRAGMA foreign_keys=OFF")
    proj = Projector(conn)
    # Neutron B visited long before the route: it does not count.
    feed(conn, proj, CMDR, LOADOUT, jump("2026-10-01T10:00:00Z", "Neutron B", 3, 600.0), START)

    planner = routes.RoutePlanner(path, True, lambda: None, plotter=lambda r: WAYPOINTS)
    planner.start(transit())
    for _ in range(200):
        if not planner.building:
            break
        time.sleep(0.01)
    view = routes.route_view(conn, "F1", planner)
    assert view.error is None and view.params is not None and view.params.goal == "transit"
    assert [s.name for s in view.stops] == ["Neutron A", "Neutron B", "Home"]
    assert [(s.jumps, s.neutron) for s in view.stops] == [(5, True), (2, True), (3, False)]
    assert view.next_seq == 1 and view.neutron is None and view.total_value == 0
    assert view.jumps_to_next == 5  # Spansh's count for the leg

    # Straight to B, past A: both done.
    feed(conn, proj, jump("2099-01-01T10:00:00Z", "Neutron B", 3, 600.0))
    view = routes.route_view(conn, "F1", planner)
    assert [s.done for s in view.stops] == [True, True, False]
    assert view.next_seq == 3 and view.done_count == 2

    # Moving a stop keeps its jumps and neutron flag.
    assert routes.move_stop(conn, 3, 1)
    view = routes.route_view(conn, "F1", Planner())
    assert [(s.name, s.jumps, s.neutron) for s in view.stops][0] == ("Home", 3, False)


def test_neutron_plot_is_the_default_plotter(tmp_path: Path) -> None:
    planner = routes.RoutePlanner(tmp_path / "t.db", True, lambda: None)
    assert planner.plotter is neutron.plot

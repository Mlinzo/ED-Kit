from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db, galaxy, neutron
from app.config import Settings
from app.main import create_app
from app.projector import Projector
from app.schemas import RoutePoint

CMDR = {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}


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


def arrive(
    address: int, ts: str, x: float, event: str = "FSDJump", name: str | None = None
) -> dict:
    ev: dict[str, Any] = {
        "timestamp": ts,
        "event": event,
        "StarSystem": name or f"Sys {address}",
        "SystemAddress": address,
        "StarPos": [x, 0.0, 0.0],
    }
    if event == "FSDJump":
        ev["JumpDist"] = 10.0
    return ev


# --------------------------------------------------------------------------- neutron routes


SPANSH_RESULT = {
    "system_jumps": [
        {"system": "Here", "id64": 1, "x": 0, "y": 0, "z": 0, "jumps": 0, "neutron_star": False,
         "distance_left": 500.0},
        {"system": "PSR A", "id64": 2, "x": 100, "y": 0, "z": 0, "jumps": 4, "neutron_star": True,
         "distance_left": 400.0},
        {"system": "PSR B", "id64": 3, "x": 300, "y": 0, "z": 0, "jumps": 2, "neutron_star": True,
         "distance_left": 200.0},
        {"system": "Stop", "id64": 4, "x": 500, "y": 0, "z": 0, "jumps": 1, "neutron_star": False,
         "distance_left": 0.0},
    ]
}  # fmt: skip


def test_plot_polls_spansh_until_done(monkeypatch: pytest.MonkeyPatch) -> None:
    answers = [
        {"job": "J1", "status": "queued"},
        {"status": "queued"},
        {"status": "ok", "result": SPANSH_RESULT},
    ]
    urls: list[str] = []

    def fake_open(req: Any) -> Any:
        urls.append(req.full_url)
        return answers.pop(0)

    monkeypatch.setattr(neutron, "_open", fake_open)
    req = neutron.NeutronRequest("Here", "Stop", 4, 34.9, 60, 4)
    waypoints = neutron.plot(req, sleep=lambda _: None)
    assert [w.name for w in waypoints] == ["Here", "PSR A", "PSR B", "Stop"]
    assert waypoints[1].neutron and waypoints[1].jumps == 4
    assert urls[0] == neutron.PLOT and urls[1].endswith("/J1")


def test_plot_reports_spansh_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    answers = [{"job": "J1"}, {"status": "error", "error": "Could not find a route"}]
    monkeypatch.setattr(neutron, "_open", lambda req: answers.pop(0))
    with pytest.raises(neutron.NeutronError) as err:
        neutron.plot(neutron.NeutronRequest("A", "B", None, 30, 60, 4), sleep=lambda _: None)
    assert err.value.code == "no_route"


def wait_until(check: Any, seconds: float = 2.0) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and not check():
        time.sleep(0.01)


def test_neutron_plan_and_progress(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    conn = db.connect(path)
    db.init_schema(conn)
    conn.execute("PRAGMA foreign_keys=OFF")
    proj = Projector(conn)
    feed(conn, proj, CMDR, arrive(1, "2026-10-17T09:00:00Z", 0.0, name="Here"))

    planner = neutron.NeutronPlanner(
        path, lambda: None, plotter=lambda req: neutron.parse_result(SPANSH_RESULT)
    )
    planner.start(neutron.NeutronRequest("Here", "Stop", 4, 34.9, 60, 4))
    wait_until(lambda: not planner.building)
    view = neutron.plan_view(conn, "F1", planner, 4, 1, 35.0)
    assert view is not None and view.error is None and not view.stale
    assert view.total_jumps == 7 and view.direct_jumps == 15  # 500 ly at 35 ly
    assert [w.visited for w in view.waypoints] == [True, False, False, False]
    assert view.next_index == 1

    # Fly to the first neutron star: the next waypoint moves on.
    ts = "2099-01-01T00:00:00Z"  # after the plan was made
    feed(conn, proj, arrive(2, ts, 100.0, name="PSR A"))
    view = neutron.plan_view(conn, "F1", planner, 4, 2, 35.0)
    assert view.next_index == 2 and view.waypoints[1].visited
    # Another next stop: the plan is stale.
    assert neutron.plan_view(conn, "F1", planner, 99, 2, 35.0).stale


def test_neutron_plan_failure_is_reported(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    conn = db.connect(path)
    db.init_schema(conn)

    def fail(req: neutron.NeutronRequest) -> list[neutron.Waypoint]:
        raise neutron.NeutronError("unknown_system")

    planner = neutron.NeutronPlanner(path, lambda: None, plotter=fail)
    planner.start(neutron.NeutronRequest("Nowhere", "Stop", 4, 34.9, 60, 4))
    wait_until(lambda: not planner.building)
    view = neutron.plan_view(conn, "F1", planner, 4, None, 35.0)
    assert view is not None and view.error == "unknown_system" and view.waypoints == []
    planner.forget()
    assert neutron.plan_view(conn, "F1", planner, 4, None, 35.0) is None


# --------------------------------------------------------------------------- galaxy


def test_galaxy_path_breaks_where_you_did_not_fly(
    conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(1, "2026-10-17T10:00:01Z", 0.0, event="Location"),
        arrive(2, "2026-10-17T10:01:00Z", 10.0),
        arrive(3, "2026-10-17T10:02:00Z", 20.0),
        {
            "timestamp": "2026-10-17T10:03:00Z",
            "event": "Died",
            "KillerName": "Billy Moist",
            "KillerShip": "python_nx",
        },
        # Respawned far away: not flown.
        arrive(4, "2026-10-17T10:04:00Z", 5000.0, event="Location"),
        arrive(5, "2026-10-17T10:05:00Z", 5010.0, event="CarrierJump"),
        arrive(4, "2026-10-17T10:06:00Z", 5000.0),
    )
    view = galaxy.galaxy_view(conn, "F1", [], [RoutePoint(name="Next", x=1, y=2, z=3)])
    names = [s.name for s in view.systems]
    assert names == ["Sys 1", "Sys 2", "Sys 3", "Sys 4", "Sys 5"]
    assert view.path == [[0, 1, 2], [3, 4, 3]]
    assert view.current == 3
    assert view.distance_ly == 30.0  # FSD jumps only
    assert view.farthest_from_sol is not None and view.farthest_from_sol.name == "Sys 5"
    assert len(view.deaths) == 1
    death = view.deaths[0]
    assert death.system == 2 and death.name == "Sys 3" and death.killers == ["Billy Moist"]
    assert view.plotted[0].name == "Next"


def test_new_endpoints(tmp_path: Path) -> None:
    settings = Settings(
        journal_dir=tmp_path / "journals",
        data_dir=tmp_path / "data",
        static_dir=None,
        online=False,
    )
    with TestClient(create_app(settings)) as client:
        nav = client.get("/api/view/navroute").json()
        assert nav["hops"] == [] and nav["online"] is False
        assert nav["fuel"]["learntFrom"] == 0
        world = client.get("/api/view/galaxy").json()
        assert world["systems"] == [] and world["path"] == []
        route = client.get("/api/view/route").json()
        assert route["neutron"] is None
        # Offline: Spansh is not asked.
        assert client.post("/api/route/neutron", json={}).status_code == 409
        assert client.delete("/api/route/neutron").status_code == 204

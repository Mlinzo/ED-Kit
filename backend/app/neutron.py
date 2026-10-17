"""Neutron routes to the route's next stop, from Spansh's neutron plotter.

A long hop to a stop (or to the first one) flies far faster through neutron stars: each
supercharge multiplies the next jump's range by 4 (6 with the SCO mk II drive). Spansh plans
such a route (POST /api/route, then poll /api/results/{job}); we keep the latest one and
show it with your progress along it (waypoints visited since it was made). You plot each
leg in the game, waypoint to waypoint.
"""

from __future__ import annotations

import contextlib
import json
import logging
import math
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app import db
from app.enrich import USER_AGENT
from app.schemas import NeutronPlanView, NeutronWaypointView

log = logging.getLogger(__name__)

PLOT = "https://spansh.co.uk/api/route"
RESULTS = "https://spansh.co.uk/api/results/{job}"
TIMEOUT_S = 20
POLL_S = 1.0
GIVE_UP_S = 120.0


class NeutronError(Exception):
    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(detail or code)
        self.code = code  # unknown_system | spansh_unavailable | no_route


@dataclass(frozen=True, slots=True)
class Waypoint:
    name: str
    id64: int
    x: float
    y: float
    z: float
    jumps: int
    neutron: bool
    left_ly: float


@dataclass(frozen=True, slots=True)
class NeutronRequest:
    source: str
    destination: str
    destination_address: int | None
    range_ly: float
    efficiency: int
    multiplier: int


def _open(req: urllib.request.Request) -> Any:
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body: Any = None
        with contextlib.suppress(OSError, ValueError):
            body = json.loads(exc.read().decode("utf-8"))
        message = body.get("error") if isinstance(body, dict) else None
        if exc.code == 400:
            raise NeutronError("unknown_system", message) from exc
        raise NeutronError("spansh_unavailable", f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise NeutronError("spansh_unavailable", str(exc)) from exc


def plot(req: NeutronRequest, sleep: Callable[[float], None] = time.sleep) -> list[Waypoint]:
    """Ask Spansh and wait for the answer (blocking, up to GIVE_UP_S)."""
    form = urllib.parse.urlencode(
        {
            "from": req.source,
            "to": req.destination,
            "range": f"{req.range_ly:.2f}",
            "efficiency": req.efficiency,
            "supercharge_multiplier": req.multiplier,
        }
    ).encode("utf-8")
    started = _open(
        urllib.request.Request(PLOT, data=form, headers={"User-Agent": USER_AGENT}, method="POST")
    )
    job = started.get("job") if isinstance(started, dict) else None
    if not job:
        raise NeutronError("spansh_unavailable", "no job")
    waited = 0.0
    while waited < GIVE_UP_S:
        sleep(POLL_S)
        waited += POLL_S
        data = _open(
            urllib.request.Request(
                RESULTS.format(job=urllib.parse.quote(str(job))), headers={"User-Agent": USER_AGENT}
            )
        )
        if not isinstance(data, dict):
            raise NeutronError("spansh_unavailable", "bad response")
        if data.get("status") == "queued":
            continue
        if data.get("error"):
            raise NeutronError("no_route", str(data["error"]))
        return parse_result(data.get("result") or {})
    raise NeutronError("spansh_unavailable", "timeout")


def parse_result(result: dict[str, Any]) -> list[Waypoint]:
    out = []
    for j in result.get("system_jumps") or []:
        if not isinstance(j, dict) or not j.get("system") or j.get("id64") is None:
            continue
        out.append(
            Waypoint(
                name=str(j["system"]),
                id64=int(j["id64"]),
                x=float(j.get("x") or 0.0),
                y=float(j.get("y") or 0.0),
                z=float(j.get("z") or 0.0),
                jumps=int(j.get("jumps") or 0),
                neutron=bool(j.get("neutron_star")),
                left_ly=float(j.get("distance_left") or 0.0),
            )
        )
    if len(out) < 2:
        raise NeutronError("no_route")
    return out


def store(conn: sqlite3.Connection, req: NeutronRequest, waypoints: list[Waypoint]) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO neutron_plan(id, created_at, source, destination, "
        "destination_address, range_ly, efficiency, multiplier, total_jumps, waypoints) "
        "VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            datetime.now(UTC).isoformat(timespec="seconds"),
            req.source,
            req.destination,
            req.destination_address,
            req.range_ly,
            req.efficiency,
            req.multiplier,
            sum(w.jumps for w in waypoints),
            json.dumps(
                [
                    {
                        "name": w.name,
                        "id64": w.id64,
                        "x": w.x,
                        "y": w.y,
                        "z": w.z,
                        "jumps": w.jumps,
                        "neutron": w.neutron,
                        "left_ly": w.left_ly,
                    }
                    for w in waypoints
                ]
            ),
        ),
    )


def clear(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM neutron_plan")


class NeutronPlanner:
    """One neutron route at a time, planned on a worker thread (a newer request wins)."""

    def __init__(
        self,
        db_path: Path,
        on_change: Callable[[], None],
        plotter: Callable[[NeutronRequest], list[Waypoint]] = plot,
    ) -> None:
        self.db_path = db_path
        self.on_change = on_change
        self.plotter = plotter
        self._lock = threading.Lock()
        self._generation = 0
        self.building = False
        self.error: str | None = None

    def start(self, req: NeutronRequest) -> None:
        with self._lock:
            self._generation += 1
            generation = self._generation
            self.building = True
            self.error = None
        threading.Thread(
            target=self._build, args=(generation, req), name="neutron", daemon=True
        ).start()
        self.on_change()

    def forget(self) -> None:
        """Drop the error of a failed request (the plan itself is cleared by the caller)."""
        with self._lock:
            self._generation += 1
            self.building = False
            self.error = None

    def _build(self, generation: int, req: NeutronRequest) -> None:
        error: str | None = None
        try:
            waypoints = self.plotter(req)
            conn = db.connect(self.db_path)
            try:
                with self._lock:
                    if generation != self._generation:
                        return
                    store(conn, req, waypoints)
            finally:
                conn.close()
            log.info(
                "neutron route %s -> %s: %d waypoints", req.source, req.destination, len(waypoints)
            )
        except NeutronError as exc:
            log.info("neutron route failed: %s (%s)", exc.code, exc)
            error = exc.code
        except Exception:
            log.exception("neutron route failed")
            error = "internal"
        with self._lock:
            if generation != self._generation:
                return
            self.building = False
            self.error = error
        self.on_change()


def plan_view(
    conn: sqlite3.Connection,
    fid: str | None,
    planner: NeutronPlanner | None,
    next_address: int | None,
    current_address: int | None,
    jump_range: float | None,
) -> NeutronPlanView | None:
    """The neutron plan with your progress; None when there is none and none is coming."""
    row = conn.execute("SELECT * FROM neutron_plan WHERE id = 1").fetchone()
    building = planner.building if planner else False
    error = planner.error if planner else None
    if row is None and not building and error is None:
        return None
    if row is None:
        return NeutronPlanView(
            building=building,
            error=error,
            created_at=None,
            source=None,
            destination=None,
            stale=False,
            efficiency=None,
            range_ly=None,
            multiplier=None,
            total_jumps=None,
            direct_jumps=None,
            waypoints=[],
            next_index=None,
        )
    points = json.loads(row["waypoints"])
    seen = {
        r[0]
        for r in conn.execute(
            "SELECT system_address FROM visits WHERE fid = ? AND ts >= ?",
            (fid, row["created_at"]),
        )
    }
    last = max((i for i, p in enumerate(points) if p["id64"] in seen), default=0)
    here = next((i for i, p in enumerate(points) if p["id64"] == current_address), None)
    if here is not None:
        last = max(last, here)
    waypoints = [
        NeutronWaypointView(
            name=p["name"],
            address=str(p["id64"]),
            x=p["x"],
            y=p["y"],
            z=p["z"],
            jumps=p["jumps"],
            neutron=p["neutron"],
            left_ly=round(p["left_ly"], 2),
            visited=i <= last,  # the start (0) is where you were when it was made
        )
        for i, p in enumerate(points)
    ]
    first, end = points[0], points[-1]
    direct = math.dist((first["x"], first["y"], first["z"]), (end["x"], end["y"], end["z"]))
    return NeutronPlanView(
        building=building,
        error=error,
        created_at=row["created_at"],
        source=row["source"],
        destination=row["destination"],
        stale=row["destination_address"] != next_address,
        efficiency=row["efficiency"],
        range_ly=row["range_ly"],
        multiplier=row["multiplier"],
        total_jumps=row["total_jumps"],
        direct_jumps=math.ceil(direct / jump_range) if jump_range else None,
        waypoints=waypoints,
        next_index=last + 1 if last + 1 < len(points) else None,
    )

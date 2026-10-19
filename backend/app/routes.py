"""The planned route: built on a worker thread (Spansh), stored in SQLite, shown with your
progress from the journal (visited systems, scanned and mapped bodies)."""

from __future__ import annotations

import json
import logging
import math
import sqlite3
import threading
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app import db, exobio, neutron, regionmap, routeplan
from app.codex import CodexIndex, codex_index, codex_status
from app.routeplan import BodyProgress, Plan, PlanError, PlanRequest, Point
from app.schemas import (
    RouteBodyView,
    RouteCodexView,
    RoutePoint,
    RouteRequest,
    RouteStopView,
    RouteView,
)
from app.spansh import PAGE_SIZE, CachedSearch, SpanshError
from app.views import cmdr_state, short_name

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- building


def _local_point(conn: sqlite3.Connection, fid: str | None, name: str) -> Point | None:
    """Coordinates of a system you have visited (by name), or of the current one (empty)."""
    if not name.strip():
        state = cmdr_state(conn, fid)
        if state is None or state["system_address"] is None:
            return None
        row = conn.execute(
            "SELECT name, x, y, z FROM systems WHERE address = ?", (state["system_address"],)
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT name, x, y, z FROM systems WHERE name = ? COLLATE NOCASE LIMIT 1",
            (name.strip(),),
        ).fetchone()
    if row is None or row["x"] is None:
        return None
    return Point(row["name"], row["x"], row["y"], row["z"])


def _progress(
    conn: sqlite3.Connection, fid: str | None, addresses: Iterable[int]
) -> dict[tuple[int, int], BodyProgress]:
    """Your progress per body (journal): mapped by you, distinct species analysed."""
    ids = list(addresses)
    mapped: set[tuple[int, int]] = set()
    species: dict[tuple[int, int], int] = {}
    for start in range(0, len(ids), 900):  # SQLite parameter limit
        chunk = ids[start : start + 900]
        marks = ",".join("?" * len(chunk))
        mapped.update(
            (r["system_address"], r["body_id"])
            for r in conn.execute(
                "SELECT system_address, body_id FROM body_cmdr WHERE fid = ? "
                f"AND mapped_at IS NOT NULL AND system_address IN ({marks})",
                (fid, *chunk),
            )
        )
        for r in conn.execute(
            "SELECT system_address, body_id, COUNT(DISTINCT species) AS n FROM organic_scans "
            f"WHERE fid = ? AND status = 'analysed' AND system_address IN ({marks}) "
            "GROUP BY system_address, body_id",
            (fid, *chunk),
        ):
            species[(r["system_address"], r["body_id"])] = r["n"]
    return {key: (key in mapped, species.get(key, 0)) for key in mapped | species.keys()}


def _plan_request(req: RouteRequest, source: Point | None) -> PlanRequest:
    return PlanRequest(
        mode=req.mode,
        goal=req.goal,
        source=source.name if source is not None else req.source.strip(),
        destination=(req.destination or "").strip() or None,
        radius_ly=req.radius_ly,
        deviation_ly=req.deviation_ly,
        max_systems=req.max_systems,
        body_types=tuple(req.body_types),
        min_value=req.min_value,
        min_system_value=req.min_system_value,
        include_populated=req.include_populated,
        skip_mapped=req.skip_mapped,
        bio_min_value=req.bio_min_value,
        bio_require_genuses=req.bio_require_genuses,
    )


def store(
    conn: sqlite3.Connection, req: RouteRequest, plan: Plan, data_at: datetime | None
) -> None:
    """Replace the current route (one transaction)."""

    def point(p: Point | None) -> str | None:
        return None if p is None else json.dumps({"name": p.name, "x": p.x, "y": p.y, "z": p.z})

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM route")
        conn.execute("DELETE FROM route_stops")
        conn.execute("DELETE FROM route_bodies")
        conn.execute(
            "INSERT INTO route(id, created_at, params, source, destination, truncated, data_at) "
            "VALUES(1, ?, ?, ?, ?, ?, ?)",
            (
                datetime.now(UTC).isoformat(timespec="seconds"),
                req.model_dump_json(by_alias=True, exclude={"refresh"}),
                point(plan.source),
                point(plan.destination),
                int(plan.truncated),
                data_at.isoformat(timespec="seconds") if data_at else None,
            ),
        )
        conn.executemany(
            "INSERT INTO route_stops(seq, system_address, name, x, y, z, hop_ly) "
            "VALUES(?, ?, ?, ?, ?, ?, ?)",
            [
                (i, s.address, s.name, s.x, s.y, s.z, round(s.hop_ly, 2))
                for i, s in enumerate(plan.stops, start=1)
            ],
        )
        conn.executemany(
            "INSERT OR REPLACE INTO route_bodies(system_address, body_id, name, kind, "
            "distance_ls, scan_value, mapping_value, bio_signals, bio_min, bio_max, genuses, "
            "codex) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    s.address,
                    b.body_id,
                    b.name,
                    b.kind,
                    b.distance_ls,
                    b.scan_value,
                    b.mapping_value,
                    b.bio_signals,
                    b.bio_min,
                    b.bio_max,
                    json.dumps(list(b.genuses)),
                    json.dumps([[e.key, e.species, e.colour, round(e.weight, 4)] for e in b.codex]),
                )
                for s in plan.stops
                for b in s.bodies.values()
            ],
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


class RoutePlanner:
    """Builds routes one at a time on a worker thread; a newer request supersedes an
    older one still running (its result is dropped)."""

    def __init__(
        self,
        db_path: Path,
        online: bool,
        on_change: Callable[[], None],
        search_factory: Callable[[Path, bool], CachedSearch] | None = None,
    ) -> None:
        self.db_path = db_path
        self.online = online
        self.on_change = on_change
        self.search_factory = search_factory or (
            lambda path, refresh: CachedSearch(path, refresh=refresh)
        )
        self._lock = threading.Lock()
        self._generation = 0
        self.building = False
        self.error: tuple[str, str | None] | None = None

    def start(self, req: RouteRequest) -> None:
        with self._lock:
            self._generation += 1
            generation = self._generation
            self.building = True
            self.error = None
        threading.Thread(
            target=self._build, args=(generation, req), name="route", daemon=True
        ).start()
        self.on_change()

    def _current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation

    def _finish(self, generation: int, error: tuple[str, str | None] | None) -> None:
        with self._lock:
            if generation != self._generation:
                return
            self.building = False
            self.error = error
        self.on_change()

    def _build(self, generation: int, req: RouteRequest) -> None:
        conn = db.connect(self.db_path)
        search = self.search_factory(self.db_path, req.refresh)
        try:
            fid = db.get_meta(conn, "active_fid")
            source = _local_point(conn, fid, req.source)
            if source is None and not req.source.strip():
                raise PlanError("unknown_system")
            plan = routeplan.plan(
                _plan_request(req, source),
                search,
                lambda ids: _progress(conn, fid, ids),
                source,
                codex_index(conn, fid) if req.goal == "codex" else None,
            )
            if not self._current(generation):
                return
            store(conn, req, plan, search.oldest)
            log.info(
                "route: %d stops (%s, %d Spansh requests)",
                len(plan.stops),
                req.mode,
                search.requests,
            )
            self._finish(generation, None)
            self._fill_population(conn, search, generation, [s.address for s in plan.stops])
        except PlanError as exc:
            self._finish(generation, (exc.code, exc.detail))
        except Exception:
            log.exception("route planning failed")
            self._finish(generation, ("internal", None))
        finally:
            search.close()
            conn.close()

    def _fill_population(
        self, conn: sqlite3.Connection, search: CachedSearch, generation: int, ids: list[int]
    ) -> None:
        """Population of the stops, after the route is shown (one more Spansh round)."""
        try:
            info: dict[int, dict] = {}
            for start in range(0, len(ids), PAGE_SIZE):
                info.update(search.systems(ids[start : start + PAGE_SIZE]))
        except SpanshError as exc:
            log.info("route: populations not available: %s", exc)
            return
        if not self._current(generation):
            return
        conn.executemany(
            "UPDATE route_stops SET population = ? WHERE system_address = ?",
            [(v.get("population"), k) for k, v in info.items()],
        )
        self.on_change()


def clear(conn: sqlite3.Connection) -> None:
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("DELETE FROM route")
    conn.execute("DELETE FROM route_stops")
    conn.execute("DELETE FROM route_bodies")
    conn.execute("DELETE FROM neutron_plan")  # it led to one of the stops
    conn.execute("COMMIT")


def set_skipped(conn: sqlite3.Connection, seq: int, skipped: bool) -> bool:
    cur = conn.execute("UPDATE route_stops SET skipped = ? WHERE seq = ?", (int(skipped), seq))
    return cur.rowcount > 0


def _rewrite_stops(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> None:
    """Store the stops in this order: numbered from 1, hops from the start recomputed."""
    route = conn.execute("SELECT source FROM route WHERE id = 1").fetchone()
    start = _point(route["source"]) if route else None
    prev = (start.x, start.y, start.z) if start else None
    stops = []
    for seq, r in enumerate(rows, start=1):
        here = (r["x"], r["y"], r["z"])
        hop = round(math.dist(prev, here), 2) if prev else 0.0
        stops.append(
            (seq, r["system_address"], r["name"], *here, hop, r["population"], r["skipped"])
        )
        prev = here
    conn.execute("DELETE FROM route_stops")
    conn.executemany(
        "INSERT INTO route_stops(seq, system_address, name, x, y, z, hop_ly, population, skipped) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
        stops,
    )


def move_stop(conn: sqlite3.Connection, seq: int, position: int) -> bool:
    """Put a stop at `position` (1-based, clamped) and renumber the rest."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        rows = conn.execute("SELECT * FROM route_stops ORDER BY seq").fetchall()
        index = next((i for i, r in enumerate(rows) if r["seq"] == seq), None)
        if index is None:
            conn.execute("ROLLBACK")
            return False
        row = rows.pop(index)
        rows.insert(max(0, min(position - 1, len(rows))), row)
        _rewrite_stops(conn, rows)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return True


def remove_stop(conn: sqlite3.Connection, seq: int) -> bool:
    """Drop a stop (and its bodies) from the route and renumber the rest."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        rows = conn.execute("SELECT * FROM route_stops ORDER BY seq").fetchall()
        gone = next((r for r in rows if r["seq"] == seq), None)
        if gone is None:
            conn.execute("ROLLBACK")
            return False
        conn.execute("DELETE FROM route_bodies WHERE system_address = ?", (gone["system_address"],))
        _rewrite_stops(conn, [r for r in rows if r["seq"] != seq])
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return True


# --------------------------------------------------------------------------- view


def _point(text: str | None) -> RoutePoint | None:
    return RoutePoint(**json.loads(text)) if text else None


def _body_value(b: RouteBodyView, *, low: bool = False) -> int:
    """Mapping payout (kinds that count for mapping) plus the biology estimate."""
    carto = b.mapping_value if b.kind != "bio" else 0
    return carto + (b.bio_min if low else b.bio_max)


def _direct(source: str | None, destination: str | None) -> float | None:
    a, b = _point(source), _point(destination)
    if a is None or b is None:
        return None
    return round(math.dist((a.x, a.y, a.z), (b.x, b.y, b.z)), 2)


def _jumps(distance: float, jump_range: float | None) -> int | None:
    if not jump_range or jump_range <= 0:
        return None
    return max(1, math.ceil(distance / jump_range)) if distance > 0 else 0


def route_view(
    conn: sqlite3.Connection,
    fid: str | None,
    planner: RoutePlanner,
    neutron_planner: neutron.NeutronPlanner | None = None,
) -> RouteView:
    state = cmdr_state(conn, fid)
    jump_range = state["jump_range"] if state else None
    here: tuple[int, tuple[float, float, float] | None, str] | None = None
    if state is not None and state["system_address"] is not None:
        row = conn.execute(
            "SELECT name, x, y, z FROM systems WHERE address = ?", (state["system_address"],)
        ).fetchone()
        if row is not None:
            xyz = (row["x"], row["y"], row["z"]) if row["x"] is not None else None
            here = (state["system_address"], xyz, row["name"])

    route = conn.execute("SELECT * FROM route WHERE id = 1").fetchone()
    error = planner.error
    base = {
        "online": planner.online,
        "building": planner.building,
        "error": error[0] if error else None,
        "error_detail": error[1] if error else None,
        "current_system": here[2] if here else None,
        "current_position": (
            RoutePoint(name=here[2], x=here[1][0], y=here[1][1], z=here[1][2])
            if here is not None and here[1] is not None
            else None
        ),
        "jump_range_ly": jump_range,
    }
    if route is None:
        return RouteView(
            **base,
            params=None,
            created_at=None,
            data_at=None,
            truncated=False,
            source=None,
            destination=None,
            stops=[],
            next_seq=None,
            distance_to_next_ly=None,
            jumps_to_next=None,
            total_value=0,
            collected_value=0,
            total_ly=0.0,
            direct_ly=None,
            remaining_ly=0.0,
            done_count=0,
            skipped_count=0,
            neutron=None,
        )

    # Species you analysed on the route's bodies, and what they paid (incl. bonuses).
    analysed = {
        (r["system_address"], r["body_id"]): (r["n"], r["earned"])
        for r in conn.execute(
            "SELECT o.system_address, o.body_id, COUNT(DISTINCT o.species) AS n, "
            "SUM(COALESCE(o.value, 0) + COALESCE(o.bonus, 0)) AS earned FROM organic_scans o "
            "JOIN route_bodies rb ON rb.system_address = o.system_address "
            "AND rb.body_id = o.body_id WHERE o.fid = ? AND o.status = 'analysed' "
            "GROUP BY o.system_address, o.body_id",
            (fid,),
        )
    }
    bodies: dict[int, list[RouteBodyView]] = {}
    earned = 0
    for b in conn.execute(
        "SELECT rb.*, bc.scanned_at, bc.mapped_at, rs.name AS system_name FROM route_bodies rb "
        "JOIN route_stops rs ON rs.system_address = rb.system_address "
        "LEFT JOIN body_cmdr bc ON bc.fid = ? AND bc.system_address = rb.system_address "
        "AND bc.body_id = rb.body_id ORDER BY rb.distance_ls",
        (fid,),
    ):
        carto = b["kind"] != "bio"
        species, paid = analysed.get((b["system_address"], b["body_id"]), (0, 0))
        mapped = b["mapped_at"] is not None
        done = (not carto or mapped) and species >= b["bio_signals"]
        earned += (b["mapping_value"] if carto and mapped else 0) + (paid or 0)
        genera = (exobio.get_genus(g) for g in json.loads(b["genuses"] or "[]"))
        bodies.setdefault(b["system_address"], []).append(
            RouteBodyView(
                body_id=b["body_id"],
                name=b["name"],
                short_name=short_name(b["name"], b["system_name"]),
                kind=b["kind"],
                distance_ls=b["distance_ls"],
                mapping_value=b["mapping_value"],
                scanned=b["scanned_at"] is not None,
                mapped=mapped,
                bio_signals=b["bio_signals"],
                bio_min=b["bio_min"],
                bio_max=b["bio_max"],
                bio_done=species,
                genuses=sorted(g.genus_name for g in genera if g is not None),
                done=done,
            )
        )
    visited = {
        r[0]
        for r in conn.execute(
            "SELECT rs.system_address FROM route_stops rs WHERE EXISTS ("
            "SELECT 1 FROM visits v WHERE v.fid = ? AND v.system_address = rs.system_address)",
            (fid,),
        )
    }

    params = RouteRequest.model_validate_json(route["params"])
    codex_rows = (
        {
            (b["system_address"], b["body_id"]): json.loads(b["codex"] or "[]")
            for b in conn.execute("SELECT system_address, body_id, codex FROM route_bodies")
        }
        if params.goal == "codex"
        else {}
    )
    index = codex_index(conn, fid) if params.goal == "codex" else {}
    covered: dict[tuple[str, str | None], float] = {}

    stops: list[RouteStopView] = []
    coords: dict[int, tuple[float, float, float]] = {}
    for s in conn.execute("SELECT * FROM route_stops ORDER BY seq"):
        own = bodies.get(s["system_address"], [])
        codex_new = 0.0
        if params.goal == "codex":
            region = regionmap.region_symbol(regionmap.region_at(s["x"], s["z"]))
            own, codex_new = _codex_bodies(
                own, s["system_address"], region, codex_rows, index, covered, bool(s["skipped"])
            )
        coords[s["seq"]] = (s["x"], s["y"], s["z"])
        stops.append(
            RouteStopView(
                seq=s["seq"],
                address=str(s["system_address"]),
                name=s["name"],
                x=s["x"],
                y=s["y"],
                z=s["z"],
                hop_ly=s["hop_ly"],
                jumps=_jumps(s["hop_ly"], jump_range),
                population=s["population"],
                bodies=own,
                value=sum(_body_value(b) for b in own),
                value_min=sum(_body_value(b, low=True) for b in own),
                visited=s["system_address"] in visited,
                done=bool(own) and all(b.done for b in own),
                skipped=bool(s["skipped"]),
                here=here is not None and here[0] == s["system_address"],
                codex_new=round(codex_new, 2),
            )
        )

    nxt = next((s for s in stops if not s.done and not s.skipped), None)
    distance = None
    if nxt is not None and here is not None and here[1] is not None:
        distance = round(math.dist(here[1], coords[nxt.seq]), 2)
    return RouteView(
        **base,
        params=params,
        created_at=route["created_at"],
        data_at=route["data_at"],
        truncated=bool(route["truncated"]),
        source=_point(route["source"]),
        destination=_point(route["destination"]),
        stops=stops,
        next_seq=nxt.seq if nxt else None,
        distance_to_next_ly=distance,
        jumps_to_next=_jumps(distance, jump_range) if distance is not None else None,
        total_value=sum(s.value for s in stops),
        collected_value=earned,
        total_ly=round(sum(s.hop_ly for s in stops), 2),
        direct_ly=_direct(route["source"], route["destination"]),
        remaining_ly=round(sum(s.hop_ly for s in stops if nxt and s.seq >= nxt.seq), 2),
        done_count=sum(1 for s in stops if s.done),
        skipped_count=sum(1 for s in stops if s.skipped and not s.done),
        neutron=neutron.plan_view(
            conn,
            fid,
            neutron_planner,
            int(nxt.address) if nxt else None,
            here[0] if here else None,
            jump_range,
        ),
        codex_left=round(sum(s.codex_new for s in stops if not s.done and not s.skipped), 2),
    )


def _codex_bodies(
    own: list[RouteBodyView],
    address: int,
    region: str | None,
    rows: dict[tuple[int, int], list[list[Any]]],
    index: CodexIndex,
    covered: dict[tuple[str, str | None], float],
    skipped: bool,
) -> tuple[list[RouteBodyView], float]:
    """A codex route stop's bodies with the entries still new (logged since the plan: gone;
    covered by the stops before: less likely), and the new entries the stop is worth."""
    out: list[RouteBodyView] = []
    total = 0.0
    # The chance each entry is logged before: at earlier stops, then at this stop's bodies above.
    cover = dict(covered) if skipped else covered
    for b in own:
        species: dict[tuple[str, str | None], float] = {}
        if not b.done:
            for key, symbol, colour, weight in rows.get((address, b.body_id), []):
                if codex_status(index, key, region) == "logged":
                    continue
                before = cover.get((key, region), 0.0)
                chance = weight * (1.0 - before)
                total += chance
                cover[(key, region)] = before + chance
                sp = exobio.get_species(symbol)
                name = sp.species_name if sp else symbol
                species[(name, colour)] = species.get((name, colour), 0.0) + chance
        listed = [
            RouteCodexView(species=name, colour=colour, chance=round(min(chance, 1.0), 2))
            for (name, colour), chance in sorted(species.items(), key=lambda kv: -kv[1])
            if chance >= 0.01
        ]
        out.append(b.model_copy(update={"codex": listed}))
    return out, total

"""Past game sessions for the Session tab: when you played, for how long, and what it brought.

A session is one game run: from loading the commander (the first `LoadGame`) to quitting
(`Shutdown`), or to the last event of the run when the game crashed. Every launch of the game
starts a new journal file (`Fileheader`, part 1; parts 2+ continue the same run), so going back
to the main menu and loading again (another game mode) stays in the same session; loading
another commander starts a new one.

What a session earned is the data gathered in it, sold or not (not what was sold then): the
bodies scanned and mapped, by their estimated value, and the species analysed (their sale value
once sold). Data lost on a death since is counted apart, in the session that gathered it.
"""

from __future__ import annotations

import bisect
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime

from app import exobio
from app.facts import facts_from_json
from app.schemas import SessionCodexEntry, SessionEntry, SessionsView
from app.values import estimate_body_value
from app.views import cmdr_state

CODEX_CATEGORIES = {
    "$Codex_Category_Biology;": "bio",
    "$Codex_Category_StellarBodies;": "stellar",
}


@dataclass(slots=True)
class _Run:
    fid: str | None
    start_ts: str
    end_ts: str = ""
    shutdown: bool = False
    jumps: int = 0
    distance_ly: float = 0.0
    systems: set[int] = field(default_factory=set)
    bodies_scanned: int = 0
    bodies_mapped: int = 0
    species: int = 0
    first_discoveries: int = 0
    first_mapped: int = 0
    first_footfalls: int = 0
    carto: int = 0
    bio: int = 0
    lost: int = 0
    deaths: int = 0
    codex: list[SessionCodexEntry] = field(default_factory=list)


def _last_ts_before(conn: sqlite3.Connection, event_id: int | None) -> str | None:
    """Time of the last event before `event_id` (of all, for None)."""
    row = conn.execute(
        "SELECT ts FROM events WHERE id < ? ORDER BY id DESC LIMIT 1",
        (event_id if event_id is not None else 2**63 - 1,),
    ).fetchone()
    return row["ts"] if row else None


def _runs(conn: sqlite3.Connection) -> list[_Run]:
    """Game runs of every commander, oldest first (insertion order)."""
    runs: list[_Run] = []
    current: _Run | None = None

    def close(end_ts: str | None, shutdown: bool) -> None:
        nonlocal current
        if current is not None:
            current.end_ts = max(end_ts or current.start_ts, current.start_ts)
            current.shutdown = shutdown
            runs.append(current)
        current = None

    for row in conn.execute(
        "SELECT e.id, e.ts, e.event, f.part, "
        "CASE WHEN e.event = 'LoadGame' THEN json_extract(e.raw, '$.FID') END AS fid "
        "FROM events e LEFT JOIN journal_files f ON f.id = e.file_id "
        "WHERE e.event IN ('Fileheader', 'LoadGame', 'Shutdown') ORDER BY e.id"
    ):
        if row["event"] == "Fileheader":
            if (row["part"] or 1) == 1 and current is not None:
                close(_last_ts_before(conn, row["id"]), shutdown=False)  # the game crashed
        elif row["event"] == "LoadGame":
            if current is not None and current.fid == row["fid"]:
                continue  # back from the main menu
            if current is not None:
                close(_last_ts_before(conn, row["id"]), shutdown=False)
            current = _Run(fid=row["fid"], start_ts=row["ts"])
        elif current is not None:
            close(row["ts"], shutdown=True)
    if current is not None:
        close(_last_ts_before(conn, None), shutdown=False)
    return runs


class _Index:
    """Finds the run a moment belongs to (runs do not overlap in time)."""

    def __init__(self, runs: list[_Run]) -> None:
        self.runs = sorted(runs, key=lambda r: r.start_ts)
        self.starts = [r.start_ts for r in self.runs]

    def at(self, ts: str | None) -> _Run | None:
        if not ts:
            return None
        i = bisect.bisect_right(self.starts, ts) - 1
        if i < 0 or ts > self.runs[i].end_ts:
            return None
        return self.runs[i]


def _duration_s(start: str, end: str) -> int:
    def parse(ts: str) -> datetime:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))

    try:
        return max(0, round((parse(end) - parse(start)).total_seconds()))
    except ValueError:
        return 0


def sessions_view(conn: sqlite3.Connection, fid: str | None) -> SessionsView:
    every = _runs(conn)
    latest = max(every, key=lambda r: r.start_ts, default=None)
    runs = [r for r in every if r.fid is None or r.fid == fid]
    index = _Index(runs)
    state = cmdr_state(conn, fid)
    odyssey = bool(state["odyssey"]) if state else True

    for row in conn.execute("SELECT ts, distance_ly FROM jumps WHERE fid = ?", (fid,)):
        if run := index.at(row["ts"]):
            run.jumps += 1
            run.distance_ly += row["distance_ly"]
    for row in conn.execute("SELECT ts, system_address FROM visits WHERE fid = ?", (fid,)):
        if run := index.at(row["ts"]):
            run.systems.add(row["system_address"])
    for row in conn.execute("SELECT ts FROM deaths WHERE fid = ?", (fid,)):
        if run := index.at(row["ts"]):
            run.deaths += 1

    for row in conn.execute(
        "SELECT bc.scanned_at, bc.mapped_at, bc.efficient, bc.carto, bc.footfall_at, b.facts "
        "FROM body_cmdr bc JOIN bodies b "
        "ON b.system_address = bc.system_address AND b.body_id = bc.body_id WHERE bc.fid = ?",
        (fid,),
    ):
        facts = facts_from_json(row["facts"])
        mapped = bool(row["mapped_at"]) and facts.kind == "planet"
        value = estimate_body_value(
            facts, odyssey=odyssey, efficient=not mapped or bool(row["efficient"])
        )
        if run := index.at(row["scanned_at"] or row["mapped_at"]):
            run.bodies_scanned += 1
            run.first_discoveries += facts.was_discovered is False
            if row["carto"] == "lost":
                run.lost += value.fss  # the mapping went with it
            else:
                run.carto += value.fss
        if mapped and (run := index.at(row["mapped_at"])):
            run.bodies_mapped += 1
            run.first_mapped += facts.was_mapped is False
            run.carto += value.dss - value.fss
        if run := index.at(row["footfall_at"]):
            run.first_footfalls += 1

    for scan in conn.execute(
        "SELECT species, value, bonus, sale, started_at, updated_at FROM organic_scans "
        "WHERE fid = ? AND status = 'analysed'",
        (fid,),
    ):
        # A loss rewrites updated_at with the time of death: the first sample is the closest.
        lost = scan["sale"] == "lost"
        if not (run := index.at(scan["started_at"] if lost else scan["updated_at"])):
            continue
        value = scan["value"]
        if value is None:
            species = exobio.get_species(scan["species"])
            value = species.base_value if species else 0
        value += scan["bonus"] or 0
        run.species += 1
        if lost:
            run.lost += value
        else:
            run.bio += value

    # The game's own mark: a first entry in your codex (for that region).
    for row in conn.execute("SELECT ts, raw FROM events WHERE event = 'CodexEntry' ORDER BY id"):
        if not (run := index.at(row["ts"])):
            continue
        ev = json.loads(row["raw"])
        if not ev.get("IsNewEntry"):
            continue
        run.codex.append(
            SessionCodexEntry(
                name=str(ev.get("Name_Localised") or ev.get("Name") or "?"),
                category=CODEX_CATEGORIES.get(str(ev.get("Category")), "other"),
            )
        )

    return SessionsView(
        sessions=[
            SessionEntry(
                started_at=r.start_ts,
                ended_at=r.end_ts,
                open=r is latest and not r.shutdown,
                duration_s=_duration_s(r.start_ts, r.end_ts),
                jumps=r.jumps,
                distance_ly=round(r.distance_ly, 2),
                systems=len(r.systems),
                bodies_scanned=r.bodies_scanned,
                bodies_mapped=r.bodies_mapped,
                species_analysed=r.species,
                first_discoveries=r.first_discoveries,
                first_mapped=r.first_mapped,
                first_footfalls=r.first_footfalls,
                carto_value=r.carto,
                bio_value=r.bio,
                value=r.carto + r.bio,
                lost_value=r.lost,
                deaths=r.deaths,
                codex=r.codex,
            )
            for r in sorted(runs, key=lambda r: r.start_ts, reverse=True)
        ]
    )

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app import db, sessions
from app.facts import facts_from_json
from app.projector import Projector
from app.values import estimate_body_value

A, B = 1001, 2002
NAMES = {A: "Alpha", B: "Beta"}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    return c


class Journal:
    """Writes events as the ingest does: one journal file per game launch."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.proj = Projector(conn)
        self.file_id = 0
        self.line = 0

    def launch(self, ts: str, part: int = 1) -> None:
        cur = self.conn.execute(
            "INSERT INTO journal_files(name, header_ts, part) VALUES(?, ?, ?)",
            (f"Journal.{ts}.{part:02}.log", ts, part),
        )
        self.file_id, self.line = int(cur.lastrowid), 0
        self.write({"timestamp": ts, "event": "Fileheader", "part": part})

    def write(self, *events: dict) -> None:
        for ev in events:
            self.line += 1
            cur = self.conn.execute(
                "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(?, ?, ?, ?, ?)",
                (self.file_id, self.line, ev["timestamp"], ev["event"], json.dumps(ev)),
            )
            self.proj.apply(ev, int(cur.lastrowid))


def load(ts: str, fid: str = "F1") -> dict:
    return {"timestamp": ts, "event": "LoadGame", "FID": fid, "Commander": fid, "Odyssey": True}


def shutdown(ts: str) -> dict:
    return {"timestamp": ts, "event": "Shutdown"}


def jump(address: int, ts: str, dist: float = 10.0) -> dict:
    return {
        "timestamp": ts,
        "event": "FSDJump",
        "StarSystem": NAMES[address],
        "SystemAddress": address,
        "StarPos": [float(address), 0.0, 0.0],
        "JumpDist": dist,
    }


def planet(address: int, body_id: int, ts: str, **extra: object) -> dict:
    ev = {
        "timestamp": ts,
        "event": "Scan",
        "ScanType": "Detailed",
        "BodyName": f"{NAMES[address]} {body_id}",
        "BodyID": body_id,
        "StarSystem": NAMES[address],
        "SystemAddress": address,
        "WasDiscovered": False,
        "WasMapped": False,
        "PlanetClass": "High metal content body",
        "TerraformState": "Terraformable",
        "Atmosphere": "",
        "MassEM": 0.5,
        "Radius": 4.0e6,
        "SurfaceGravity": 5.0,
        "SurfaceTemperature": 200.0,
        "Landable": True,
        "DistanceFromArrivalLS": 500.0,
    }
    ev.update(extra)
    return ev


def mapped(address: int, body_id: int, ts: str) -> dict:
    return {
        "timestamp": ts,
        "event": "SAAScanComplete",
        "SystemAddress": address,
        "BodyID": body_id,
        "ProbesUsed": 4,
        "EfficiencyTarget": 6,
    }


def organic(ts: str, scan_type: str, body_id: int = 1) -> dict:
    return {
        "timestamp": ts,
        "event": "ScanOrganic",
        "ScanType": scan_type,
        "Genus": "$Codex_Ent_Bacterial_Genus_Name;",
        "Species": "$Codex_Ent_Bacterial_01_Name;",
        "Species_Localised": "Bacterium Aurasus",
        "SystemAddress": A,
        "Body": body_id,
    }


def codex(ts: str, name: str, new: bool, category: str = "$Codex_Category_Biology;") -> dict:
    ev = {
        "timestamp": ts,
        "event": "CodexEntry",
        "EntryID": 1,
        "Name": f"${name};",
        "Name_Localised": name,
        "Category": category,
        "Region": "$Codex_RegionName_18;",
        "System": NAMES[A],
        "SystemAddress": A,
    }
    if new:
        ev["IsNewEntry"] = True
    return ev


def values(conn: sqlite3.Connection, body_id: int) -> tuple[int, int]:
    row = conn.execute("SELECT facts FROM bodies WHERE body_id = ?", (body_id,)).fetchone()
    v = estimate_body_value(facts_from_json(row["facts"]), odyssey=True, efficient=True)
    return v.fss, v.dss


def test_a_session_is_one_game_run(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.launch("2026-10-10T09:00:00Z")  # launched and quit at the menu: no session
    j.write(shutdown("2026-10-10T09:05:00Z"))
    j.launch("2026-10-10T10:00:00Z")
    j.write(
        load("2026-10-10T10:02:00Z"),
        jump(A, "2026-10-10T10:30:00Z"),
        load("2026-10-10T11:00:00Z"),  # back from the main menu (another game mode)
        jump(B, "2026-10-10T11:30:00Z"),
    )
    j.launch("2026-10-10T12:00:00Z", part=2)  # the same run, a new part of the journal
    j.write(jump(A, "2026-10-10T12:10:00Z"), shutdown("2026-10-10T12:15:00Z"))
    j.launch("2026-10-11T08:00:00Z")
    j.write(load("2026-10-11T08:01:00Z"), jump(B, "2026-10-11T08:20:00Z", 7.5))
    # The game crashed: no Shutdown, the next launch closes the run at its last event.
    j.launch("2026-10-11T19:00:00Z")
    j.write(load("2026-10-11T19:01:00Z"), jump(A, "2026-10-11T19:05:00Z"))

    view = sessions.sessions_view(conn, "F1")
    got = [(s.started_at, s.ended_at, s.open, s.jumps) for s in view.sessions]
    assert got == [
        ("2026-10-11T19:01:00Z", "2026-10-11T19:05:00Z", True, 1),
        ("2026-10-11T08:01:00Z", "2026-10-11T08:20:00Z", False, 1),
        ("2026-10-10T10:02:00Z", "2026-10-10T12:15:00Z", False, 3),
    ]
    first = view.sessions[2]
    assert first.duration_s == 2 * 3600 + 13 * 60
    assert first.distance_ly == 30.0
    assert first.systems == 2  # A, B, and A again
    assert view.sessions[1].distance_ly == 7.5


def test_another_commander_has_own_sessions(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.launch("2026-10-10T10:00:00Z")
    j.write(load("2026-10-10T10:01:00Z"), jump(A, "2026-10-10T10:10:00Z"))
    j.write(load("2026-10-10T11:00:00Z", fid="F2"), jump(B, "2026-10-10T11:10:00Z"))
    j.write(shutdown("2026-10-10T11:30:00Z"))

    one = sessions.sessions_view(conn, "F1").sessions
    two = sessions.sessions_view(conn, "F2").sessions
    assert [(s.started_at, s.ended_at, s.open) for s in one] == [
        ("2026-10-10T10:01:00Z", "2026-10-10T10:10:00Z", False)
    ]
    assert [(s.started_at, s.ended_at, s.jumps) for s in two] == [
        ("2026-10-10T11:00:00Z", "2026-10-10T11:30:00Z", 1)
    ]


def test_what_a_session_earned(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.launch("2026-10-10T10:00:00Z")
    j.write(
        load("2026-10-10T10:01:00Z"),
        jump(A, "2026-10-10T10:10:00Z"),
        planet(A, 1, "2026-10-10T10:11:00Z"),
        planet(A, 2, "2026-10-10T10:12:00Z", WasDiscovered=True),
        organic("2026-10-10T10:20:00Z", "Log"),
        organic("2026-10-10T10:25:00Z", "Sample"),
        codex("2026-10-10T10:20:01Z", "Bacterium Aurasus - Teal", new=True),
        codex("2026-10-10T10:20:02Z", "Bacterium Aurasus - Teal", new=False),
        shutdown("2026-10-10T11:00:00Z"),
    )
    j.launch("2026-10-11T10:00:00Z")
    j.write(
        load("2026-10-11T10:01:00Z"),
        organic("2026-10-11T10:05:00Z", "Analyse"),  # finished a day later
        mapped(A, 1, "2026-10-11T10:10:00Z"),
        codex("2026-10-11T10:11:00Z", "Metal world", True, "$Codex_Category_StellarBodies;"),
        shutdown("2026-10-11T11:00:00Z"),
    )
    second, first = sessions.sessions_view(conn, "F1").sessions
    fss1, dss1 = values(conn, 1)
    fss2, _ = values(conn, 2)
    bio = conn.execute("SELECT value FROM organic_scans WHERE status = 'analysed'").fetchone()[0]

    assert (first.bodies_scanned, first.first_discoveries, first.bodies_mapped) == (2, 1, 0)
    assert first.carto_value == fss1 + fss2
    assert first.bio_value == 0 and first.species_analysed == 0
    assert [(c.name, c.category) for c in first.codex] == [("Bacterium Aurasus - Teal", "bio")]

    assert (second.bodies_scanned, second.bodies_mapped, second.first_mapped) == (0, 1, 1)
    assert second.carto_value == dss1 - fss1  # the mapping's share
    assert second.species_analysed == 1 and second.bio_value == bio > 0
    assert second.value == second.carto_value + second.bio_value
    assert [c.category for c in second.codex] == ["stellar"]


def test_data_lost_on_death_counts_where_it_was_gathered(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.launch("2026-10-10T10:00:00Z")
    j.write(
        load("2026-10-10T10:01:00Z"),
        jump(A, "2026-10-10T10:10:00Z"),
        planet(A, 1, "2026-10-10T10:11:00Z"),
        mapped(A, 1, "2026-10-10T10:15:00Z"),
        organic("2026-10-10T10:20:00Z", "Log"),
        organic("2026-10-10T10:22:00Z", "Sample"),
        organic("2026-10-10T10:24:00Z", "Analyse"),
        shutdown("2026-10-10T11:00:00Z"),
    )
    j.launch("2026-10-11T10:00:00Z")
    j.write(
        load("2026-10-11T10:01:00Z"),
        {"timestamp": "2026-10-11T10:30:00Z", "event": "Died"},
        shutdown("2026-10-11T11:00:00Z"),
    )
    second, first = sessions.sessions_view(conn, "F1").sessions
    fss, _ = values(conn, 1)
    bio = conn.execute("SELECT value FROM organic_scans WHERE status = 'analysed'").fetchone()[0]

    assert first.value == 0
    assert first.lost_value == fss + bio  # the mapping went with the ship
    assert (first.bodies_scanned, first.species_analysed, first.deaths) == (1, 1, 0)
    assert (second.value, second.lost_value, second.deaths) == (0, 0, 1)


def test_no_journal_no_sessions(conn: sqlite3.Connection) -> None:
    assert sessions.sessions_view(conn, None).sessions == []

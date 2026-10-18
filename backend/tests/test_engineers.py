from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path

import pytest

from app import db, engineers, galaxy
from app.projector import Projector

CMDR = {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}
COLONIA = (-9530.5, -910.28125, 19808.125)


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


def feed(conn: sqlite3.Connection, *events: dict) -> None:
    proj = Projector(conn)
    for ev in events:
        n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (n, ev["timestamp"], ev["event"], json.dumps(ev)),
        )
        proj.apply(ev, int(cur.lastrowid))


def test_the_list() -> None:
    names = [e.name for e in engineers.ENGINEERS]
    assert len(names) == len(set(names)) == 38
    assert sum(e.kind == "ship" for e in engineers.ENGINEERS) == 25
    assert sum(e.kind == "suit" for e in engineers.ENGINEERS) == 13
    near_colonia = {
        e.name for e in engineers.ENGINEERS if math.dist((e.x, e.y, e.z), COLONIA) < 200
    }
    assert near_colonia == {
        "Etienne Dorn",
        "Marsha Hicks",
        "Mel Brandon",
        "Petra Olmanova",
        "Baltanos",
        "Eleanor Bresa",
        "Rosa Dayette",
        "Yi Shen",
    }
    sol = next(e for e in engineers.ENGINEERS if e.name == "Colonel Bris Dekker")
    assert (sol.system, sol.address, sol.x) == ("Sol", 10477373803, 0)


def test_your_standing_from_the_journal(conn: sqlite3.Connection) -> None:
    feed(
        conn,
        CMDR,
        {
            "timestamp": "2026-10-17T10:00:05Z",
            "event": "EngineerProgress",
            "Engineers": [
                {"Engineer": "Felicity Farseer", "EngineerID": 300100, "Progress": "Invited"},
                {
                    "Engineer": "The Dweller",
                    "EngineerID": 300180,
                    "Progress": "Unlocked",
                    "RankProgress": 0,
                    "Rank": 1,
                },
                {"Engineer": "Domino Green", "EngineerID": 400002, "Progress": "Known"},
            ],
        },
        # Later, one at a time.
        {
            "timestamp": "2026-10-17T11:00:00Z",
            "event": "EngineerProgress",
            "Engineer": "Felicity Farseer",
            "EngineerID": 300100,
            "Progress": "Unlocked",
            "Rank": 1,
        },
        {
            "timestamp": "2026-10-17T11:30:00Z",
            "event": "EngineerProgress",
            "Engineer": "The Dweller",
            "EngineerID": 300180,
            "Rank": 2,
            "RankProgress": 0,
            "Progress": "Unlocked",
        },
    )
    view = {e.name: e for e in galaxy.galaxy_view(conn, "F1", [], []).engineers}
    assert len(view) == 38
    assert (view["Felicity Farseer"].progress, view["Felicity Farseer"].rank) == ("unlocked", 1)
    assert (view["The Dweller"].progress, view["The Dweller"].rank) == ("unlocked", 2)
    assert view["Domino Green"].progress == "known" and view["Domino Green"].kind == "suit"
    assert view["Ram Tah"].progress is None

"""Time spent in systems and at planets (app.projector._spend_time) and where it shows."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app import db, history, views
from app.facts import facts_from_json
from app.projector import AFK_GAP_S, Projector
from app.values import estimate_body_value

A, B = 1001, 2002
NAMES = {A: "Alpha", B: "Beta"}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


class Journal:
    """Writes events as the ingest does; `restart()` is the app started again."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.proj = Projector(conn)
        self.line = 0

    def write(self, *events: dict) -> None:
        for ev in events:
            self.line += 1
            cur = self.conn.execute(
                "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
                (self.line, ev["timestamp"], ev["event"], json.dumps(ev)),
            )
            self.proj.apply(ev, int(cur.lastrowid))

    def restart(self) -> None:
        self.proj = Projector(self.conn)


def at(minute: float) -> str:
    """A moment of 2026-10-20, in minutes from 10:00."""
    s = round(minute * 60)
    return f"2026-10-20T{10 + s // 3600:02}:{s // 60 % 60:02}:{s % 60:02}Z"


def ev(minute: float, event: str, **extra: object) -> dict:
    return {"timestamp": at(minute), "event": event, **extra}


def load(minute: float) -> dict:
    return ev(minute, "LoadGame", FID="F1", Commander="T", Odyssey=True)


def jump(address: int, minute: float) -> dict:
    return ev(
        minute,
        "FSDJump",
        StarSystem=NAMES[address],
        SystemAddress=address,
        StarPos=[float(address), 0.0, 0.0],
        JumpDist=10.0,
    )


def approach(body_id: int, minute: float, event: str = "ApproachBody") -> dict:
    return ev(
        minute, event, StarSystem=NAMES[A], SystemAddress=A, Body=f"Alpha {body_id}", BodyID=body_id
    )


def system_time(conn: sqlite3.Connection, address: int) -> int:
    row = conn.execute(
        "SELECT SUM(seconds) AS s FROM visits WHERE system_address = ?", (address,)
    ).fetchone()
    return row["s"] or 0


def body_time(conn: sqlite3.Connection, body_id: int) -> int:
    row = conn.execute("SELECT seconds FROM body_time WHERE body_id = ?", (body_id,)).fetchone()
    return row["seconds"] if row else 0


def test_time_goes_to_the_system_you_were_in(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.write(load(0), jump(A, 1), ev(5, "FSSDiscoveryScan"), ev(12, "StartJump"), jump(B, 12.5))
    j.write(ev(20, "Scan"))
    assert system_time(conn, A) == 11.5 * 60  # arrival to the jump out, witch-space included
    assert system_time(conn, B) == 7.5 * 60
    # The time before arriving anywhere (load to the first jump) has no system to go to.
    assert conn.execute("SELECT SUM(seconds) FROM visits").fetchone()[0] == 19 * 60


def test_a_long_silence_is_afk_and_not_counted(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    afk = AFK_GAP_S / 60
    j.write(load(0), jump(A, 0))
    j.write(ev(afk, "Scan"))  # just within: counted
    j.write(ev(2 * afk + 1, "Scan"))  # a minute too long: not counted at all
    j.write(ev(2 * afk + 3, "Scan"))
    assert system_time(conn, A) == AFK_GAP_S + 2 * 60


def test_menu_launcher_and_quitting_are_not_counted(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.write(load(0), jump(A, 0), ev(10, "Scan"))
    j.write(ev(15, "Shutdown"))  # the time before quitting: the menu, most likely
    j.write(ev(20, "Fileheader"), ev(25, "Commander", FID="F1", Name="T"), load(26))
    j.write(ev(26, "Location", StarSystem="Alpha", SystemAddress=A, StarPos=[0.0, 0.0, 0.0]))
    j.write(ev(27, "Scan"))
    j.write(load(40))  # back from the main menu
    j.write(ev(42, "Scan"))
    assert system_time(conn, A) == (10 + 1 + 2) * 60
    assert (
        conn.execute("SELECT COUNT(*) FROM visits").fetchone()[0] == 1
    )  # one visit, relogs and all


def test_time_at_a_planet_is_from_approach_to_leaving(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.write(load(0), jump(A, 0), approach(3, 5), approach(3, 8, "Touchdown"))
    j.write(ev(20, "Disembark", OnPlanet=True), ev(50, "Embark"), ev(52, "Liftoff"))
    j.write(ev(55, "LeaveBody", SystemAddress=A, BodyID=3), ev(60, "Scan"))
    assert body_time(conn, 3) == 50 * 60
    assert system_time(conn, A) == 60 * 60


def test_the_count_goes_on_after_a_restart_of_the_app(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    j.write(load(0), jump(A, 0), approach(3, 5))
    j.restart()
    j.write(ev(9, "Scan"))  # the gap from the last stored event counts
    assert system_time(conn, A) == 9 * 60
    assert body_time(conn, 3) == 4 * 60


def test_views_show_time_and_what_was_earned(conn: sqlite3.Connection) -> None:
    j = Journal(conn)
    planet = ev(
        6,
        "Scan",
        ScanType="Detailed",
        BodyName="Alpha 3",
        BodyID=3,
        StarSystem="Alpha",
        SystemAddress=A,
        WasDiscovered=True,
        WasMapped=True,
        PlanetClass="High metal content body",
        MassEM=0.5,
        Radius=4.0e6,
        Landable=True,
        DistanceFromArrivalLS=500.0,
    )
    j.write(load(0), jump(A, 0), approach(3, 5), planet)
    j.write(*(ev(m, "Scan") for m in (20, 35, 50, 65)), jump(B, 70))

    facts = facts_from_json(conn.execute("SELECT facts FROM bodies").fetchone()["facts"])
    fss = estimate_body_value(facts, odyssey=True, efficient=True).fss
    system = views.system_view(conn, "F1", A)
    assert (system.time_s, system.earned_value) == (70 * 60, fss)
    assert system.time_as_of == at(70)
    body = next(b for b in system.bodies if b.body_id == 3)
    assert (body.time_s, body.earned_value) == (65 * 60, fss)

    seen = history.history_view(conn, "F1")
    assert {e.name: e.time_s for e in seen.systems} == {"Alpha": 70 * 60, "Beta": 0}
    assert seen.time_as_of == at(70)

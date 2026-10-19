from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, enrich, galaxy, history, notes, views
from app.config import Settings
from app.main import create_app
from app.projector import Projector
from tests.test_history import CMDR, A, B, arrive, feed, planet


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    return Projector(conn)


def test_notes_on_systems_and_bodies(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(A, "2026-10-16T17:00:05Z", "Location"),
        arrive(B, "2026-10-16T17:40:00Z"),
        planet(B, 5, "2026-10-16T17:42:00Z", "Water world"),
    )
    notes.save(conn, B, notes.SYSTEM, "  come back for the bio  ")
    notes.save(conn, B, 5, "landable? check")
    view = views.system_view(conn, "F1", B)
    assert view.note == "come back for the bio"  # trimmed
    assert {b.body_id: b.note for b in view.bodies} == {5: "landable? check"}

    # Name and position come from the journal when the UI does not send them.
    row = conn.execute("SELECT system_name, x FROM notes WHERE body_id = -1").fetchone()
    assert row["system_name"] == "Beta" and row["x"] == float(B)

    entries = {e.name: e for e in history.history_view(conn, "F1").systems}
    assert entries["Beta"].note == "come back for the bio" and entries["Beta"].body_notes == 1
    assert entries["Alpha"].note is None and entries["Alpha"].body_notes == 0

    placed = galaxy.galaxy_view(conn, "F1", [], []).notes
    assert [(n.name, n.text) for n in placed] == [("Beta", "come back for the bio")]

    notes.save(conn, B, 5, "   ")  # empty: deleted
    assert notes.of_system(conn, B) == {notes.SYSTEM: "come back for the bio"}


def test_note_on_a_system_you_have_not_been_to(conn: sqlite3.Connection) -> None:
    # Ahead on a route: the UI sends the name and the position.
    notes.save(conn, 77, notes.SYSTEM, "probably untouched", system_name="Far", pos=(1, 2, 3))
    assert views.system_view(conn, None, 77).note == "probably untouched"
    placed = galaxy.galaxy_view(conn, None, [], []).notes
    assert [(n.address, n.name, n.x, n.z) for n in placed] == [("77", "Far", 1.0, 3.0)]

    # From the community data once it is in; a later edit keeps what was known.
    enrich.store(
        conn, enrich.ExternalSystem(address=88, source=None, name="Known", star_pos=(4, 5, 6))
    )
    notes.save(conn, 88, notes.SYSTEM, "seen on the galaxy map")
    notes.save(conn, 88, notes.SYSTEM, "edited")
    row = conn.execute(
        "SELECT system_name, x, text FROM notes WHERE system_address = 88"
    ).fetchone()
    assert tuple(row) == ("Known", 4.0, "edited")


def test_put_note_api(tmp_path: Path) -> None:
    settings = Settings(
        journal_dir=tmp_path / "journals", data_dir=tmp_path / "data", static_dir=None, online=False
    )
    with TestClient(create_app(settings)) as client:
        body = {
            "systemAddress": "2931055102291",
            "text": "mine",
            "systemName": "X",
            "x": 1,
            "y": 2,
            "z": 3,
        }
        assert client.put("/api/notes", json=body).status_code == 204
        view = client.get("/api/view/system", params={"address": 2931055102291}).json()
        assert view["note"] == "mine"
        galaxy_notes = client.get("/api/view/galaxy").json()["notes"]
        assert galaxy_notes == [
            {"address": "2931055102291", "name": "X", "x": 1.0, "y": 2.0, "z": 3.0, "text": "mine"}
        ]
        body_note = {"systemAddress": "2931055102291", "bodyId": 3, "text": "ring"}
        assert client.put("/api/notes", json=body_note).status_code == 204
        assert client.put("/api/notes", json={"systemAddress": "x", "text": "a"}).status_code == 422
        assert client.put("/api/notes", json={**body, "text": ""}).status_code == 204
        assert client.get("/api/view/galaxy").json()["notes"] == []

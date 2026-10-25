"""Keeping the database small (compressed Spansh pages, dropped community bodies, freed pages)
and moving it to another folder."""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app import datadir, db, enrich, spansh, views
from app.config import Settings
from app.main import create_app

SA = 1183632560866


def connect(path: Path) -> sqlite3.Connection:
    conn = db.connect(path)
    db.init_schema(conn)
    return conn


def test_new_database_gives_freed_pages_back(tmp_path: Path) -> None:
    conn = connect(tmp_path / "data.db")
    assert conn.execute("PRAGMA auto_vacuum").fetchone()[0] == 2  # incremental from the start
    conn.execute("BEGIN")
    conn.executemany(
        "INSERT INTO spansh_pages(key, fetched_at, data) VALUES(?, '2026-01-01T00:00:00', ?)",
        [(str(i), bytes(range(256)) * 40) for i in range(400)],
    )
    conn.execute("COMMIT")
    db.compact(conn)
    full = datadir.db_bytes(tmp_path)
    conn.execute("DELETE FROM spansh_pages")
    db.compact(conn)
    assert datadir.db_bytes(tmp_path) < full / 4
    assert conn.execute("PRAGMA freelist_count").fetchone()[0] == 0


def test_old_database_is_rewritten_once(tmp_path: Path) -> None:
    path = tmp_path / "data.db"
    old = sqlite3.connect(path)  # made before 2026-10-25: no auto-vacuum, text Spansh pages
    old.execute(
        "CREATE TABLE spansh_pages(key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, "
        "data TEXT NOT NULL) STRICT"
    )
    old.execute("INSERT INTO spansh_pages VALUES('k', '2026-01-01T00:00:00', '{}')")
    old.commit()
    old.close()

    conn = connect(path)
    # The text cache is gone, the table takes compressed pages now.
    assert conn.execute("SELECT COUNT(*) FROM spansh_pages").fetchone()[0] == 0
    types = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(spansh_pages)")}
    assert types["data"] == "BLOB"
    assert conn.execute("PRAGMA auto_vacuum").fetchone()[0] == 0
    db.compact(conn)
    assert conn.execute("PRAGMA auto_vacuum").fetchone()[0] == 2


def test_spansh_pages_are_stored_compressed(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "data.db"
    connect(path).close()
    page = {
        "results": [
            {"name": f"Body {i}", "subtype": "High metal content world"} for i in range(200)
        ]
    }
    monkeypatch.setattr(spansh, "_post", lambda url, payload: page)
    search = spansh.CachedSearch(path)
    assert search.bodies({}, {"reference_system": "Sol"}, 0)["results"][0]["name"] == "Body 0"
    search.close()
    raw = sqlite3.connect(path).execute("SELECT data FROM spansh_pages").fetchone()[0]
    assert isinstance(raw, bytes) and len(raw) * 5 < len(json.dumps(page))
    again = spansh.CachedSearch(path)
    assert again.bodies({}, {"reference_system": "Sol"}, 0)["results"][199]["name"] == "Body 199"
    assert again.requests == 0
    again.close()


def store_system(conn: sqlite3.Connection, address: int, fetched_at: datetime) -> None:
    conn.execute(
        "INSERT INTO ext_systems(address, source, fetched_at, ok, body_count, name) "
        "VALUES(?, 'spansh', ?, 1, 1, 'Somewhere')",
        (address, fetched_at.isoformat(timespec="seconds")),
    )
    conn.execute(
        "INSERT INTO ext_bodies(system_address, body_id, facts, signals, genuses) "
        "VALUES(?, 1, '{}', '{}', '[]')",
        (address,),
    )


def test_community_bodies_of_old_lookups_are_dropped(tmp_path: Path) -> None:
    conn = connect(tmp_path / "data.db")
    now = datetime.now(UTC)
    store_system(conn, 1, now - timedelta(days=40))
    store_system(conn, 2, now - timedelta(days=40))  # where you are: kept
    store_system(conn, 3, now - timedelta(days=2))
    assert enrich.prune(conn, keep=2, now=now) == 1
    left = {r[0] for r in conn.execute("SELECT system_address FROM ext_bodies")}
    assert left == {2, 3}
    # The system keeps its name; opening it asks the databases again.
    assert (
        conn.execute("SELECT name FROM ext_systems WHERE address = 1").fetchone()[0] == "Somewhere"
    )
    assert enrich.bodies_dropped(conn, 1) and not enrich.bodies_dropped(conn, 3)
    assert enrich.needs_fetch(conn, 1)
    assert views._lookup(conn, 1, online=True) == "pending"
    assert views._lookup(conn, 1, online=False) == "offline"
    assert views._lookup(conn, 3, online=True) is None
    assert enrich.prune(conn, keep=None, now=now) == 1  # now the current one too


def put_db(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    conn = connect(folder / "data.db")
    conn.execute("INSERT INTO meta(key, value) VALUES('marker', 'here')")
    conn.close()


def test_move_waits_for_the_next_start(tmp_path: Path) -> None:
    home, target = tmp_path / "home", tmp_path / "D" / "EDK"
    put_db(home)
    assert datadir.resolve(home) == home  # nothing chosen

    moved, problem = datadir.plan_move(home, home, f'"{target}"')
    assert (moved, problem) == (target, None)
    assert datadir.pending_move(home) == target
    assert (home / "data.db").exists()  # not before the next start

    assert datadir.resolve(home) == target
    assert not (home / "data.db").exists()
    conn = sqlite3.connect(target / "data.db")
    assert conn.execute("SELECT value FROM meta WHERE key = 'marker'").fetchone()[0] == "here"
    conn.close()
    assert datadir.pending_move(home) is None
    assert datadir.resolve(home) == target  # and stays there

    # Back to the standard folder.
    assert datadir.plan_move(home, target, str(home)) == (home, None)
    assert datadir.resolve(home) == home and (home / "data.db").exists()
    assert not (home / datadir.POINTER).exists()


def test_move_refuses_unfit_folders(tmp_path: Path) -> None:
    home = tmp_path / "home"
    put_db(home)
    assert datadir.plan_move(home, home, str(home))[1] == "same"
    (tmp_path / "file").write_text("x")
    assert datadir.plan_move(home, home, str(tmp_path / "file"))[1] == "not_dir"
    assert datadir.plan_move(home, home, "relative/folder")[1] == "not_dir"
    put_db(tmp_path / "other")
    assert datadir.plan_move(home, home, str(tmp_path / "other"))[1] == "has_data"
    assert datadir.pending_move(home) is None


def test_failed_move_keeps_the_old_database(tmp_path: Path, monkeypatch) -> None:
    home, target = tmp_path / "home", tmp_path / "target"
    put_db(home)
    datadir.plan_move(home, home, str(target))

    monkeypatch.setattr(datadir, "move_database", lambda source, dest: False)
    assert datadir.resolve(home) == home
    assert (home / "data.db").exists() and datadir.pending_move(home) is None


def make_client(tmp_path: Path, peer: str = "127.0.0.1", **kwargs: object) -> TestClient:
    settings = Settings(
        journal_dir=tmp_path / "journals",
        data_dir=tmp_path / "home",
        data_home=tmp_path / "home",
        static_dir=None,
        online=False,
        **kwargs,  # type: ignore[arg-type]
    )
    return TestClient(create_app(settings), client=(peer, 50000))


def test_data_dir_api(tmp_path: Path) -> None:
    target = tmp_path / "elsewhere"
    with make_client(tmp_path) as client:
        state = client.get("/api/ingest").json()
        assert state["dataDir"] == state["dataDirDefault"] == str(tmp_path / "home")
        assert state["dataDirPending"] is None and state["dataDirFixed"] is False
        assert state["dbBytes"] > 0 and state["freeBytes"] > 0

        assert client.put("/api/data-dir", json={"path": "relative"}).status_code == 422
        moved = client.put("/api/data-dir", json={"path": str(target)}).json()
        assert moved["dataDirPending"] == str(target)
        cancelled = client.delete("/api/data-dir/move").json()
        assert cancelled["dataDirPending"] is None
        assert datadir.pending_move(tmp_path / "home") is None

    with make_client(tmp_path, peer="192.0.2.7") as phone:
        assert phone.put("/api/data-dir", json={"path": str(target)}).status_code == 403
    with make_client(tmp_path, data_dir_fixed=True) as fixed:
        assert fixed.put("/api/data-dir", json={"path": str(target)}).status_code == 409


def write_journal(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    lines = [
        {"timestamp": "2026-10-18T10:00:00Z", "event": "Fileheader", "part": 1},
        {"timestamp": "2026-10-18T10:00:01Z", "event": "Commander", "FID": "F1", "Name": "Alpha"},
    ]
    text = "".join(json.dumps(x) + "\n" for x in lines)
    (folder / "Journal.2026-10-18T100000.01.log").write_text(text, encoding="utf-8")


def wait_state(client: TestClient, done: object) -> dict:
    for _ in range(100):
        state = client.get("/api/ingest").json()
        if done(state):  # type: ignore[operator]
            return state
        time.sleep(0.05)
    raise AssertionError(f"never got there: {state}")


def test_read_waits_for_a_big_database_until_kept_here(tmp_path: Path, monkeypatch) -> None:
    write_journal(tmp_path / "journals")
    monkeypatch.setattr(datadir, "LARGE_DB_BYTES", 100)
    with make_client(tmp_path, rescan_interval=0.05, poll_interval=0.02) as client:
        state = wait_state(client, lambda s: s["hold"] is not None)
        assert state["hold"] == "large" and state["holdBytes"] > 100 and state["events"] == 0
        assert state["backfillDone"] is False
        kept = client.post("/api/ingest/keep-here").json()
        assert kept["bigDataOk"] is True
        state = wait_state(client, lambda s: s["backfillDone"])
        assert state["hold"] is None and state["events"] == 2
    # Remembered: no wait at the next start.
    with make_client(tmp_path) as client:
        state = wait_state(client, lambda s: s["backfillDone"])
        assert state["hold"] is None and state["bigDataOk"] is True


def test_read_waits_for_room_on_the_drive(tmp_path: Path, monkeypatch) -> None:
    write_journal(tmp_path / "journals")
    room = {"free": 10}
    monkeypatch.setattr(datadir, "free_bytes", lambda folder: room["free"])
    with make_client(tmp_path, rescan_interval=0.05, poll_interval=0.02) as client:
        state = wait_state(client, lambda s: s["hold"] is not None)
        assert state["hold"] == "space" and state["freeBytes"] == 10
        assert client.post("/api/ingest/keep-here").status_code == 409
        room["free"] = 10**12  # space freed: the read goes on by itself
        state = wait_state(client, lambda s: s["backfillDone"])
        assert state["hold"] is None and state["events"] == 2

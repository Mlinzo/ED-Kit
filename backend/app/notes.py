"""Your notes on systems and bodies: free text typed in the UI.

Not journal data, so kept apart from the projections (never rebuilt). A note keeps the system's
name and position, so a system you have not been to (a route ahead, the galaxy map) can show
it too; they are filled from your journal or the community data when the UI does not send them.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from datetime import UTC, datetime

SYSTEM = -1  # body_id of a note on the system itself
MAX_LENGTH = 1000

SCHEMA = """
-- Your notes (app.notes). body_id -1: the system itself. system_name, body_name, x, y, z: where
-- and what it is about, for systems you have not been to.
CREATE TABLE IF NOT EXISTS notes(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  system_name TEXT,
  body_name TEXT,
  x REAL, y REAL, z REAL,
  PRIMARY KEY(system_address, body_id)
) STRICT;
"""


def save(
    conn: sqlite3.Connection,
    system_address: int,
    body_id: int,
    text: str,
    *,
    system_name: str | None = None,
    body_name: str | None = None,
    pos: tuple[float, float, float] | None = None,
) -> None:
    """Write a note; an empty one is deleted."""
    text = text.strip()[:MAX_LENGTH]
    if not text:
        conn.execute(
            "DELETE FROM notes WHERE system_address = ? AND body_id = ?", (system_address, body_id)
        )
        return
    if system_name is None or pos is None:
        known = conn.execute(
            "SELECT name, x, y, z FROM systems WHERE address = ? "
            "UNION ALL SELECT name, x, y, z FROM ext_systems "
            "WHERE address = ? AND name IS NOT NULL",
            (system_address, system_address),
        ).fetchone()
        if known is not None:
            system_name = system_name or known["name"]
            if pos is None and known["x"] is not None:
                pos = (known["x"], known["y"], known["z"])
    x, y, z = pos or (None, None, None)
    conn.execute(
        "INSERT INTO notes(system_address, body_id, text, updated_at, system_name, body_name, "
        "x, y, z) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(system_address, body_id) DO UPDATE "
        "SET text = excluded.text, updated_at = excluded.updated_at, "
        "system_name = COALESCE(excluded.system_name, system_name), "
        "body_name = COALESCE(excluded.body_name, body_name), "
        "x = COALESCE(excluded.x, x), y = COALESCE(excluded.y, y), z = COALESCE(excluded.z, z)",
        (
            system_address,
            body_id,
            text,
            datetime.now(UTC).isoformat(timespec="seconds"),
            system_name,
            body_name,
            x,
            y,
            z,
        ),
    )


def of_system(conn: sqlite3.Connection, address: int) -> dict[int, str]:
    """The notes of one system by body id (SYSTEM: the system's own)."""
    return {
        r["body_id"]: r["text"]
        for r in conn.execute(
            "SELECT body_id, text FROM notes WHERE system_address = ?", (address,)
        )
    }


def system_notes(
    conn: sqlite3.Connection, addresses: Iterable[int] | None = None
) -> dict[int, str]:
    """The systems' own notes (all of them when `addresses` is None)."""
    if addresses is None:
        rows = conn.execute("SELECT system_address, text FROM notes WHERE body_id = ?", (SYSTEM,))
        return {r["system_address"]: r["text"] for r in rows}
    ids = list(addresses)
    out: dict[int, str] = {}
    for start in range(0, len(ids), 900):  # SQLite parameter limit
        chunk = ids[start : start + 900]
        marks = ",".join("?" * len(chunk))
        for r in conn.execute(
            "SELECT system_address, text FROM notes "
            f"WHERE body_id = ? AND system_address IN ({marks})",
            [SYSTEM, *chunk],
        ):
            out[r["system_address"]] = r["text"]
    return out


def body_note_counts(conn: sqlite3.Connection) -> dict[int, int]:
    """How many of each system's bodies have a note."""
    return {
        r["system_address"]: r["n"]
        for r in conn.execute(
            "SELECT system_address, COUNT(*) AS n FROM notes WHERE body_id <> ? "
            "GROUP BY system_address",
            (SYSTEM,),
        )
    }


def placed(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Systems with a note of their own and a known position (for the galaxy map)."""
    return conn.execute(
        "SELECT system_address, system_name, x, y, z, text FROM notes "
        "WHERE body_id = ? AND x IS NOT NULL ORDER BY updated_at DESC",
        (SYSTEM,),
    ).fetchall()

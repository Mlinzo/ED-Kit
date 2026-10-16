"""User preferences stored in SQLite (shared by every browser that opens the app).

Settings are written from the API thread; SQLite serialises that short write with the
ingest thread's transactions (WAL + busy_timeout). They never affect stored journal data,
only how views are computed.
"""

from __future__ import annotations

import contextlib
import sqlite3

from app.schemas import HighlightSettings

DEFAULTS = HighlightSettings(dss_min=500_000, bio_min=2_000_000)

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
"""


def load(conn: sqlite3.Connection) -> HighlightSettings:
    try:
        rows = dict(conn.execute("SELECT key, value FROM settings").fetchall())
    except sqlite3.OperationalError:  # table not created yet (fresh read-only connection)
        return DEFAULTS
    values = DEFAULTS.model_dump()
    for key in values:
        if key in rows:
            with contextlib.suppress(ValueError):
                values[key] = max(0, int(rows[key]))
    return HighlightSettings(**values)


def save(conn: sqlite3.Connection, settings: HighlightSettings) -> HighlightSettings:
    conn.executescript(SCHEMA)
    conn.executemany(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(k, str(max(0, int(v)))) for k, v in settings.model_dump().items()],
    )
    return load(conn)

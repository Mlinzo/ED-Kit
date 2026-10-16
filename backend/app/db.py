"""SQLite storage: connection setup and schema.

Two layers:
- `journal_files` + `events`: append-only copy of the journal (source of truth).
- projection tables: derived by `app.projector`; dropped and rebuilt from `events`
  whenever PROJECTOR_VERSION changes.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1

PRAGMAS = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
PRAGMA temp_store=MEMORY;
"""

BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(
  key TEXT PRIMARY KEY,
  value TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS journal_files(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  header_ts TEXT,
  part INTEGER,
  gameversion TEXT,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  line_no INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES journal_files(id),
  line_no INTEGER NOT NULL,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  raw TEXT NOT NULL,
  UNIQUE(file_id, line_no)
) STRICT;
CREATE INDEX IF NOT EXISTS events_by_kind ON events(event, id);

-- Community data (Spansh / EDSM) cached per system. Never overrides the journal.
CREATE TABLE IF NOT EXISTS ext_systems(
  address INTEGER PRIMARY KEY,
  source TEXT,
  fetched_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  body_count INTEGER
) STRICT;

-- facts: JSON of app.models.BodyFacts; signals: {"bio": 3, ...}; genuses: [codex symbols]
CREATE TABLE IF NOT EXISTS ext_bodies(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  facts TEXT NOT NULL,
  signals TEXT NOT NULL,
  genuses TEXT NOT NULL,
  PRIMARY KEY(system_address, body_id)
) STRICT;

CREATE TABLE IF NOT EXISTS ext_barycentres(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  orbit TEXT NOT NULL,
  PRIMARY KEY(system_address, body_id)
) STRICT;

-- Commander position (from Status.json) at the moment of a ScanOrganic event.
-- Not derivable from the journal, so it lives outside the rebuildable projections.
CREATE TABLE IF NOT EXISTS sample_positions(
  event_id INTEGER PRIMARY KEY REFERENCES events(id),
  lat REAL NOT NULL,
  lon REAL NOT NULL
) STRICT;
"""

PROJECTION_TABLES = (
    "commanders",
    "cmdr_state",
    "systems",
    "bodies",
    "barycentres",
    "body_signals",
    "body_genuses",
    "body_cmdr",
    "organic_scans",
    "organic_samples",
    "sales",
    "jumps",
    "deaths",
    "codex_entries",
)

PROJECTION_SCHEMA = """
CREATE TABLE IF NOT EXISTS commanders(
  fid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_seen TEXT
) STRICT;

-- Where each commander is right now, and what they are doing.
CREATE TABLE IF NOT EXISTS cmdr_state(
  fid TEXT PRIMARY KEY,
  system_address INTEGER,
  body_id INTEGER,
  body_name TEXT,
  on_foot INTEGER NOT NULL DEFAULT 0,
  in_srv INTEGER NOT NULL DEFAULT 0,
  odyssey INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS systems(
  address INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  x REAL, y REAL, z REAL,
  body_count INTEGER,
  non_body_count INTEGER,
  all_found INTEGER NOT NULL DEFAULT 0,
  region TEXT,
  population INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS systems_by_name ON systems(name);

-- facts: JSON of app.models.BodyFacts
CREATE TABLE IF NOT EXISTS bodies(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  facts TEXT NOT NULL,
  PRIMARY KEY(system_address, body_id)
) STRICT;

-- Barycentres (journal "Null" parents). orbit: JSON of ScanBaryCentre orbital elements.
CREATE TABLE IF NOT EXISTS barycentres(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  orbit TEXT NOT NULL,
  PRIMARY KEY(system_address, body_id)
) STRICT;

-- kind: bio | geo | human | other
CREATE TABLE IF NOT EXISTS body_signals(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(system_address, body_id, kind)
) STRICT;

-- genus: codex genus symbol confirmed by DSS
CREATE TABLE IF NOT EXISTS body_genuses(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  genus TEXT NOT NULL,
  PRIMARY KEY(system_address, body_id, genus)
) STRICT;

-- Per-commander cartographic state of a body. carto: unsold | sold | lost
CREATE TABLE IF NOT EXISTS body_cmdr(
  fid TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  scanned_at TEXT,
  mapped_at TEXT,
  efficient INTEGER NOT NULL DEFAULT 0,
  carto TEXT NOT NULL DEFAULT 'unsold',
  footfall_at TEXT,  -- you were the first to walk on it
  PRIMARY KEY(fid, system_address, body_id)
) STRICT;
CREATE INDEX IF NOT EXISTS body_cmdr_unsold ON body_cmdr(fid, carto);

-- status: sampling | analysed | abandoned; sale: unsold | sold | lost (meaningful once analysed)
CREATE TABLE IF NOT EXISTS organic_scans(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  genus TEXT NOT NULL,
  species TEXT NOT NULL,
  species_name TEXT,
  variant TEXT,
  samples INTEGER NOT NULL,
  status TEXT NOT NULL,
  sale TEXT NOT NULL DEFAULT 'unsold',
  first_footfall INTEGER NOT NULL DEFAULT 0,
  value INTEGER,
  bonus INTEGER,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS organic_by_body ON organic_scans(system_address, body_id);
CREATE INDEX IF NOT EXISTS organic_by_cmdr ON organic_scans(fid, status, sale);

CREATE TABLE IF NOT EXISTS organic_samples(
  scan_id INTEGER NOT NULL,
  n INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  PRIMARY KEY(scan_id, n)
) STRICT;

-- kind: bio | carto
CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts TEXT NOT NULL,
  base INTEGER NOT NULL,
  bonus INTEGER NOT NULL,
  total INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS jumps(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ts TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  distance_ly REAL NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS jumps_by_cmdr ON jumps(fid, ts);

-- Codex discoveries. name: codex symbol (a variant for biology); species: canonical
-- exobio species symbol when the entry is an organism; region: "$Codex_RegionName_N;".
CREATE TABLE IF NOT EXISTS codex_entries(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ts TEXT NOT NULL,
  entry_id INTEGER,
  name TEXT NOT NULL,
  species TEXT,
  category TEXT,
  region TEXT,
  system_address INTEGER,
  body_id INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS codex_by_species ON codex_entries(fid, species);

-- context: ship | srv | on_foot; killers: JSON [{"name","ship","rank"}]
CREATE TABLE IF NOT EXISTS deaths(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ts TEXT NOT NULL,
  system_address INTEGER,
  body_name TEXT,
  context TEXT NOT NULL,
  killers TEXT NOT NULL,
  lost_bio_count INTEGER NOT NULL,
  lost_bio_value INTEGER NOT NULL,
  lost_carto_bodies INTEGER NOT NULL,
  lost_carto_value INTEGER NOT NULL,
  rebuy_option TEXT,
  rebuy_cost INTEGER
) STRICT;
"""


def connect(path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    if readonly:
        conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, check_same_thread=False)
        conn.execute("PRAGMA busy_timeout=5000")
    else:
        conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        conn.executescript(PRAGMAS)
    conn.row_factory = sqlite3.Row
    return conn


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str | int | None) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, None if value is None else str(value)),
    )


def init_schema(conn: sqlite3.Connection) -> None:
    from app import usersettings

    conn.executescript(BASE_SCHEMA)
    conn.executescript(usersettings.SCHEMA)
    conn.executescript(PROJECTION_SCHEMA)
    if get_meta(conn, "schema_version") is None:
        set_meta(conn, "schema_version", SCHEMA_VERSION)


def reset_projections(conn: sqlite3.Connection) -> None:
    """Drop and recreate every projection table (events stay)."""
    for table in PROJECTION_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.executescript(PROJECTION_SCHEMA)

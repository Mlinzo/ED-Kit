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
-- name, x, y, z: what the databases call the system and where (a system you have not been to).
CREATE TABLE IF NOT EXISTS ext_systems(
  address INTEGER PRIMARY KEY,
  source TEXT,
  fetched_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  body_count INTEGER,
  name TEXT,
  x REAL, y REAL, z REAL
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

-- Spansh searches of the route planner (app.spansh.CachedSearch): body pages by request,
-- permit-locked systems (when fetched: meta spansh_permits_at), systems by id64.
CREATE TABLE IF NOT EXISTS spansh_pages(
  key TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  data TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS spansh_permits(
  id64 INTEGER PRIMARY KEY
) STRICT;

CREATE TABLE IF NOT EXISTS spansh_systems(
  id64 INTEGER PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  population INTEGER,
  needs_permit INTEGER
) STRICT;

-- The planned route (one at a time). User data: survives projection rebuilds.
-- params: JSON of the request; source / destination: JSON {name, x, y, z}.
CREATE TABLE IF NOT EXISTS route(
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL,
  params TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  data_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS route_stops(
  seq INTEGER PRIMARY KEY,
  system_address INTEGER NOT NULL,
  name TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  hop_ly REAL NOT NULL,
  population INTEGER,  -- from Spansh, filled in after the route is shown
  skipped INTEGER NOT NULL DEFAULT 0,
  jumps INTEGER,  -- transit routes: jumps from the previous stop (Spansh)
  neutron INTEGER NOT NULL DEFAULT 0  -- transit routes: supercharge at this stop
) STRICT;

-- kind: elw | tww | thmc | ww | aw | trocky (app.routeplan.BODY_TYPES) | bio
CREATE TABLE IF NOT EXISTS route_bodies(
  system_address INTEGER NOT NULL,
  body_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  distance_ls REAL,
  scan_value INTEGER NOT NULL,
  mapping_value INTEGER NOT NULL,
  bio_signals INTEGER NOT NULL DEFAULT 0,
  bio_min INTEGER NOT NULL DEFAULT 0,
  bio_max INTEGER NOT NULL DEFAULT 0,
  genuses TEXT NOT NULL DEFAULT '[]',  -- JSON codex genus symbols
  -- codex routes: JSON [[entry symbol, species symbol, colour, chance]] not in your codex then
  codex TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY(system_address, body_id)
) STRICT;

-- Community knowledge of systems on the route plotted in the game (app.discovery):
-- spansh: 0 unknown, 1 the system only, 2 some bodies, 3 its arrival star;
-- edsm: 0 unknown, 1 the system only, 2 its arrival star; NULL: not asked or the lookup failed.
CREATE TABLE IF NOT EXISTS discovery(
  id64 INTEGER PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  spansh INTEGER,
  edsm INTEGER
) STRICT;

-- The Spansh neutron route to the route's next stop (app.neutron). One at a time.
-- waypoints: JSON [{name, id64, x, y, z, jumps, neutron, left_ly}], the start first.
CREATE TABLE IF NOT EXISTS neutron_plan(
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_address INTEGER,
  range_ly REAL NOT NULL,
  efficiency INTEGER NOT NULL,
  multiplier INTEGER NOT NULL,
  total_jumps INTEGER NOT NULL,
  waypoints TEXT NOT NULL
) STRICT;

-- The latest "where to sell" search (app.selling): Spansh stations with Universal Cartographics
-- or Vista Genomics nearest to (x, y, z). One at a time. ok 0: the search failed.
-- stations: JSON list of trimmed Spansh stations (app.spansh.STATION_FIELDS + services).
CREATE TABLE IF NOT EXISTS sell_search(
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
  ok INTEGER NOT NULL,
  stations TEXT NOT NULL
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
    "docks",
    "jumps",
    "visits",
    "deaths",
    "codex_entries",
    "fuel_jumps",
    "engineers",
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
  odyssey INTEGER NOT NULL DEFAULT 1,
  jump_range REAL,  -- MaxJumpRange of the current ship (Loadout), ly
  ship_type TEXT,  -- Loadout.Ship, lower case (app.ships: the pad it needs)
  -- The current ship (Loadout) and what it carries: the fuel forecast (app.fuel).
  ship_id INTEGER,
  fsd_item TEXT,  -- FrameShiftDrive module symbol
  fsd_key TEXT,  -- the drive with its engineering and FSD booster: one fuel curve per key
  unladen_mass REAL,  -- t, hull and modules
  fuel_capacity REAL,  -- main tank, t
  fuel_level REAL,  -- main tank, t, as last reported by the journal
  cargo REAL NOT NULL DEFAULT 0,  -- t
  has_scoop INTEGER NOT NULL DEFAULT 0
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

-- kind: bio | carto. station, system_address: where you were docked (the last Docked).
CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts TEXT NOT NULL,
  base INTEGER NOT NULL,
  bonus INTEGER NOT NULL,
  total INTEGER NOT NULL,
  station TEXT,
  system_address INTEGER
) STRICT;

-- Dockings (Docked, or a Location while docked). uc: Universal Cartographics (buys exploration
-- data), vg: Vista Genomics (buys organic data). Pads: NULL when the event does not say.
CREATE TABLE IF NOT EXISTS docks(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ts TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  market_id INTEGER,
  station TEXT NOT NULL,
  station_type TEXT,
  dist_ls REAL,
  uc INTEGER NOT NULL,
  vg INTEGER NOT NULL,
  small_pads INTEGER,
  medium_pads INTEGER,
  large_pads INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS docks_by_cmdr ON docks(fid, id);

CREATE TABLE IF NOT EXISTS jumps(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ts TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  distance_ly REAL NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS jumps_by_cmdr ON jumps(fid, ts);

-- Arrivals in a system: FSD and carrier jumps, and a Location in another system than before
-- (respawn, first login). Reloading the game where you are is not a new visit.
-- how: jump | carrier | location (you did not fly there: the galaxy map breaks the path)
CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ts TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  how TEXT NOT NULL DEFAULT 'jump'
) STRICT;
CREATE INDEX IF NOT EXISTS visits_by_system ON visits(fid, system_address, id);

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

-- Your standing with each engineer (EngineerProgress): progress is the journal's Known /
-- Invited / Acquainted / Unlocked / Barred; rank 1..5 once unlocked.
CREATE TABLE IF NOT EXISTS engineers(
  fid TEXT NOT NULL,
  engineer TEXT NOT NULL,
  engineer_id INTEGER,
  progress TEXT,
  rank INTEGER,
  at TEXT,
  PRIMARY KEY(fid, engineer)
) STRICT;

-- Fuel burnt by FSD jumps (fuel curve of the current drive, app.fuel). mass: the ship at the
-- start of the jump (unladen + fuel + cargo), t; boosted: neutron / white dwarf / injection.
CREATE TABLE IF NOT EXISTS fuel_jumps(
  id INTEGER PRIMARY KEY,
  fid TEXT NOT NULL,
  ship_id INTEGER,
  fsd_key TEXT NOT NULL,
  distance_ly REAL NOT NULL,
  fuel_used REAL NOT NULL,
  mass REAL NOT NULL,
  boosted INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS fuel_jumps_by_drive ON fuel_jumps(fid, fsd_key, id);

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


# Columns added to user-data tables after they first shipped: (table, column, definition).
ADDED_COLUMNS = (
    ("route_bodies", "bio_signals", "INTEGER NOT NULL DEFAULT 0"),
    ("route_bodies", "bio_min", "INTEGER NOT NULL DEFAULT 0"),
    ("route_bodies", "bio_max", "INTEGER NOT NULL DEFAULT 0"),
    ("route_bodies", "genuses", "TEXT NOT NULL DEFAULT '[]'"),
    ("route_bodies", "codex", "TEXT NOT NULL DEFAULT '[]'"),
    ("ext_systems", "name", "TEXT"),
    ("ext_systems", "x", "REAL"),
    ("ext_systems", "y", "REAL"),
    ("ext_systems", "z", "REAL"),
    ("route_stops", "jumps", "INTEGER"),
    ("route_stops", "neutron", "INTEGER NOT NULL DEFAULT 0"),
)


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, column, definition in ADDED_COLUMNS:
        have = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_schema(conn: sqlite3.Connection) -> None:
    from app import notes, usersettings

    conn.executescript(BASE_SCHEMA)
    _add_missing_columns(conn)
    conn.executescript(usersettings.SCHEMA)
    conn.executescript(notes.SCHEMA)
    conn.executescript(PROJECTION_SCHEMA)
    if get_meta(conn, "schema_version") is None:
        set_meta(conn, "schema_version", SCHEMA_VERSION)


def reset_projections(conn: sqlite3.Connection) -> None:
    """Drop and recreate every projection table (events stay)."""
    for table in PROJECTION_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.executescript(PROJECTION_SCHEMA)

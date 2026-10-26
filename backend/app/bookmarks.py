"""Your bookmarks: systems, bodies, stations and places on a planet's surface, each with a tag and
your own comment.

Not journal data, so kept apart from the projections (never rebuilt). A bookmark keeps the
system's name and position (and the body's name), so a place you have not been to (a route
ahead, the galaxy map, a station from the Shop) can show it too; they are filled from your
journal or the community data when the UI does not send them. A system, a body and a station
are bookmarked once each; a body can hold any number of places.

Until 2026-10-26 the app kept notes (free text on a system or a body) in a `notes` table: each
became a bookmark with that text as its comment, tagged "other" (`migrate`).
"""

from __future__ import annotations

import math
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol, get_args

from app.schemas import (
    BookmarkCategory,
    BookmarkHere,
    BookmarkKind,
    BookmarksView,
    BookmarkView,
    GalaxyBookmarkView,
    LiveStatus,
)

MAX_COMMENT = 1000
MAX_TITLE = 120
CATEGORIES: tuple[str, ...] = get_args(BookmarkCategory)
KINDS: tuple[str, ...] = get_args(BookmarkKind)
ONCE = ("system", "body", "station")  # bookmarked once each; places: as many as you like

SCHEMA = """
-- Your bookmarks (app.bookmarks). kind: system | body | station | place. body_id: a body's or a
-- place's body; lat, lon: a place; title: a station's name, a place's name (yours or the mark's).
-- system_name, body_name, x, y, z: where it is, for places you have not been to.
CREATE TABLE IF NOT EXISTS bookmarks(
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  system_address INTEGER NOT NULL,
  body_id INTEGER,
  lat REAL,
  lon REAL,
  title TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  system_name TEXT,
  body_name TEXT,
  x REAL, y REAL, z REAL
) STRICT;
CREATE INDEX IF NOT EXISTS bookmarks_by_system ON bookmarks(system_address);
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_one_system ON bookmarks(system_address)
  WHERE kind = 'system';
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_one_body ON bookmarks(system_address, body_id)
  WHERE kind = 'body';
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_one_station ON bookmarks(system_address, title)
  WHERE kind = 'station';
"""

_NOTE_SYSTEM = -1  # the old notes' body_id of a note on the system itself


def migrate(conn: sqlite3.Connection) -> None:
    """Turns the old notes into bookmarks with their text as the comment, then drops them."""
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
    ).fetchone():
        return
    conn.execute("BEGIN")
    try:
        conn.execute(
            "INSERT OR IGNORE INTO bookmarks(kind, system_address, body_id, comment, created_at, "
            "updated_at, system_name, body_name, x, y, z) "
            "SELECT CASE WHEN body_id = ? THEN 'system' ELSE 'body' END, system_address, "
            "CASE WHEN body_id = ? THEN NULL ELSE body_id END, text, updated_at, updated_at, "
            "system_name, body_name, x, y, z FROM notes",
            (_NOTE_SYSTEM, _NOTE_SYSTEM),
        )
        conn.execute("DROP TABLE notes")
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _system_known(conn: sqlite3.Connection, address: int) -> sqlite3.Row | None:
    """The system's name and position: your journal, the community data, or another bookmark
    there (a system you have not been to, its name and position sent with that one)."""
    return conn.execute(
        "SELECT name, x, y, z FROM systems WHERE address = ? "
        "UNION ALL SELECT name, x, y, z FROM ext_systems WHERE address = ? AND name IS NOT NULL "
        "UNION ALL SELECT system_name, x, y, z FROM bookmarks "
        "WHERE system_address = ? AND system_name IS NOT NULL AND x IS NOT NULL",
        (address, address, address),
    ).fetchone()


def _body_name(conn: sqlite3.Connection, address: int, body_id: int) -> str | None:
    row = conn.execute(
        "SELECT name FROM bodies WHERE system_address = ? AND body_id = ? "
        "UNION ALL SELECT json_extract(facts, '$.name') FROM ext_bodies "
        "WHERE system_address = ? AND body_id = ?",
        (address, body_id, address, body_id),
    ).fetchone()
    return row[0] if row and row[0] else None


def _clean(text: str | None, limit: int) -> str:
    return (text or "").strip()[:limit]


def find(
    conn: sqlite3.Connection,
    kind: str,
    address: int,
    *,
    body_id: int | None = None,
    title: str | None = None,
) -> sqlite3.Row | None:
    """The bookmark of this system, body or station, if there is one."""
    if kind == "system":
        return conn.execute(
            "SELECT * FROM bookmarks WHERE kind = 'system' AND system_address = ?", (address,)
        ).fetchone()
    if kind == "body":
        return conn.execute(
            "SELECT * FROM bookmarks WHERE kind = 'body' AND system_address = ? AND body_id = ?",
            (address, body_id),
        ).fetchone()
    if kind == "station":
        return conn.execute(
            "SELECT * FROM bookmarks WHERE kind = 'station' AND system_address = ? AND title = ?",
            (address, _clean(title, MAX_TITLE)),
        ).fetchone()
    return None


def add(
    conn: sqlite3.Connection,
    kind: str,
    address: int,
    *,
    body_id: int | None = None,
    lat: float | None = None,
    lon: float | None = None,
    title: str | None = None,
    category: str | None = None,
    comment: str | None = None,
    system_name: str | None = None,
    body_name: str | None = None,
    pos: tuple[float, float, float] | None = None,
) -> int:
    """Bookmark something; a system, body or station already bookmarked keeps its bookmark (its
    id is returned). Raises ValueError for what cannot be bookmarked."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind {kind!r}")
    category = category or ("trade" if kind == "station" else "other")
    if category not in CATEGORIES:
        raise ValueError(f"unknown category {category!r}")
    title = _clean(title, MAX_TITLE) or None
    if kind in ("body", "place") and body_id is None:
        raise ValueError(f"a {kind} needs its body")
    if kind == "place" and (lat is None or lon is None):
        raise ValueError("a place needs its latitude and longitude")
    if kind == "station" and not title:
        raise ValueError("a station needs its name")
    if kind in ONCE and (known := find(conn, kind, address, body_id=body_id, title=title)):
        return int(known["id"])
    if system_name is None or pos is None:
        known_system = _system_known(conn, address)
        if known_system is not None:
            system_name = system_name or known_system["name"]
            if pos is None and known_system["x"] is not None:
                pos = (known_system["x"], known_system["y"], known_system["z"])
    if body_id is not None and body_name is None:
        body_name = _body_name(conn, address, body_id)
    x, y, z = pos or (None, None, None)
    now = _now()
    cur = conn.execute(
        "INSERT INTO bookmarks(kind, system_address, body_id, lat, lon, title, category, comment, "
        "created_at, updated_at, system_name, body_name, x, y, z) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            kind,
            address,
            body_id if kind != "system" and kind != "station" else None,
            lat if kind == "place" else None,
            lon if kind == "place" else None,
            title,
            category,
            _clean(comment, MAX_COMMENT),
            now,
            now,
            system_name,
            body_name,
            x,
            y,
            z,
        ),
    )
    return int(cur.lastrowid or 0)


def update(
    conn: sqlite3.Connection,
    bookmark_id: int,
    *,
    title: str | None = None,
    category: str | None = None,
    comment: str | None = None,
) -> bool:
    """Change a bookmark's title, tag or comment (None: unchanged; "": cleared). False when there
    is no such bookmark."""
    row = conn.execute("SELECT kind FROM bookmarks WHERE id = ?", (bookmark_id,)).fetchone()
    if row is None:
        return False
    if category is not None and category not in CATEGORIES:
        raise ValueError(f"unknown category {category!r}")
    sets: list[str] = []
    args: list[object] = []
    # A station's name is what tells it apart: it stays.
    if title is not None and row["kind"] != "station":
        sets.append("title = ?")
        args.append(_clean(title, MAX_TITLE) or None)
    if category is not None:
        sets.append("category = ?")
        args.append(category)
    if comment is not None:
        sets.append("comment = ?")
        args.append(_clean(comment, MAX_COMMENT))
    if sets:
        conn.execute(
            f"UPDATE bookmarks SET {', '.join(sets)}, updated_at = ? WHERE id = ?",
            (*args, _now(), bookmark_id),
        )
    return True


def get(conn: sqlite3.Connection, bookmark_id: int) -> BookmarkView | None:
    row = conn.execute("SELECT * FROM bookmarks WHERE id = ?", (bookmark_id,)).fetchone()
    return view(row) if row is not None else None


def delete(conn: sqlite3.Connection, bookmark_id: int) -> bool:
    return conn.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark_id,)).rowcount > 0


def view(row: sqlite3.Row, *, distance_ly: float | None = None) -> BookmarkView:
    return BookmarkView(
        id=row["id"],
        kind=row["kind"],
        system_address=str(row["system_address"]),
        system_name=row["system_name"],
        body_id=row["body_id"],
        body_name=row["body_name"],
        lat=row["lat"],
        lon=row["lon"],
        title=row["title"],
        category=row["category"],
        comment=row["comment"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        distance_ly=distance_ly,
    )


@dataclass(slots=True)
class SystemMarks:
    """Every bookmark of one system, by what it marks."""

    system: BookmarkView | None = None
    bodies: dict[int, BookmarkView] = field(default_factory=dict)
    places: dict[int, list[BookmarkView]] = field(default_factory=dict)  # by body id
    stations: list[BookmarkView] = field(default_factory=list)


def in_system(conn: sqlite3.Connection, address: int) -> SystemMarks:
    out = SystemMarks()
    for row in conn.execute(
        "SELECT * FROM bookmarks WHERE system_address = ? ORDER BY id", (address,)
    ):
        mark = view(row)
        if mark.kind == "system":
            out.system = mark
        elif mark.kind == "body" and mark.body_id is not None:
            out.bodies[mark.body_id] = mark
        elif mark.kind == "place" and mark.body_id is not None:
            out.places.setdefault(mark.body_id, []).append(mark)
        elif mark.kind == "station":
            out.stations.append(mark)
    return out


def of_systems(
    conn: sqlite3.Connection, addresses: Iterable[int] | None = None
) -> dict[int, sqlite3.Row]:
    """The systems' own bookmarks (all of them when `addresses` is None)."""
    if addresses is None:
        rows = conn.execute("SELECT * FROM bookmarks WHERE kind = 'system'").fetchall()
        return {r["system_address"]: r for r in rows}
    ids = list(addresses)
    out: dict[int, sqlite3.Row] = {}
    for start in range(0, len(ids), 900):  # SQLite parameter limit
        chunk = ids[start : start + 900]
        marks = ",".join("?" * len(chunk))
        for r in conn.execute(
            f"SELECT * FROM bookmarks WHERE kind = 'system' AND system_address IN ({marks})", chunk
        ):
            out[r["system_address"]] = r
    return out


def inner_counts(conn: sqlite3.Connection) -> dict[int, int]:
    """How many bookmarks each system holds besides its own: bodies, places, stations."""
    return {
        r["system_address"]: r["n"]
        for r in conn.execute(
            "SELECT system_address, COUNT(*) AS n FROM bookmarks WHERE kind <> 'system' "
            "GROUP BY system_address"
        )
    }


def stations(conn: sqlite3.Connection) -> dict[tuple[int, str], sqlite3.Row]:
    """Station bookmarks by (system address, station name)."""
    return {
        (r["system_address"], r["title"]): r
        for r in conn.execute("SELECT * FROM bookmarks WHERE kind = 'station'")
    }


class _Place(Protocol):
    system_address: str | None
    stations: list

    def model_copy(self, *, update: dict) -> _Place: ...


def mark_stations[P: _Place](conn: sqlite3.Connection, places: list[P]) -> list[P]:
    """The places of "Where to sell" or the Shop, their bookmarked stations carrying the
    bookmark."""
    marks = stations(conn)
    if not marks:
        return places
    out: list[P] = []
    for place in places:
        address = int(place.system_address) if place.system_address else None
        if address is None or not any((address, s.name) in marks for s in place.stations):
            out.append(place)
            continue
        found = [
            s.model_copy(update={"bookmark": view(marks[(address, s.name)])})
            if (address, s.name) in marks
            else s
            for s in place.stations
        ]
        out.append(place.model_copy(update={"stations": found}))
    return out


def places_on(conn: sqlite3.Connection, address: int, body_id: int) -> list[BookmarkView]:
    """Your bookmarked places on one body."""
    return [
        view(r)
        for r in conn.execute(
            "SELECT * FROM bookmarks WHERE kind = 'place' AND system_address = ? AND body_id = ? "
            "ORDER BY id",
            (address, body_id),
        )
    ]


def placed(conn: sqlite3.Connection) -> list[GalaxyBookmarkView]:
    """The systems holding bookmarks whose position is known (for the galaxy map), the latest
    bookmarked first."""
    by_system: dict[int, list[sqlite3.Row]] = {}
    for row in every(conn):
        by_system.setdefault(row["system_address"], []).append(row)
    out: list[GalaxyBookmarkView] = []
    for address, rows in by_system.items():
        name = next((r["system_name"] for r in rows if r["system_name"]), None)
        pos = next(((r["x"], r["y"], r["z"]) for r in rows if r["x"] is not None), None)
        if pos is None or name is None:
            known = _system_known(conn, address)
            if known is not None:
                name = name or known["name"]
                if pos is None and known["x"] is not None:
                    pos = (known["x"], known["y"], known["z"])
        if pos is None:
            continue
        own = next((r for r in rows if r["kind"] == "system"), None)
        out.append(
            GalaxyBookmarkView(
                address=str(address),
                name=name,
                x=pos[0],
                y=pos[1],
                z=pos[2],
                bookmark=view(own) if own is not None else None,
                inner=sum(1 for r in rows if r["kind"] != "system"),
            )
        )
    return out


def every(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM bookmarks ORDER BY updated_at DESC, id DESC").fetchall()


def here(conn: sqlite3.Connection, fid: str | None) -> BookmarkHere:
    """Where you are, from the journal: the system, the body you are at, the station you docked
    at in this system (whether you still are is Status.json's to say)."""
    state = (
        conn.execute("SELECT * FROM cmdr_state WHERE fid = ?", (fid,)).fetchone() if fid else None
    )
    address = state["system_address"] if state else None
    if address is None:
        return BookmarkHere(
            system_address=None, system_name=None, body_id=None, body_name=None, station=None
        )
    known = _system_known(conn, address)
    body_id, body_name = state["body_id"], state["body_name"]
    if body_id is None and state["ship_near"] and state["ship_body_id"] is not None:
        body_id = state["ship_body_id"]
        body_name = _body_name(conn, address, body_id)
        if body_name is None:  # a station or a signal: no body
            body_id = None
    arrived = conn.execute(
        "SELECT MAX(ts) FROM visits WHERE fid = ? AND system_address = ?", (fid, address)
    ).fetchone()[0]
    dock = conn.execute(
        "SELECT station FROM docks WHERE fid = ? AND system_address = ? AND ts >= ? "
        "ORDER BY id DESC LIMIT 1",
        (fid, address, arrived or ""),
    ).fetchone()
    return BookmarkHere(
        system_address=str(address),
        system_name=known["name"] if known else None,
        body_id=body_id,
        body_name=body_name,
        station=dock["station"] if dock else None,
    )


def add_here(
    conn: sqlite3.Connection,
    fid: str | None,
    live: LiveStatus | None,
    what: str,
    *,
    category: str | None = None,
    comment: str | None = None,
) -> int:
    """Bookmark where you are now (`what`: system, body, place, station). Raises ValueError when
    you are not there (no system, no body, not on a planet, not docked)."""
    at = here(conn, fid)
    if at.system_address is None:
        raise ValueError("no current system")
    address = int(at.system_address)
    if what == "system":
        return add(conn, "system", address, category=category, comment=comment)
    if what == "body":
        if at.body_id is None:
            raise ValueError("not at a body")
        return add(conn, "body", address, body_id=at.body_id, category=category, comment=comment)
    if what == "place":
        if live is None or not live.has_lat_long or live.lat is None or live.lon is None:
            raise ValueError("not on a planet")
        body_id = at.body_id if at.body_name == live.body_name else None
        if body_id is None and live.body_name:
            row = conn.execute(
                "SELECT body_id FROM bodies WHERE system_address = ? AND name = ?",
                (address, live.body_name),
            ).fetchone()
            body_id = row["body_id"] if row else None
        if body_id is None:
            raise ValueError("the planet is not known")
        return add(
            conn,
            "place",
            address,
            body_id=body_id,
            lat=live.lat,
            lon=live.lon,
            category=category,
            comment=comment,
            body_name=live.body_name,
        )
    if what == "station":
        if live is None or not live.docked or not at.station:
            raise ValueError("not docked")
        return add(conn, "station", address, title=at.station, category=category, comment=comment)
    raise ValueError(f"cannot bookmark {what!r}")


def bookmarks_view(conn: sqlite3.Connection, fid: str | None) -> BookmarksView:
    """Every bookmark, the latest first, with the distance of its system from yours."""
    at = here(conn, fid)
    origin = None
    if at.system_address is not None:
        known = _system_known(conn, int(at.system_address))
        if known is not None and known["x"] is not None:
            origin = (known["x"], known["y"], known["z"])
    items: list[BookmarkView] = []
    for row in every(conn):
        mark = view(row)
        pos = (row["x"], row["y"], row["z"]) if row["x"] is not None else None
        if pos is None or mark.system_name is None:  # known since it was bookmarked?
            known = _system_known(conn, row["system_address"])
            if known is not None:
                mark.system_name = mark.system_name or known["name"]
                if pos is None and known["x"] is not None:
                    pos = (known["x"], known["y"], known["z"])
        if origin is not None and pos is not None:
            mark.distance_ly = round(math.dist(origin, pos), 2)
        items.append(mark)
    return BookmarksView(items=items, here=at)

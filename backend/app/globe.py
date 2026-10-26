"""The planet globe of the Surface tab: every place on one planet the app knows of.

Where each place comes from:
- samples: your position from Status.json at each ScanOrganic, recorded by the app while it runs
  (`sample_positions`); samples taken while it was closed have none;
- codex finds, landings and take-offs, settlements: the journal (CodexEntry, Touchdown / Liftoff,
  ApproachSettlement carry Latitude / Longitude), so old journals count too;
- other players' finds: Canonn (app.canonn), looked up when the globe is shown;
- your path: Status.json positions recorded by the app while it runs (app.track).
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict

from app import bookmarks, canonn, exobio, track
from app.exobio.variants import colour_of
from app.models import BodyFacts, SystemFacts
from app.schemas import CommunityFinds, GlobeMark, GlobeShip, GlobeView, LiveStatus


def _species_name(symbol: str, fallback: str | None) -> str:
    species = exobio.get_species(symbol)
    return species.species_name if species else (fallback or symbol)


def _samples(
    conn: sqlite3.Connection, fid: str, address: int, body_id: int
) -> tuple[list[GlobeMark], set[str], set[str]]:
    """Sample marks, the variants with a recorded position, and the species sampled here."""
    marks: list[GlobeMark] = []
    placed: set[str] = set()
    species: set[str] = set()
    rows = conn.execute(
        "SELECT o.species, o.species_name, o.variant, o.status, o.started_at, s.n, s.lat, s.lon "
        "FROM organic_scans o LEFT JOIN organic_samples s ON s.scan_id = o.id "
        "WHERE o.fid = ? AND o.system_address = ? AND o.body_id = ? ORDER BY o.id, s.n",
        (fid, address, body_id),
    )
    for r in rows:
        name = _species_name(r["species"], r["species_name"])
        species.add(name)
        if r["lat"] is None:
            continue
        if r["variant"]:
            placed.add(str(r["variant"]).lower())
        marks.append(
            GlobeMark(
                kind="sample",
                lat=r["lat"],
                lon=r["lon"],
                name=name,
                colour=colour_of(r["variant"]),
                n=r["n"],
                status=r["status"],
                at=r["started_at"],
            )
        )
    return marks, placed, species


def _codex(
    conn: sqlite3.Connection, fid: str, address: int, body_id: int, placed: set[str]
) -> list[GlobeMark]:
    """Your codex finds here; a species whose samples are on the globe already is left out."""
    marks: list[GlobeMark] = []
    rows = conn.execute(
        "SELECT ts, name, species, title, lat, lon FROM codex_entries "
        "WHERE fid = ? AND system_address = ? AND body_id = ? AND lat IS NOT NULL ORDER BY id",
        (fid, address, body_id),
    )
    for r in rows:
        if str(r["name"]).lower() in placed:
            continue
        name = _species_name(r["species"], r["title"]) if r["species"] else r["title"]
        marks.append(
            GlobeMark(
                kind="codex",
                lat=r["lat"],
                lon=r["lon"],
                name=name or str(r["name"]),
                colour=colour_of(r["name"]) if r["species"] else None,
                at=r["ts"],
            )
        )
    return marks


def _places(conn: sqlite3.Connection, fid: str, address: int, body_id: int) -> list[GlobeMark]:
    """Every landing and take-off of yours here (not the ship's own when recalled or dismissed),
    and each settlement once (the latest approach)."""
    marks: list[GlobeMark] = []
    settlements: dict[str, GlobeMark] = {}
    rows = conn.execute(
        "SELECT ts, kind, lat, lon, name, player FROM surface_marks WHERE fid = ? "
        "AND system_address = ? AND body_id = ? ORDER BY id",
        (fid, address, body_id),
    )
    for r in rows:
        if r["kind"] in ("touchdown", "liftoff"):
            if r["player"]:
                kind = "landing" if r["kind"] == "touchdown" else "takeoff"
                marks.append(GlobeMark(kind=kind, lat=r["lat"], lon=r["lon"], name="", at=r["ts"]))
        elif r["kind"] == "settlement":
            name = r["name"] or ""
            settlements[name] = GlobeMark(
                kind="settlement", lat=r["lat"], lon=r["lon"], name=name, at=r["ts"]
            )
    return marks + list(settlements.values())


def ship_here(
    conn: sqlite3.Connection, fid: str, address: int, body_id: int, current_system: int | None
) -> GlobeShip | None:
    """Where your ship is on this planet: the latest touchdown or liftoff anywhere, if it was here,
    you are still in this system and have not died since."""
    if current_system != address:
        return None
    row = conn.execute(
        "SELECT ts, kind, system_address, body_id, lat, lon, player FROM surface_marks "
        "WHERE fid = ? AND kind IN ('touchdown', 'liftoff') ORDER BY id DESC LIMIT 1",
        (fid,),
    ).fetchone()
    if row is None or row["system_address"] != address or row["body_id"] != body_id:
        return None
    died = conn.execute(
        "SELECT 1 FROM deaths WHERE fid = ? AND ts > ? LIMIT 1", (fid, row["ts"])
    ).fetchone()
    if died is not None:
        return None
    if row["kind"] == "touchdown":
        state = "landed" if row["player"] else "recalled"
        return GlobeShip(state=state, lat=row["lat"], lon=row["lon"], at=row["ts"])
    if not row["player"]:
        return GlobeShip(state="dismissed", lat=None, lon=None, at=row["ts"])
    return None  # you flew off in it


def _community(
    conn: sqlite3.Connection,
    address: int,
    names: tuple[str, ...],
    yours: set[str],
    online: bool,
) -> tuple[canonn.State, str | None, list[CommunityFinds]]:
    state, at, points = canonn.body_points(conn, address, names, online=online)
    by_name: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
    for p in points:
        by_name[(p["name"], p["category"])].append((p["lat"], p["lon"]))
    finds = [
        CommunityFinds(
            name=name,
            category=category,
            points=pts,
            # "Osseus Discus - Blue": the species is the part before the colour.
            yours=name.split(" - ", 1)[0] in yours,
        )
        for (name, category), pts in by_name.items()
    ]
    finds.sort(key=lambda f: (f.category != "Biology", f.category, -len(f.points), f.name))
    return state, at, finds


def globe_view(
    conn: sqlite3.Connection,
    fid: str,
    system: SystemFacts,
    facts: BodyFacts,
    live: LiveStatus | None,
    current_system: int | None,
    *,
    online: bool,
) -> GlobeView | None:
    """The globe of a landable planet; None for other bodies or an unknown radius."""
    if facts.kind != "planet" or not facts.landable:
        return None
    radius = facts.radius_m
    if not radius and live is not None and live.body_name == facts.name:
        radius = live.planet_radius_m
    if not radius:
        return None
    address, body_id = system.address, facts.body_id
    samples, placed, species = _samples(conn, fid, address, body_id)
    marks = [
        *samples,
        *_codex(conn, fid, address, body_id, placed),
        *_places(conn, fid, address, body_id),
    ]
    prefix = f"{system.name} "
    short = facts.name[len(prefix) :] if facts.name.startswith(prefix) else facts.name
    state, at, finds = _community(conn, address, (short, facts.name), species, online)
    return GlobeView(
        body_name=facts.name,
        radius_m=radius,
        marks=marks,
        ship=ship_here(conn, fid, address, body_id, current_system),
        track=track.stretches(conn, fid, facts.name),
        community_state=state,
        community_at=at,
        community=finds,
        places=bookmarks.places_on(conn, address, body_id),
    )

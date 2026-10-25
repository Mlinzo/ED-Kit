from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app import canonn, db, views
from app.globe import ship_here
from app.projector import Projector

SA = 1183632560866
SYSTEM = "Col 285 Sector TT-H c10-4"
BODY = f"{SYSTEM} A 24"
CMDR = {"event": "Commander", "FID": "F1", "Name": "TEST", "timestamp": "2026-10-15T20:00:00Z"}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "test.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")  # events reference a fake journal file
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    return Projector(conn, position=lambda ts: (34.4, 30.3))


def feed(conn: sqlite3.Connection, proj: Projector, events: list[dict]) -> None:
    for ev in events:
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (
                conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1,
                ev["timestamp"],
                ev["event"],
                json.dumps(ev),
            ),
        )
        proj.apply(ev, int(cur.lastrowid))


def at(event: str, minute: int, **extra: object) -> dict:
    return {
        "timestamp": f"2026-10-15T20:{minute:02d}:00Z",
        "event": event,
        "StarSystem": SYSTEM,
        "SystemAddress": SA,
        **extra,
    }


def arrive() -> list[dict]:
    scan = at(
        "Scan",
        2,
        ScanType="Detailed",
        BodyName=BODY,
        BodyID=24,
        Parents=[{"Star": 1}],
        DistanceFromArrivalLS=1200.5,
        PlanetClass="Rocky body",
        Atmosphere="thin carbon dioxide atmosphere",
        MassEM=0.05,
        Radius=2_000_000.0,
        SurfaceGravity=2.0,
        SurfaceTemperature=180.0,
        Landable=True,
        WasDiscovered=False,
        WasMapped=False,
        WasFootfalled=False,
    )
    return [CMDR, at("FSDJump", 1, StarPos=[1.0, 2.0, 3.0], JumpDist=42.5), scan]


def touchdown(minute: int, lat: float, lon: float, player: bool = True) -> dict:
    return at(
        "Touchdown",
        minute,
        Body=BODY,
        BodyID=24,
        PlayerControlled=player,
        OnPlanet=True,
        Latitude=lat,
        Longitude=lon,
    )


def liftoff(minute: int, player: bool = True) -> dict:
    return at(
        "Liftoff",
        minute,
        Body=BODY,
        BodyID=24,
        PlayerControlled=player,
        OnPlanet=True,
        Latitude=10.0,
        Longitude=20.0,
    )


def organic(scan_type: str, minute: int) -> dict:
    return at(
        "ScanOrganic",
        minute,
        ScanType=scan_type,
        Genus="$Codex_Ent_Bacterial_Genus_Name;",
        Species="$Codex_Ent_Bacterial_01_Name;",
        Species_Localised="Bacterium Aurasus",
        Variant="$Codex_Ent_Bacterial_01_G_Name;",
        Body=24,
    )


def codex(minute: int, name: str, title: str, category: str, lat: float) -> dict:
    return at(
        "CodexEntry",
        minute,
        EntryID=1,
        Name=name,
        Name_Localised=title,
        Category=category,
        Region="$Codex_RegionName_18;",
        System=SYSTEM,
        BodyID=24,
        Latitude=lat,
        Longitude=-5.0,
    )


def globe(conn: sqlite3.Connection, **kwargs: object):
    view = views.surface_view(conn, "F1", None, **kwargs)  # type: ignore[arg-type]
    assert view.globe is not None
    return view.globe


def test_globe_places(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, arrive())
    feed(
        conn,
        proj,
        [
            touchdown(10, 1.5, 2.5),
            at(
                "ApproachSettlement",
                11,
                Name="$Ancient_Small_001:#index=1;",
                Name_Localised="Guardian Structure",
                BodyID=24,
                BodyName=BODY,
                Latitude=-3.0,
                Longitude=4.0,
            ),
            organic("Log", 20),
            codex(20, "$Codex_Ent_Bacterial_01_G_Name;", "Bacterium Aurasus - Emerald", "x", 34.4),
            codex(21, "$Codex_Ent_IceGeysers_Name;", "Water Ice Geysers", "$Codex_Category_G;", 7),
        ],
    )
    g = globe(conn)
    assert g.body_name == BODY and g.radius_m == 2_000_000.0
    kinds = {m.kind: m for m in g.marks}
    assert set(kinds) == {"sample", "codex", "landing", "settlement"}
    sample = kinds["sample"]
    assert (sample.lat, sample.lon, sample.n, sample.colour) == (34.4, 30.3, 1, "Emerald")
    assert sample.status == "sampling"
    # The bio codex entry is where sample 1 is: only the geysers stay as a codex mark.
    assert [m.name for m in g.marks if m.kind == "codex"] == ["Water Ice Geysers"]
    assert kinds["settlement"].name == "Guardian Structure"
    assert (kinds["landing"].lat, kinds["landing"].lon) == (1.5, 2.5)
    assert g.ship is not None and (g.ship.state, g.ship.lat) == ("landed", 1.5)
    # Offline and never looked up: no Canonn data, and nobody is asked.
    assert (g.community_state, g.community) == ("off", [])


def test_ship_follows_touchdown_and_liftoff(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [*arrive(), touchdown(10, 1.0, 1.0)])
    assert globe(conn).ship.state == "landed"  # type: ignore[union-attr]
    feed(conn, proj, [liftoff(12, player=False)])
    ship = globe(conn).ship
    assert ship is not None and (ship.state, ship.lat) == ("dismissed", None)
    feed(conn, proj, [touchdown(30, 2.0, 3.0, player=False)])
    ship = globe(conn).ship
    assert ship is not None and (ship.state, ship.lat, ship.lon) == ("recalled", 2.0, 3.0)
    assert len([m for m in globe(conn).marks if m.kind == "landing"]) == 2
    feed(conn, proj, [liftoff(40)])
    assert globe(conn).ship is None  # you flew off in it


def test_no_ship_after_death(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [*arrive(), touchdown(10, 1.0, 1.0)])
    assert ship_here(conn, "F1", SA, 24, SA) is not None
    feed(conn, proj, [at("Died", 15)])
    assert ship_here(conn, "F1", SA, 24, SA) is None
    assert ship_here(conn, "F1", SA, 24, None) is None  # not in this system


def test_no_globe_for_unlandable_or_unknown(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR])
    assert views.surface_view(conn, "F1", None).globe is None
    events = arrive()
    events[2] = {**events[2], "Landable": False}
    feed(conn, proj, [*events, at("ApproachBody", 5, Body=BODY, BodyID=24)])
    assert views.surface_view(conn, "F1", None).globe is None


CANONN_ANSWER = {
    "ScanOrganic": [
        {
            "body": "A 24",
            "english_name": "Bacterium Aurasus - Teal",
            "hud_category": "Biology",
            "latitude": "12.5",
            "longitude": "-40.25",
        },
        {
            "body": "A 24",
            "english_name": "Bacterium Aurasus - Teal",
            "hud_category": "Biology",
            "latitude": "12.5",
            "longitude": "-40.25",
        },
        {
            "body": "A 24",
            "english_name": "Osseus Discus - Blue",
            "hud_category": "Biology",
            "latitude": "1",
            "longitude": "2",
        },
        {
            "body": "A 25",
            "english_name": "Osseus Discus - Blue",
            "hud_category": "Biology",
            "latitude": "3",
            "longitude": "4",
        },
        {"body": "A 24", "english_name": "Broken", "latitude": None, "longitude": "4"},
    ],
    "codex": [
        {
            "body": "A 24",
            "english_name": "Bacterium Aurasus - Teal",
            "hud_category": "Biology",
            "latitude": "12.5",
            "longitude": "-40.25",
        },
        {
            "body": "A 24",
            "english_name": "Water Ice Geysers",
            "hud_category": "Geology",
            "latitude": "-7",
            "longitude": "8",
        },
    ],
}


def test_parse_points_drops_repeats_and_bad_rows() -> None:
    points = canonn.parse_points(CANONN_ANSWER)
    assert [(p["body"], p["name"]) for p in points] == [
        ("A 24", "Bacterium Aurasus - Teal"),
        ("A 24", "Osseus Discus - Blue"),
        ("A 25", "Osseus Discus - Blue"),
        ("A 24", "Water Ice Geysers"),
    ]
    assert points[0]["lat"] == 12.5 and points[0]["category"] == "Biology"
    assert canonn.parse_points(None) == [] and canonn.parse_points({"codex": "x"}) == []


def test_globe_community_finds(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [*arrive(), at("ApproachBody", 5, Body=BODY, BodyID=24), organic("Log", 20)])
    wanted: list[tuple[int, str]] = []
    g = globe(conn, online=True, want_finds=lambda a, n: wanted.append((a, n)))
    assert g.community_state == "loading" and wanted == [(SA, SYSTEM)]

    canonn.store(conn, canonn.Lookup(SA, canonn.parse_points(CANONN_ANSWER)))
    wanted.clear()
    g = globe(conn, online=True, want_finds=lambda a, n: wanted.append((a, n)))
    assert g.community_state == "ok" and g.community_at is not None and wanted == []
    assert [(f.name, f.category, len(f.points), f.yours) for f in g.community] == [
        ("Bacterium Aurasus - Teal", "Biology", 1, True),  # you sampled the species (Emerald)
        ("Osseus Discus - Blue", "Biology", 1, False),  # the A 25 point is another body's
        ("Water Ice Geysers", "Geology", 1, False),
    ]

    # A failed refresh keeps the points it had.
    canonn.store(conn, canonn.Lookup(SA, None))
    assert globe(conn, online=True).community_state == "ok"


def test_canonn_failure_is_retried_later(conn: sqlite3.Connection) -> None:
    canonn.store(conn, canonn.Lookup(SA, None))
    assert not canonn.needs_fetch(conn, SA)
    later = datetime.now(UTC) + timedelta(hours=2)
    assert canonn.needs_fetch(conn, SA, now=later)
    state, _, points = canonn.body_points(conn, SA, ("A 24",), online=True)
    assert (state, points) == ("failed", [])
    canonn.store(conn, canonn.Lookup(SA, []))
    assert canonn.body_points(conn, SA, ("A 24",), online=False)[0] == "ok"
    assert not canonn.needs_fetch(conn, SA, now=later)
    assert canonn.needs_fetch(conn, SA, now=datetime.now(UTC) + timedelta(hours=25))

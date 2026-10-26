from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import bookmarks, db, enrich, galaxy, history, views
from app.config import Settings
from app.main import create_app
from app.projector import Projector
from app.schemas import LiveStatus, SellPlaceView, SellStationView
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


def journey(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(A, "2026-10-16T17:00:05Z", "Location"),
        arrive(B, "2026-10-16T17:40:00Z"),
        planet(B, 5, "2026-10-16T17:42:00Z", "Rocky body", Landable=True),
    )


def test_systems_bodies_places_and_stations(conn: sqlite3.Connection, proj: Projector) -> None:
    journey(conn, proj)
    system = bookmarks.add(conn, "system", B, comment="  come back for the bio  ")
    assert bookmarks.add(conn, "system", B, comment="again") == system  # once per system
    bookmarks.add(conn, "body", B, body_id=5, category="bio", comment="landable? check")
    bookmarks.add(conn, "place", B, body_id=5, lat=10.5, lon=-20.25, category="mining")
    bookmarks.add(conn, "place", B, body_id=5, lat=11.0, lon=-21.0, title="Crash site")
    bookmarks.add(conn, "station", B, title="Hub")

    view = views.system_view(conn, "F1", B)
    assert view.bookmark is not None and view.bookmark.comment == "come back for the bio"
    assert view.bookmark.category == "other"  # untagged
    body = next(b for b in view.bodies if b.body_id == 5)
    assert body.bookmark is not None and body.bookmark.category == "bio"
    assert body.bookmark.body_name == "Beta 5"  # from the journal
    assert [(p.lat, p.title, p.category) for p in body.places] == [
        (10.5, None, "mining"),
        (11.0, "Crash site", "other"),
    ]
    assert [(s.title, s.category) for s in view.stations] == [("Hub", "trade")]

    # Name and position come from the journal when the UI does not send them.
    assert (view.bookmark.system_name, view.bookmark.kind) == ("Beta", "system")
    row = conn.execute("SELECT x FROM bookmarks WHERE kind = 'system'").fetchone()
    assert row["x"] == float(B)

    entries = {e.name: e for e in history.history_view(conn, "F1").systems}
    assert entries["Beta"].bookmark is not None and entries["Beta"].inner_bookmarks == 4
    assert entries["Alpha"].bookmark is None and entries["Alpha"].inner_bookmarks == 0

    placed = galaxy.galaxy_view(conn, "F1", [], []).bookmarks
    assert [(p.name, p.bookmark.comment if p.bookmark else None, p.inner) for p in placed] == [
        ("Beta", "come back for the bio", 4)
    ]

    assert bookmarks.update(conn, system, category="scenic", comment="")
    assert bookmarks.get(conn, system).category == "scenic"  # type: ignore[union-attr]
    assert bookmarks.get(conn, system).comment == ""  # type: ignore[union-attr]
    assert bookmarks.delete(conn, system)
    assert not bookmarks.delete(conn, system)
    assert views.system_view(conn, "F1", B).bookmark is None


def test_what_cannot_be_bookmarked(conn: sqlite3.Connection) -> None:
    with pytest.raises(ValueError):
        bookmarks.add(conn, "place", B, body_id=5)  # no latitude, longitude
    with pytest.raises(ValueError):
        bookmarks.add(conn, "station", B)  # no name
    with pytest.raises(ValueError):
        bookmarks.add(conn, "system", B, category="treasure")


def test_a_system_you_have_not_been_to(conn: sqlite3.Connection) -> None:
    # Ahead on a route: the UI sends the name and the position.
    bookmarks.add(
        conn, "system", 77, comment="probably untouched", system_name="Far", pos=(1, 2, 3)
    )
    found = views.system_view(conn, None, 77).bookmark
    assert found is not None and found.comment == "probably untouched"
    placed = galaxy.galaxy_view(conn, None, [], []).bookmarks
    assert [(p.address, p.name, p.x, p.z) for p in placed] == [("77", "Far", 1.0, 3.0)]

    # From the community data once it is in.
    enrich.store(
        conn, enrich.ExternalSystem(address=88, source=None, name="Known", star_pos=(4, 5, 6))
    )
    bookmarks.add(conn, "station", 88, title="Far Port")
    row = conn.execute("SELECT system_name, x FROM bookmarks WHERE system_address = 88").fetchone()
    assert tuple(row) == ("Known", 4.0)


def test_notes_become_bookmarks(tmp_path: Path) -> None:
    # A database from before 2026-10-26 kept notes.
    c = db.connect(tmp_path / "old.db")
    c.executescript(
        "CREATE TABLE notes(system_address INTEGER NOT NULL, body_id INTEGER NOT NULL, "
        "text TEXT NOT NULL, updated_at TEXT NOT NULL, system_name TEXT, body_name TEXT, "
        "x REAL, y REAL, z REAL, PRIMARY KEY(system_address, body_id)) STRICT;"
    )
    c.execute(
        "INSERT INTO notes VALUES(5, -1, 'good system', '2026-10-20T10:00:00+00:00', 'Five', "
        "NULL, 1, 2, 3)"
    )
    c.execute(
        "INSERT INTO notes VALUES(5, 7, 'ring!', '2026-10-21T10:00:00+00:00', 'Five', 'Five 7', "
        "1, 2, 3)"
    )
    db.init_schema(c)
    db.init_schema(c)  # once only
    rows = c.execute(
        "SELECT kind, body_id, comment, category, created_at, body_name FROM bookmarks ORDER BY id"
    ).fetchall()
    assert [tuple(r) for r in rows] == [
        ("system", None, "good system", "other", "2026-10-20T10:00:00+00:00", None),
        ("body", 7, "ring!", "other", "2026-10-21T10:00:00+00:00", "Five 7"),
    ]
    assert c.execute("SELECT name FROM sqlite_master WHERE name = 'notes'").fetchone() is None


def test_where_you_are(conn: sqlite3.Connection, proj: Projector) -> None:
    journey(conn, proj)
    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-16T17:50:00Z",
            "event": "Touchdown",
            "SystemAddress": B,
            "Body": "Beta 5",
            "BodyID": 5,
            "OnPlanet": True,
            "PlayerControlled": True,
            "Latitude": 1.0,
            "Longitude": 2.0,
        },
    )
    here = bookmarks.here(conn, "F1")
    assert (here.system_name, here.body_id, here.body_name, here.station) == (
        "Beta",
        5,
        "Beta 5",
        None,
    )
    live = LiveStatus(has_lat_long=True, lat=3.25, lon=4.5, body_name="Beta 5", landed=True)
    place = bookmarks.get(conn, bookmarks.add_here(conn, "F1", live, "place", comment="ore"))
    assert place is not None
    assert (place.kind, place.body_id, place.lat, place.lon, place.comment) == (
        "place",
        5,
        3.25,
        4.5,
        "ore",
    )
    with pytest.raises(ValueError):
        bookmarks.add_here(conn, "F1", live, "station")  # not docked

    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-16T18:00:00Z",
            "event": "Docked",
            "StationName": "Beta Port",
            "StationType": "Coriolis",
            "SystemAddress": B,
            "StarSystem": "Beta",
            "MarketID": 1,
            "StationServices": [],
        },
    )
    assert bookmarks.here(conn, "F1").station == "Beta Port"
    docked = LiveStatus(docked=True)
    station = bookmarks.get(conn, bookmarks.add_here(conn, "F1", docked, "station"))
    assert station is not None and (station.title, station.category) == ("Beta Port", "trade")

    listed = bookmarks.bookmarks_view(conn, "F1")
    assert [(m.kind, m.distance_ly) for m in listed.items] == [("station", 0.0), ("place", 0.0)]


def test_stations_of_where_to_sell_carry_their_bookmark(conn: sqlite3.Connection) -> None:
    bookmarks.add(conn, "station", 9, title="Hub", comment="cheap fuel")

    def station(name: str) -> SellStationView:
        return SellStationView(
            name=name,
            kind="starport",
            dist_ls=10,
            cartographics=True,
            genomics=True,
            seen_at=None,
            docked=False,
            access=None,
            permit=False,
        )

    places = [
        SellPlaceView(
            system_name="Nine",
            system_address="9",
            distance_ly=1.0,
            jumps=1,
            stations=[station("Hub"), station("Other")],
            more=0,
        )
    ]
    marked = bookmarks.mark_stations(conn, places)
    assert [s.bookmark.comment if s.bookmark else None for s in marked[0].stations] == [
        "cheap fuel",
        None,
    ]
    assert places[0].stations[0].bookmark is None  # the given views are left as they were


def test_bookmark_api(tmp_path: Path) -> None:
    settings = Settings(
        journal_dir=tmp_path / "journals", data_dir=tmp_path / "data", static_dir=None, online=False
    )
    with TestClient(create_app(settings)) as client:
        body = {
            "kind": "system",
            "systemAddress": "2931055102291",
            "comment": "mine",
            "systemName": "X",
            "x": 1,
            "y": 2,
            "z": 3,
        }
        made = client.post("/api/bookmarks", json=body)
        assert made.status_code == 200
        mark = made.json()
        assert (mark["kind"], mark["comment"], mark["category"]) == ("system", "mine", "other")
        assert client.post("/api/bookmarks", json=body).json()["id"] == mark["id"]
        view = client.get("/api/view/system", params={"address": 2931055102291}).json()
        assert view["bookmark"]["comment"] == "mine"
        galaxy_marks = client.get("/api/view/galaxy").json()["bookmarks"]
        assert [(g["address"], g["name"], g["inner"]) for g in galaxy_marks] == [
            ("2931055102291", "X", 0)
        ]

        changed = client.put(
            f"/api/bookmarks/{mark['id']}", json={"category": "scenic", "comment": "view!"}
        ).json()
        assert (changed["category"], changed["comment"]) == ("scenic", "view!")
        place = {"kind": "place", "systemAddress": "2931055102291", "bodyId": 3}
        assert client.post("/api/bookmarks", json=place).status_code == 422  # no lat, lon
        made_place = client.post("/api/bookmarks", json={**place, "lat": 1.5, "lon": 2.5})
        assert made_place.json()["lat"] == 1.5
        assert client.post("/api/bookmarks", json={**body, "category": "x"}).status_code == 422
        assert client.post("/api/bookmarks", json={**body, "systemAddress": "x"}).status_code == 422
        listed = client.get("/api/view/bookmarks").json()
        assert [m["kind"] for m in listed["items"]] == ["place", "system"]
        assert listed["here"]["systemAddress"] is None
        assert client.post("/api/bookmarks/here", json={"what": "system"}).status_code == 409

        assert client.delete(f"/api/bookmarks/{mark['id']}").status_code == 204
        assert client.delete(f"/api/bookmarks/{mark['id']}").status_code == 404
        assert client.put(f"/api/bookmarks/{mark['id']}", json={}).status_code == 404
        assert client.get("/api/view/galaxy").json()["bookmarks"][0]["bookmark"] is None

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, facts, galaxy, regionmap
from app.config import Settings
from app.exobio.regions import CODEX_REGIONS, region_key
from app.main import create_app
from app.projector import Projector

CMDR = {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


def feed(conn: sqlite3.Connection, *events: dict) -> None:
    proj = Projector(conn)
    for ev in events:
        n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (n, ev["timestamp"], ev["event"], json.dumps(ev)),
        )
        proj.apply(ev, int(cur.lastrowid))


def jump(address: int, ts: str, x: float, z: float = 0.0) -> dict:
    return {
        "timestamp": ts,
        "event": "FSDJump",
        "StarSystem": f"Sys {address}",
        "SystemAddress": address,
        "StarPos": [x, 0.0, z],
        "JumpDist": 10.0,
    }


def codex(address: int, ts: str, name: str, region: int) -> dict:
    return {
        "timestamp": ts,
        "event": "CodexEntry",
        "EntryID": 2320105,
        "Name": name,
        "Category": "$Codex_Category_Biology;",
        "Region": f"$Codex_RegionName_{region};",
        "SystemAddress": address,
        "BodyID": 5,
    }


def test_regions_of_known_places() -> None:
    assert regionmap.region_at(0, 0) == 18  # Sol: Inner Orion Spur
    assert regionmap.name(18) == "Inner Orion Spur"
    assert regionmap.region_at(25.21875, 25899.96875) == 1  # Sagittarius A*: Galactic Centre
    assert regionmap.region_at(200_000, 0) is None  # off the map
    assert regionmap.region_at(-49_000, -24_000) is None  # on the map, outside the galaxy


def test_map_names_are_the_codex_regions() -> None:
    names = json.loads(regionmap.DATA.read_text("utf-8"))["regions"]
    assert names[0] is None
    assert [region_key(n) for n in names[1:]] == [region_key(n) for n in CODEX_REGIONS]


def test_region_symbols() -> None:
    assert regionmap.region_symbol(18) == "$Codex_RegionName_18;"
    assert regionmap.region_symbol(None) is None
    assert regionmap.region_number("$Codex_RegionName_18;") == 18
    assert regionmap.region_number("$Codex_RegionName_99;") is None
    assert regionmap.region_number("Inner Orion Spur") is None


def test_system_region_from_the_map_until_a_codex_entry(conn: sqlite3.Connection) -> None:
    feed(conn, CMDR, jump(1, "2026-10-17T10:01:00Z", 0.0))
    system = facts.load_system(conn, 1, community=False)
    assert system is not None and system.region == "$Codex_RegionName_18;"
    # The journal's word wins (here deliberately not the map's).
    feed(conn, codex(1, "2026-10-17T10:02:00Z", "$Codex_Ent_Bacterial_01_G_Name;", 9))
    system = facts.load_system(conn, 1, community=False)
    assert system is not None and system.region == "$Codex_RegionName_9;"


def test_galaxy_regions(conn: sqlite3.Connection) -> None:
    feed(
        conn,
        CMDR,
        jump(1, "2026-10-17T10:01:00Z", 0.0),
        jump(2, "2026-10-17T10:02:00Z", 10.0),
        codex(2, "2026-10-17T10:03:00Z", "$Codex_Ent_Bacterial_01_G_Name;", 18),
        codex(2, "2026-10-17T10:04:00Z", "$Codex_Ent_Bacterial_01_G_Name;", 18),  # again
        jump(3, "2026-10-17T10:05:00Z", 20.0),
        codex(3, "2026-10-17T10:06:00Z", "$Codex_Ent_Bacterial_02_G_Name;", 9),
    )
    view = galaxy.galaxy_view(conn, "F1", [], [])
    assert [s.region for s in view.systems] == [18, 18, 9]
    assert view.region == 9
    assert [(r.id, r.name, r.systems, r.codex, r.species) for r in view.regions] == [
        (18, "Inner Orion Spur", 2, 1, 1),
        (9, "Inner Scutum-Centaurus Arm", 1, 1, 1),
    ]
    assert view.regions[0].first_visit_at == "2026-10-17T10:01:00Z"


def test_region_map_endpoint(tmp_path: Path) -> None:
    settings = Settings(
        journal_dir=tmp_path / "journals",
        data_dir=tmp_path / "data",
        static_dir=None,
        online=False,
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/regions")
        assert response.status_code == 200
        assert "max-age" in response.headers["cache-control"]
        grid = response.json()
        assert grid["size"] == 2048 and len(grid["rows"]) == 2048
        assert grid["names"][17] == "Inner Orion Spur"
        # Every row covers the whole width.
        assert all(sum(row[0::2]) == 2048 for row in grid["rows"])

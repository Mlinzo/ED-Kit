from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app import db, views
from app.projector import Projector

SA = 1183632560866
CMDR = {"event": "Commander", "FID": "F1", "Name": "TEST", "timestamp": "2026-10-15T20:00:00Z"}


def scan_planet(body_id: int = 24, **extra: object) -> dict:
    ev = {
        "timestamp": "2026-10-15T20:30:00Z",
        "event": "Scan",
        "ScanType": "Detailed",
        "BodyName": f"Col 285 Sector TT-H c10-4 A {body_id}",
        "BodyID": body_id,
        "Parents": [{"Star": 1}],
        "StarSystem": "Col 285 Sector TT-H c10-4",
        "SystemAddress": SA,
        "DistanceFromArrivalLS": 1200.5,
        "PlanetClass": "Rocky body",
        "TerraformState": "",
        "Atmosphere": "thin carbon dioxide atmosphere",
        "AtmosphereType": "CarbonDioxide",
        "Volcanism": "",
        "MassEM": 0.05,
        "Radius": 2_000_000.0,
        "SurfaceGravity": 2.0,
        "SurfaceTemperature": 180.0,
        "SurfacePressure": 1500.0,
        "Landable": True,
        "WasDiscovered": False,
        "WasMapped": False,
        "WasFootfalled": False,
    }
    ev.update(extra)
    return ev


def organic(scan_type: str, ts: str, species: str = "$Codex_Ent_Bacterial_01_Name;") -> dict:
    return {
        "timestamp": ts,
        "event": "ScanOrganic",
        "ScanType": scan_type,
        "Genus": "$Codex_Ent_Bacterial_Genus_Name;",
        "Species": species,
        "Species_Localised": "Bacterium Aurasus",
        "Variant": "$Codex_Ent_Bacterial_01_G_Name;",
        "SystemAddress": SA,
        "Body": 24,
    }


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "test.db")
    db.init_schema(c)
    return c


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


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    conn.execute("PRAGMA foreign_keys=OFF")  # events reference a fake journal file
    return Projector(conn, position=lambda ts: (34.4, 30.3))


def jump(ts: str = "2026-10-15T20:10:00Z") -> dict:
    return {
        "timestamp": ts,
        "event": "FSDJump",
        "StarSystem": "Col 285 Sector TT-H c10-4",
        "SystemAddress": SA,
        "StarPos": [1.0, 2.0, 3.0],
        "JumpDist": 42.5,
    }


def test_sampling_flow(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump(), scan_planet()])
    feed(
        conn,
        proj,
        [organic("Log", "2026-10-15T20:48:52Z"), organic("Sample", "2026-10-15T20:50:00Z")],
    )

    surface = views.surface_view(conn, "F1", None)
    assert surface.active_scan is not None
    assert surface.active_scan.samples == 2
    assert len(surface.active_scan.points) == 2
    assert surface.body is not None and surface.body.body_id == 24

    feed(
        conn,
        proj,
        [organic("Sample", "2026-10-15T20:52:00Z"), organic("Analyse", "2026-10-15T20:52:05Z")],
    )
    surface = views.surface_view(conn, "F1", None)
    assert surface.active_scan is None
    row = conn.execute("SELECT status, sale, first_footfall FROM organic_scans").fetchone()
    assert (row["status"], row["sale"], row["first_footfall"]) == ("analysed", "unsold", 1)

    session = views.session_view(conn, "F1")
    assert session.unsold_bio_count == 1
    assert session.jumps == 1 and session.distance_ly == 42.5


def test_new_species_abandons_unfinished(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump(), scan_planet()])
    feed(conn, proj, [organic("Log", "2026-10-15T20:48:52Z")])
    feed(
        conn,
        proj,
        [organic("Log", "2026-10-15T20:49:52Z", species="$Codex_Ent_Bacterial_12_Name;")],
    )
    statuses = [r[0] for r in conn.execute("SELECT status FROM organic_scans ORDER BY id")]
    assert statuses == ["abandoned", "sampling"]


def test_sale_and_death(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump(), scan_planet(), scan_planet(body_id=25)])
    for t, ts in (
        ("Log", "20:48:52"),
        ("Sample", "20:50:00"),
        ("Sample", "20:52:00"),
        ("Analyse", "20:52:05"),
    ):
        feed(conn, proj, [organic(t, f"2026-10-15T{ts}Z")])
    assert views.session_view(conn, "F1").unsold_carto_bodies == 2

    feed(
        conn,
        proj,
        [
            {
                "timestamp": "2026-10-15T21:40:46Z",
                "event": "SellOrganicData",
                "BioData": [
                    {
                        "Species": "$Codex_Ent_Bacterial_01_Name;",
                        "Value": 1_000_000,
                        "Bonus": 4_000_000,
                    }
                ],
            }
        ],
    )
    session = views.session_view(conn, "F1")
    assert session.unsold_bio_count == 0
    assert session.last_sale_at == "2026-10-15T21:40:46Z"

    feed(
        conn,
        proj,
        [
            {
                "timestamp": "2026-10-15T22:00:00Z",
                "event": "Died",
                "KillerName": "Jed Telford",
                "KillerShip": "federation_gunship",
                "KillerRank": "Deadly",
            },
            {
                "timestamp": "2026-10-15T22:02:00Z",
                "event": "Resurrect",
                "Option": "rebuy",
                "Cost": 384203,
                "Bankrupt": False,
            },
        ],
    )
    from app import stats

    history = stats.stats_view(conn, "F1").death_history
    assert len(history) == 1
    death = history[0]
    assert death.context == "ship" and death.system == "Col 285 Sector TT-H c10-4"
    assert death.killers[0].name == "Jed Telford" and death.killers[0].ship == "federation_gunship"
    assert death.lost_carto_bodies == 2 and death.lost_bio_count == 0  # bio was sold before
    assert death.rebuy_option == "rebuy" and death.rebuy_cost == 384203
    session = views.session_view(conn, "F1")
    assert session.unsold_carto_bodies == 0  # ship death loses cartographic data

    feed(conn, proj, [scan_planet(timestamp="2026-10-15T23:00:00Z")])
    assert views.session_view(conn, "F1").unsold_carto_bodies == 1  # re-scanned after death


def test_carto_sale_marks_system_sold(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump(), scan_planet()])
    feed(
        conn,
        proj,
        [
            {
                "timestamp": "2026-10-16T10:00:00Z",
                "event": "MultiSellExplorationData",
                "Discovered": [{"SystemName": "Col 285 Sector TT-H c10-4", "NumBodies": 1}],
                "BaseValue": 1000,
                "Bonus": 0,
                "TotalEarnings": 1000,
            }
        ],
    )
    session = views.session_view(conn, "F1")
    assert session.unsold_carto_bodies == 0
    assert session.jumps == 0


def bio_signals(count: int, body_id: int = 24) -> dict:
    return {
        "timestamp": "2026-10-15T20:31:00Z",
        "event": "FSSBodySignals",
        "BodyID": body_id,
        "SystemAddress": SA,
        "BodyName": "x",
        "Signals": [{"Type": "$SAA_SignalType_Biological;", "Count": count}],
    }


def test_genus_deduced_before_dss(conn: sqlite3.Connection, proj: Projector) -> None:
    # Thin neon at 40 K: only a Bacterium can grow there.
    neon = dict(
        PlanetClass="Icy body",
        Atmosphere="thin neon atmosphere",
        AtmosphereType="Neon",
        SurfaceTemperature=40.0,
        SurfaceGravity=2.94,
        SurfacePressure=200.0,
    )
    feed(conn, proj, [CMDR, jump(), scan_planet(**neon), bio_signals(1)])
    body = views.system_view(conn, "F1").bodies[0]
    assert body.genuses == []  # no DSS yet
    assert body.species and all(s.genus == "Bacterium" for s in body.species)
    assert all(s.certain and s.deduced for s in body.species)
    assert (body.codex_new, body.codex_maybe) == (1, 0)

    feed(conn, proj, [bio_signals(2)])  # a genus the rules do not foresee: no conclusion
    body = views.system_view(conn, "F1").bodies[0]
    assert not any(s.certain or s.deduced for s in body.species)
    assert (body.codex_new, body.codex_maybe) == (0, 1)


def test_system_view_lists_bodies(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(conn, proj, [CMDR, jump(), scan_planet()])
    feed(
        conn,
        proj,
        [
            {
                "timestamp": "2026-10-15T20:31:00Z",
                "event": "FSSBodySignals",
                "BodyID": 24,
                "SystemAddress": SA,
                "BodyName": "x",
                "Signals": [{"Type": "$SAA_SignalType_Biological;", "Count": 2}],
            }
        ],
    )
    view = views.system_view(conn, "F1")
    assert view.name == "Col 285 Sector TT-H c10-4"
    assert len(view.bodies) == 1
    body = view.bodies[0]
    assert body.short_name == "A 24"
    assert body.signals.bio == 2
    assert body.id64 == str(SA | (24 << 55))
    dumped = view.model_dump(by_alias=True)
    assert "scannedCount" in dumped and "shortName" in dumped["bodies"][0]

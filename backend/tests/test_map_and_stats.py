from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app import db, stats, views
from app.projector import Projector

SA = 7270171747753
SYSTEM = "Col 285 Sector TY-W b16-3"


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    return Projector(conn, position=lambda ts: (1.0, 2.0))


def feed(conn: sqlite3.Connection, proj: Projector, *events: dict) -> None:
    for ev in events:
        n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (n, ev["timestamp"], ev["event"], json.dumps(ev)),
        )
        proj.apply(ev, int(cur.lastrowid))


def scan(body_id: int, name: str, parents: list[dict], **extra: object) -> dict:
    ev = {
        "timestamp": "2026-10-16T18:00:00Z",
        "event": "Scan",
        "ScanType": "Detailed",
        "BodyName": f"{SYSTEM} {name}",
        "BodyID": body_id,
        "Parents": parents,
        "StarSystem": SYSTEM,
        "SystemAddress": SA,
        "DistanceFromArrivalLS": 100.0,
        "SemiMajorAxis": 1.0e10 * body_id,
        "Eccentricity": 0.01,
        "OrbitalInclination": 0.5,
        "Periapsis": 10.0,
        "OrbitalPeriod": 1.0e7,
        "AscendingNode": 20.0,
        "MeanAnomaly": 30.0,
        "WasDiscovered": True,
        "WasMapped": False,
    }
    ev.update(extra)
    return ev


def star(body_id: int, name: str, star_type: str = "M") -> dict:
    return scan(
        body_id,
        name,
        [{"Null": 0}],
        StarType=star_type,
        Subclass=5,
        StellarMass=0.4,
        Radius=3.0e8,
        SurfaceTemperature=3000.0,
        Luminosity="Va",
    )


def planet(
    body_id: int, name: str, parents: list[dict], planet_class: str = "Icy body", **extra: object
) -> dict:
    fields: dict[str, object] = {
        "PlanetClass": planet_class,
        "TerraformState": "",
        "Atmosphere": "",
        "AtmosphereType": "None",
        "Volcanism": "",
        "MassEM": 0.1,
        "Radius": 3.0e6,
        "SurfaceGravity": 2.0,
        "SurfaceTemperature": 100.0,
        "Landable": True,
    }
    return scan(body_id, name, parents, **{**fields, **extra})


CMDR = {"timestamp": "2026-10-16T17:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}
JUMP = {
    "timestamp": "2026-10-16T17:30:00Z",
    "event": "FSDJump",
    "StarSystem": SYSTEM,
    "SystemAddress": SA,
    "StarPos": [30.0, 40.0, 0.0],
    "JumpDist": 12.5,
}


def test_binary_system_tree(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A"),
        star(2, "B"),
        planet(22, "B 6", [{"Null": 21}, {"Star": 2}, {"Null": 0}]),
        planet(23, "B 7", [{"Null": 21}, {"Star": 2}, {"Null": 0}]),
        planet(20, "B 5 a", [{"Planet": 19}, {"Star": 2}, {"Null": 0}]),
        {
            "timestamp": "2026-10-16T18:01:00Z",
            "event": "ScanBaryCentre",
            "StarSystem": SYSTEM,
            "SystemAddress": SA,
            "BodyID": 21,
            "SemiMajorAxis": 3.9e7,
            "Eccentricity": 0.0,
            "OrbitalInclination": 0.0,
            "Periapsis": 0.0,
            "OrbitalPeriod": 1.0e5,
            "AscendingNode": 0.0,
            "MeanAnomaly": 90.0,
        },
    )
    view = views.system_view(conn, "F1")
    bary = {b.body_id: b for b in view.barycentres}
    assert set(bary) == {0, 21}
    assert [(p.kind, p.body_id) for p in bary[21].parents] == [("Star", 2), ("Null", 0)]
    assert bary[21].orbit is not None and bary[21].orbit.mean_anomaly_deg == 90.0
    assert bary[0].orbit is None and bary[0].parents == []

    b6 = next(b for b in view.bodies if b.body_id == 22)
    assert [(p.kind, p.body_id) for p in b6.parents] == [("Null", 21), ("Star", 2), ("Null", 0)]
    assert b6.orbit is not None and b6.orbit.semi_major_axis_m == 2.2e11
    assert b6.visual.planet_class == "Icy body"
    # moon of an unscanned planet keeps the reference; the frontend draws a placeholder
    moon = next(b for b in view.bodies if b.body_id == 20)
    assert moon.parents[0].kind == "Planet" and moon.parents[0].body_id == 19

    dumped = view.model_dump(by_alias=True)
    assert {"barycentres", "bodies"} <= dumped.keys()
    assert {"parents", "orbit", "visual", "interest", "reasons", "done", "bioDone"} <= set(
        dumped["bodies"][0]
    )


def test_interest_and_done(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A"),
        planet(
            5,
            "A 5",
            [{"Star": 1}, {"Null": 0}],
            Atmosphere="thin argon atmosphere",
            AtmosphereType="Argon",
        ),
        planet(6, "A 6", [{"Star": 1}, {"Null": 0}]),
        {
            "timestamp": "2026-10-16T18:02:00Z",
            "event": "FSSBodySignals",
            "SystemAddress": SA,
            "BodyID": 5,
            "BodyName": "x",
            "Signals": [{"Type": "$SAA_SignalType_Biological;", "Count": 1}],
        },
    )
    bodies = {b.body_id: b for b in views.system_view(conn, "F1").bodies}
    assert bodies[5].interest == "high" and "bio" in bodies[5].reasons and not bodies[5].done
    assert bodies[6].interest == "low" and not bodies[6].done
    assert bodies[1].interest in ("medium", "high")  # stars are never dimmed

    organic = {
        "event": "ScanOrganic",
        "Genus": "$Codex_Ent_Bacterial_Genus_Name;",
        "Species": "$Codex_Ent_Bacterial_01_Name;",
        "SystemAddress": SA,
        "Body": 5,
    }
    for kind, ts in (
        ("Log", "18:10"),
        ("Sample", "18:11"),
        ("Sample", "18:12"),
        ("Analyse", "18:13"),
    ):
        feed(conn, proj, {**organic, "ScanType": kind, "timestamp": f"2026-10-16T{ts}:00Z"})
    body = next(b for b in views.system_view(conn, "F1").bodies if b.body_id == 5)
    assert body.bio_done == 1 and body.done and body.interest == "medium"


def test_stats_view(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A", star_type="N"),
        planet(
            9,
            "A 3",
            [{"Star": 1}, {"Null": 0}],
            planet_class="Water world",
            TerraformState="Terraformable",
            Landable=False,
        ),
        {
            "timestamp": "2026-10-16T18:05:00Z",
            "event": "SAAScanComplete",
            "SystemAddress": SA,
            "BodyID": 9,
            "BodyName": "x",
            "ProbesUsed": 5,
            "EfficiencyTarget": 6,
        },
        {
            "timestamp": "2026-10-16T19:00:00Z",
            "event": "MultiSellExplorationData",
            "Discovered": [{"SystemName": SYSTEM, "NumBodies": 2}],
            "BaseValue": 500000,
            "Bonus": 0,
            "TotalEarnings": 500000,
        },
    )
    s = stats.stats_view(conn, "F1")
    assert s.commander == "T"
    assert s.jumps == 1 and s.distance_ly == 12.5 and s.systems_visited == 1
    assert s.farthest_from_sol is not None and s.farthest_from_sol.value == 50.0
    assert s.bodies_scanned == 2 and s.stars_scanned == 1 and s.planets_scanned == 1
    assert s.bodies_mapped == 1 and s.efficient_maps == 1 and s.first_mapped == 1
    notable = {c.key: c.count for c in s.notable}
    assert notable["ww"] == 1 and notable["neutron"] == 1 and notable["terraformable"] == 1
    assert s.earnings_carto == 500000 and s.biggest_sale is not None
    assert s.most_valuable_bodies[0].name.endswith("A 3")
    assert s.genera_total >= 20 and s.species_total >= 100
    assert len(s.genus_progress) == s.genera_total
    assert s.timeline and s.timeline[-1].date == "2026-10-16"
    assert s.timeline[-1].earnings == 500000


def test_firsts_footfall_and_codex(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A"),
        planet(
            5,
            "A 5",
            [{"Star": 1}, {"Null": 0}],
            Atmosphere="thin argon atmosphere",
            AtmosphereType="Argon",
            WasDiscovered=False,
            WasMapped=False,
            WasFootfalled=False,
        ),
        {
            "timestamp": "2026-10-16T18:05:00Z",
            "event": "SAAScanComplete",
            "SystemAddress": SA,
            "BodyID": 5,
            "BodyName": "x",
            "ProbesUsed": 5,
            "EfficiencyTarget": 6,
        },
        {
            "timestamp": "2026-10-16T18:20:00Z",
            "event": "Disembark",
            "SRV": False,
            "OnPlanet": True,
            "SystemAddress": SA,
            "BodyID": 5,
            "Body": f"{SYSTEM} A 5",
        },
        {
            "timestamp": "2026-10-16T18:30:00Z",
            "event": "CodexEntry",
            "EntryID": 2320105,
            "Name": "$Codex_Ent_Bacterial_01_G_Name;",
            "Category": "$Codex_Category_Biology;",
            "Region": "$Codex_RegionName_18;",
            "SystemAddress": SA,
            "BodyID": 5,
        },
    )
    s = stats.stats_view(conn, "F1")
    entry = next(f for f in s.firsts if f.short_name == "A 5")
    assert entry.discovered == "pending" and entry.mapped == "pending"
    assert entry.footfall_at == "2026-10-16T18:20:00Z"
    assert s.first_footfalls_total == 1 and s.first_discoveries_sold == 0

    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-16T19:00:00Z",
            "event": "MultiSellExplorationData",
            "Discovered": [{"SystemName": SYSTEM, "NumBodies": 2}],
            "BaseValue": 1,
            "Bonus": 0,
            "TotalEarnings": 1,
        },
    )
    s = stats.stats_view(conn, "F1")
    assert s.first_discoveries_sold == 1 and s.first_mapped_sold == 1
    assert next(f for f in s.firsts if f.short_name == "A 5").discovered == "sold"

    index = views.codex_index(conn, "F1")
    assert (
        views.codex_status(index, "$Codex_Ent_Bacterial_01_Name;", "$Codex_RegionName_18;")
        == "logged"
    )
    assert (
        views.codex_status(index, "$Codex_Ent_Bacterial_01_Name;", "$Codex_RegionName_7;")
        == "new_region"
    )
    assert views.codex_status(index, "$Codex_Ent_Stratum_07_Name;", None) == "new"


def test_thresholds_dim_cheap_bodies(conn: sqlite3.Connection, proj: Projector) -> None:
    from app import usersettings
    from app.schemas import HighlightSettings

    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A"),
        planet(
            5,
            "A 5",
            [{"Star": 1}, {"Null": 0}],
            Atmosphere="thin argon atmosphere",
            AtmosphereType="Argon",
        ),
        {
            "timestamp": "2026-10-16T18:02:00Z",
            "event": "FSSBodySignals",
            "SystemAddress": SA,
            "BodyID": 5,
            "BodyName": "x",
            "Signals": [{"Type": "$SAA_SignalType_Biological;", "Count": 1}],
        },
    )
    usersettings.save(conn, HighlightSettings(dss_min=10**12, bio_min=10**12))
    body = next(b for b in views.system_view(conn, "F1").bodies if b.body_id == 5)
    assert body.interest != "high" and "bio" in body.reasons  # still listed, not highlighted
    usersettings.save(conn, HighlightSettings(dss_min=0, bio_min=0))
    body = next(b for b in views.system_view(conn, "F1").bodies if b.body_id == 5)
    assert body.interest == "high"


def test_active_scan_stays_new_after_its_own_codex_entry(
    conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A"),
        planet(
            5,
            "A 5",
            [{"Star": 1}, {"Null": 0}],
            Atmosphere="thin argon atmosphere",
            AtmosphereType="Argon",
        ),
        {
            "timestamp": "2026-10-16T18:30:00Z",
            "event": "ScanOrganic",
            "ScanType": "Log",
            "Genus": "$Codex_Ent_Bacterial_Genus_Name;",
            "Species": "$Codex_Ent_Bacterial_01_Name;",
            "SystemAddress": SA,
            "Body": 5,
        },
        {
            "timestamp": "2026-10-16T18:30:00Z",
            "event": "CodexEntry",
            "EntryID": 2320105,
            "Name": "$Codex_Ent_Bacterial_01_G_Name;",
            "Category": "$Codex_Category_Biology;",
            "Region": "$Codex_RegionName_18;",
            "SystemAddress": SA,
            "BodyID": 5,
        },
    )
    surface = views.surface_view(conn, "F1", None)
    assert surface.active_scan is not None and surface.active_scan.codex == "new"
    sampling = next(s for s in surface.body.species if s.status == "sampling")
    assert sampling.codex == "new"


def test_inefficient_mapping_drops_efficiency_bonus(
    conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(
        conn,
        proj,
        CMDR,
        JUMP,
        star(1, "A"),
        planet(9, "A 3", [{"Star": 1}, {"Null": 0}], planet_class="Water world", Landable=False),
    )
    before = next(b for b in views.system_view(conn, "F1").bodies if b.body_id == 9).dss_value
    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-16T18:05:00Z",
            "event": "SAAScanComplete",
            "SystemAddress": SA,
            "BodyID": 9,
            "BodyName": "x",
            "ProbesUsed": 9,
            "EfficiencyTarget": 6,
        },
    )
    after = next(b for b in views.system_view(conn, "F1").bodies if b.body_id == 9).dss_value
    assert after < before  # no x1.25 efficiency bonus once we know the target was missed

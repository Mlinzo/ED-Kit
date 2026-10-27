from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app import db, enrich, exobio, views
from app.facts import load_system
from app.projector import Projector

FIXTURE = Path(__file__).parent / "fixtures" / "spansh_cd23_5548.json"
SA = 633809670858
SYSTEM = "CD-23 5548"


def spansh_system() -> enrich.ExternalSystem:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))["system"]
    return enrich.parse_system(SA, data["bodies"], "spansh", data["bodyCount"])


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


def feed(conn: sqlite3.Connection, proj: Projector, *events: dict) -> None:
    for ev in events:
        n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (n, ev["timestamp"], ev["event"], json.dumps(ev)),
        )
        proj.apply(ev, int(cur.lastrowid))


def test_spansh_conversion_units() -> None:
    system = spansh_system()
    bodies = {b.facts.body_id: b for b in system.bodies}
    planet = bodies[19]
    f = planet.facts
    assert f.name == "CD-23 5548 AB 1 i" and f.kind == "planet" and f.source == "spansh"
    assert f.planet_class == "Rocky ice body"
    assert f.atmosphere == "thin argon atmosphere"
    assert f.volcanism == ""
    assert f.landable is True
    assert f.gravity_g == pytest.approx(0.239, abs=0.001)
    assert f.radius_m == pytest.approx(2_921_230.5)
    assert f.semi_major_axis_m == pytest.approx(0.135486636764023 * enrich.AU_M)
    assert f.parents == [("Star", 4), ("Null", 0)]
    assert f.composition["Ice"] == pytest.approx(0.474729)
    assert planet.signals == {"mining": 20, "bio": 3}  # Planetary Mining Location
    assert set(planet.genuses) == {
        "$Codex_Ent_Fungoids_Genus_Name;",
        "$Codex_Ent_Bacterial_Genus_Name;",
        "$Codex_Ent_Osseus_Genus_Name;",
    }
    star = bodies[4].facts
    assert star.kind == "star" and star.star_type == "Y" and star.star_subclass == 5


def test_predictions_work_from_community_data(conn: sqlite3.Connection) -> None:
    enrich.store(conn, spansh_system())
    conn.execute("INSERT INTO systems(address, name) VALUES(?, ?)", (SA, SYSTEM))
    system = load_system(conn, SA)
    assert system is not None
    body = system.bodies[19]
    genuses = {
        "$Codex_Ent_Fungoids_Genus_Name;",
        "$Codex_Ent_Bacterial_Genus_Name;",
        "$Codex_Ent_Osseus_Genus_Name;",
    }
    predicted = {p.species.genus_name for p in exobio.predict(body, system, genuses)}
    assert predicted == {"Bacterium", "Fungoida", "Osseus"}


def test_journal_wins_and_community_fills_gaps(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-16T20:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
        {
            "timestamp": "2026-10-16T20:48:54Z",
            "event": "FSDJump",
            "StarSystem": SYSTEM,
            "SystemAddress": SA,
            "StarPos": [1.0, 2.0, 3.0],
            "JumpDist": 10.0,
        },
        {
            "timestamp": "2026-10-16T20:48:59Z",
            "event": "Scan",
            "ScanType": "AutoScan",
            "BodyName": "CD-23 5548 A",
            "BodyID": 1,
            "Parents": [{"Null": 0}],
            "StarSystem": SYSTEM,
            "SystemAddress": SA,
            "DistanceFromArrivalLS": 0.0,
            "StarType": "M",
            "Subclass": 0,
            "StellarMass": 0.6,
            "Radius": 5.0e8,
            "SurfaceTemperature": 4352.0,
            "Luminosity": "V",
            "WasDiscovered": True,
            "WasMapped": False,
        },
    )
    enrich.store(conn, spansh_system())
    view = views.system_view(conn, "F1")
    by_id = {b.body_id: b for b in view.bodies}
    assert by_id[1].source == "journal"  # scanned by you: journal version only
    assert by_id[19].source == "spansh" and by_id[19].signals.bio == 3
    assert by_id[19].species and by_id[19].bio_value_max > 0
    assert by_id[19].signals_source == "spansh" and by_id[19].genuses_source == "spansh"
    assert by_id[19].source_url == f"https://spansh.co.uk/body/{SA | (19 << 55)}"
    assert by_id[19].source_at == "2026-10-11T01:45:49Z"
    assert by_id[1].source_at == "2026-10-16T20:48:59Z" and by_id[1].source_url is None
    assert by_id[1].signals_source is None
    assert view.scanned_count == 1
    assert view.body_count == 31  # not honked: community body count
    # community bodies are not yours to sell
    assert views.session_view(conn, "F1").unsold_carto_bodies == 1


def test_a_system_the_game_knew_in_advance(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-27T19:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
        {
            "timestamp": "2026-10-27T19:08:35Z",
            "event": "FSDJump",
            "StarSystem": SYSTEM,
            "SystemAddress": SA,
            "StarPos": [1.0, 2.0, 3.0],
            "JumpDist": 10.0,
        },
        # A populated system: every body is known at once, and no Scan comes, not even the star's.
        {
            "timestamp": "2026-10-27T19:09:07Z",
            "event": "FSSDiscoveryScan",
            "Progress": 1.0,
            "BodyCount": 31,
            "NonBodyCount": 34,
            "SystemName": SYSTEM,
            "SystemAddress": SA,
        },
    )
    enrich.store(conn, spansh_system())
    view = views.system_view(conn, "F1")
    assert view.known_in_advance and view.scanned_count == 0 and view.body_count == 31
    assert view.totals.fss == 0  # nothing scanned: no FSS data to sell
    planets = [b for b in view.bodies if b.kind == "planet"]
    assert view.totals.dss == sum(b.dss_value for b in planets) > 0

    # One body scanned after all (an explored system honked again): it is yours to sell.
    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-27T19:10:00Z",
            "event": "Scan",
            "ScanType": "AutoScan",
            "BodyName": "CD-23 5548 A",
            "BodyID": 1,
            "Parents": [{"Null": 0}],
            "StarSystem": SYSTEM,
            "SystemAddress": SA,
            "DistanceFromArrivalLS": 0.0,
            "StarType": "M",
            "Subclass": 0,
            "StellarMass": 0.6,
            "Radius": 5.0e8,
            "SurfaceTemperature": 4352.0,
            "Luminosity": "V",
            "WasDiscovered": True,
            "WasMapped": False,
        },
    )
    view = views.system_view(conn, "F1")
    assert not view.known_in_advance and view.totals.fss > 0


def test_fetch_cache_freshness(conn: sqlite3.Connection) -> None:
    assert enrich.needs_fetch(conn, SA)
    enrich.store(conn, spansh_system())
    assert not enrich.needs_fetch(conn, SA)
    later = datetime.now(UTC) + timedelta(hours=25)
    assert enrich.needs_fetch(conn, SA, now=later)

    enrich.store(conn, enrich.ExternalSystem(address=SA, source=None))  # failed lookup
    assert conn.execute("SELECT COUNT(*) FROM ext_bodies").fetchone()[0] > 0  # data kept
    assert enrich.needs_fetch(conn, SA, now=datetime.now(UTC) + timedelta(hours=2))


def test_fetch_keeps_the_name_and_position(monkeypatch: pytest.MonkeyPatch) -> None:
    dump = json.loads(FIXTURE.read_text(encoding="utf-8"))
    answers: dict[str, object] = {}

    def get(url: str) -> object:
        answer = answers["spansh" if "spansh" in url else "edsm"]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(enrich, "_get_json", get)
    answers["spansh"] = dump
    found = enrich.fetch_system(SA)
    assert found.source == "spansh" and found.name == SYSTEM
    assert found.star_pos == (99.90625, -5.625, -60.375)

    # Spansh knows the system but no bodies: EDSM's bodies, Spansh's position.
    answers["spansh"] = {"system": {"name": SYSTEM, "coords": {"x": 1, "y": 2, "z": 3}}}
    answers["edsm"] = {"name": SYSTEM, "bodyCount": 1, "bodies": dump["system"]["bodies"][:1]}
    found = enrich.fetch_system(SA)
    assert found.source == "edsm" and found.name == SYSTEM and found.star_pos == (1.0, 2.0, 3.0)

    # Unknown to Spansh (404), EDSM names it without bodies: no data, but a name.
    answers["spansh"] = enrich.urllib.error.URLError("404")
    answers["edsm"] = {"name": "Nowhere", "bodies": []}
    found = enrich.fetch_system(SA)
    assert found.source is None and found.name == "Nowhere" and found.star_pos is None


def test_system_never_visited(conn: sqlite3.Connection) -> None:
    pending = views.system_view(conn, None, SA)
    assert pending.address == str(SA) and pending.name is None and pending.lookup == "pending"
    assert pending.bodies == [] and not pending.is_current

    found = spansh_system()
    found.name, found.star_pos = SYSTEM, (99.90625, -5.625, -60.375)
    enrich.store(conn, found)
    view = views.system_view(conn, None, SA)
    assert view.name == SYSTEM and view.lookup is None and view.visits == 0
    assert view.star_pos == (99.90625, -5.625, -60.375) and not view.is_current
    assert view.bodies and all(b.source == "spansh" for b in view.bodies)
    assert view.scanned_count == 0 and view.body_count == found.body_count
    assert view.totals.fss > 0 and view.barycentres

    # A failed refresh keeps the bodies and the name.
    enrich.store(conn, enrich.ExternalSystem(address=SA, source=None))
    again = views.system_view(conn, None, SA)
    assert again.name == SYSTEM and again.bodies and again.lookup is None

    # Named but without bodies anywhere.
    enrich.store(conn, enrich.ExternalSystem(address=42, source=None, name="Nowhere"))
    empty = views.system_view(conn, None, 42)
    assert empty.name == "Nowhere" and empty.bodies == [] and empty.lookup == "missing"
    # Offline, nothing cached: never asked.
    assert views.system_view(conn, None, 43, online=False).lookup == "offline"

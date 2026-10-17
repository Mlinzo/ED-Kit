from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, enrich, history, views
from app.config import Settings
from app.main import create_app
from app.projector import Projector
from app.service import EventBus, IngestService

CMDR = {"timestamp": "2026-10-16T17:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}
A, B, C = 1001, 2002, 3003
NAMES = {A: "Alpha", B: "Beta", C: "Gamma"}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


@pytest.fixture
def proj(conn: sqlite3.Connection) -> Projector:
    return Projector(conn)


def feed(conn: sqlite3.Connection, proj: Projector, *events: dict) -> None:
    for ev in events:
        n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] + 1
        cur = conn.execute(
            "INSERT INTO events(file_id, line_no, ts, event, raw) VALUES(0, ?, ?, ?, ?)",
            (n, ev["timestamp"], ev["event"], json.dumps(ev)),
        )
        proj.apply(ev, int(cur.lastrowid))


def arrive(address: int, ts: str, event: str = "FSDJump") -> dict:
    return {
        "timestamp": ts,
        "event": event,
        "StarSystem": NAMES[address],
        "SystemAddress": address,
        "StarPos": [float(address), 0.0, 0.0],
        "JumpDist": 10.0,
    }


def scan(address: int, body_id: int, ts: str, **extra: object) -> dict:
    ev = {
        "timestamp": ts,
        "event": "Scan",
        "ScanType": "Detailed",
        "BodyName": f"{NAMES[address]} {body_id}",
        "BodyID": body_id,
        "StarSystem": NAMES[address],
        "SystemAddress": address,
        "WasDiscovered": True,
        "WasMapped": False,
    }
    ev.update(extra)
    return ev


def star(address: int, body_id: int, ts: str, star_type: str, distance: float) -> dict:
    return scan(
        address,
        body_id,
        ts,
        StarType=star_type,
        Subclass=5,
        Luminosity="Va",
        StellarMass=0.5,
        DistanceFromArrivalLS=distance,
    )


def planet(address: int, body_id: int, ts: str, planet_class: str, **extra: object) -> dict:
    fields: dict[str, object] = {
        "PlanetClass": planet_class,
        "TerraformState": "",
        "Atmosphere": "",
        "MassEM": 0.5,
        "Radius": 4.0e6,
        "SurfaceGravity": 5.0,
        "SurfaceTemperature": 200.0,
        "Landable": False,
        "DistanceFromArrivalLS": 500.0,
    }
    return scan(address, body_id, ts, **{**fields, **extra})


def test_visits_skip_reloads_in_the_same_system(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(A, "2026-10-16T17:00:05Z", "Location"),
        arrive(A, "2026-10-16T17:30:00Z", "Location"),  # game reloaded where you were
        arrive(B, "2026-10-16T17:40:00Z"),
        arrive(C, "2026-10-16T17:50:00Z", "CarrierJump"),
        arrive(A, "2026-10-16T18:00:00Z"),
    )
    rows = conn.execute("SELECT system_address FROM visits ORDER BY id").fetchall()
    assert [r[0] for r in rows] == [A, B, C, A]


def test_history_view(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(A, "2026-10-16T17:00:05Z", "Location"),
        star(A, 0, "2026-10-16T17:00:06Z", "K", 0.0),
        arrive(B, "2026-10-16T17:40:00Z"),
        star(B, 1, "2026-10-16T17:40:05Z", "N", 0.0),
        star(B, 2, "2026-10-16T17:41:00Z", "M", 9000.0),
        planet(B, 5, "2026-10-16T17:42:00Z", "Earthlike body", WasDiscovered=False),
        planet(B, 6, "2026-10-16T17:42:10Z", "Rocky body", TerraformState="Terraformable"),
        {
            "timestamp": "2026-10-16T17:43:00Z",
            "event": "FSSBodySignals",
            "SystemAddress": B,
            "BodyID": 6,
            "Signals": [{"Type": "$SAA_SignalType_Biological;", "Count": 2}],
        },
        {
            "timestamp": "2026-10-16T17:50:00Z",
            "event": "SAAScanComplete",
            "SystemAddress": B,
            "BodyID": 5,
            "ProbesUsed": 4,
            "EfficiencyTarget": 6,
        },
        arrive(A, "2026-10-16T18:00:00Z"),
    )
    view = history.history_view(conn, "F1")
    assert view.current_address == str(A)
    assert [s.name for s in view.systems] == ["Alpha", "Beta"]  # last visit first

    alpha, beta = view.systems
    assert alpha.visits == 2 and alpha.first_visit_at == "2026-10-16T17:00:05Z"
    assert alpha.last_visit_at == "2026-10-16T18:00:00Z"
    assert alpha.bodies_scanned == 1 and alpha.notable == []
    assert alpha.main_star is not None and alpha.main_star.star_type == "K"

    assert beta.visits == 1 and beta.bodies_scanned == 4 and beta.bodies_mapped == 1
    assert beta.main_star is not None and beta.main_star.star_type == "N"  # the one at 0 Ls
    assert beta.first_discoveries == 1 and beta.first_mapped == 1
    assert beta.bio_signals == 2
    assert beta.notable == ["elw", "neutron", "terraformable"]
    assert beta.value > 1_000_000  # a mapped, first-discovered Earth-like
    assert beta.unsold_value == beta.value


def test_lost_data_is_worth_nothing(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(B, "2026-10-16T17:40:00Z"),
        planet(B, 5, "2026-10-16T17:42:00Z", "Water world"),
        {"timestamp": "2026-10-16T17:45:00Z", "event": "Died"},
    )
    (beta,) = history.history_view(conn, "F1").systems
    assert beta.bodies_scanned == 1 and beta.value == 0 and beta.unsold_value == 0
    assert beta.lost_value > 0


def test_system_view_of_a_visited_system(conn: sqlite3.Connection, proj: Projector) -> None:
    feed(
        conn,
        proj,
        CMDR,
        arrive(A, "2026-10-16T17:00:05Z", "Location"),
        arrive(B, "2026-10-16T17:40:00Z"),
        planet(B, 5, "2026-10-16T17:42:00Z", "Water world"),
        arrive(C, "2026-10-16T17:50:00Z"),
        {
            "timestamp": "2026-10-16T17:55:00Z",
            "event": "ApproachBody",
            "SystemAddress": C,
            "BodyID": 3,
            "Body": "Gamma 3",
        },
    )
    live = views.system_view(conn, "F1")
    assert live.name == "Gamma" and live.is_current and live.current_body_id == 3
    assert live.prev_system is not None and live.prev_system.name == "Beta"
    assert live.next_system is None

    past = views.system_view(conn, "F1", B)
    assert past.name == "Beta" and not past.is_current
    assert past.current_body_id is None  # you are not near any body there
    assert past.current_system is not None and past.current_system.name == "Gamma"
    assert past.visits == 1 and past.last_visit_at == "2026-10-16T17:40:00Z"
    assert [b.short_name for b in past.bodies] == ["5"]
    assert past.prev_system is not None and past.prev_system.address == str(A)
    assert past.next_system is not None and past.next_system.address == str(C)

    first = views.system_view(conn, "F1", A)
    assert first.prev_system is None and first.next_system is not None

    unknown = views.system_view(conn, "F1", 999)
    assert unknown.address is None and unknown.current_system is not None


def test_opened_past_system_gets_community_data(
    tmp_path: Path, conn: sqlite3.Connection, proj: Projector
) -> None:
    feed(conn, proj, CMDR, arrive(A, "2026-10-16T17:00:05Z", "Location"))
    settings = Settings(journal_dir=tmp_path, data_dir=tmp_path, static_dir=None, online=False)
    service = IngestService(settings, EventBus())

    class FakeEnricher:
        def __init__(self) -> None:
            self.requested: list[int] = []

        def request(self, address: int) -> None:
            self.requested.append(address)

        def drain(self) -> list[enrich.ExternalSystem]:
            return []

    fake = FakeEnricher()
    service.want_community_data(B)  # offline: ignored
    service.enricher = fake  # type: ignore[assignment]
    service.projector = proj
    service.ingest.backfill_done = True
    service.want_community_data(B)
    service._enrich(conn)
    assert fake.requested == [B, A]  # the opened system, then the current one

    enrich.store(conn, enrich.ExternalSystem(address=B, source="spansh"))
    service.want_community_data(B)  # fresh cache: no new lookup
    service._enrich(conn)
    assert fake.requested == [B, A]


def test_history_endpoints(tmp_path: Path) -> None:
    journals = tmp_path / "journals"
    journals.mkdir()
    lines = [
        {"timestamp": "2026-10-16T17:00:00Z", "event": "Fileheader", "part": 1},
        CMDR,
        arrive(A, "2026-10-16T17:00:05Z", "Location"),
        arrive(B, "2026-10-16T17:40:00Z"),
    ]
    (journals / "Journal.2026-10-16T170000.01.log").write_text(
        "\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8"
    )
    settings = Settings(
        journal_dir=journals, data_dir=tmp_path / "data", static_dir=None, online=False
    )
    with TestClient(create_app(settings)) as client:
        for _ in range(50):  # backfill runs on the ingest thread
            entries = client.get("/api/view/history").json()["systems"]
            if len(entries) == 2:
                break
            time.sleep(0.05)
        assert [e["name"] for e in entries] == ["Beta", "Alpha"]
        past = client.get("/api/view/system", params={"address": str(A)}).json()
        assert past["name"] == "Alpha" and past["isCurrent"] is False
        assert past["currentSystem"] == {"address": str(B), "name": "Beta"}
        assert client.get("/api/view/system").json()["name"] == "Beta"

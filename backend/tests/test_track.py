from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import db, track
from app.schemas import LiveStatus

BODY = "Col 285 Sector TT-H c10-4 A 24"
RADIUS = 2_000_000.0
M = 180 / (3.141592653589793 * RADIUS)  # degrees of latitude per metre


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "test.db")
    db.init_schema(c)
    return c


def at(north_m: float, body: str = BODY, **flags: object) -> LiveStatus:
    return LiveStatus(
        has_lat_long=True,
        lat=north_m * M,
        lon=0.0,
        body_name=body,
        planet_radius_m=RADIUS,
        **{"on_foot": True, **flags},  # type: ignore[arg-type]
    )


def test_points_every_few_metres_in_stretches(conn: sqlite3.Connection) -> None:
    rec = track.Recorder()
    assert rec.add(conn, "F1", at(0)) == "new"
    assert rec.add(conn, "F1", at(3)) is None  # on foot: a point every 5 m
    assert rec.add(conn, "F1", at(6)) == "more"
    assert rec.add(conn, "F1", at(16, on_foot=False, in_srv=True)) is None  # SRV: every 20 m
    assert rec.add(conn, "F1", at(30, on_foot=False, in_srv=True)) == "more"
    # Up and away in the ship: no path; back down, a new stretch.
    high = at(500, on_foot=False, in_ship=True, altitude=12_000.0)
    assert rec.add(conn, "F1", high) is None
    assert rec.add(conn, "F1", at(900, on_foot=False, in_ship=True, altitude=800.0)) == "new"
    assert rec.add(conn, "F1", at(960, on_foot=False, in_ship=True, altitude=300.0)) == "more"
    # Another body, another commander: stretches of their own.
    assert rec.add(conn, "F1", at(0, body="Elsewhere 1")) == "new"
    assert rec.add(conn, "F2", at(0, body="Elsewhere 1")) == "new"

    stretches = track.stretches(conn, "F1", BODY)
    assert [[round(lat / M) for lat, _ in s] for s in stretches] == [[0, 6, 30], [900, 960]]
    assert track.stretches(conn, "F2", BODY) == []


def test_a_new_app_run_starts_a_new_stretch(conn: sqlite3.Connection) -> None:
    track.Recorder().add(conn, "F1", at(0))
    track.Recorder().add(conn, "F1", at(1))  # the app started again: not joined to the old one
    assert len(track.stretches(conn, "F1", BODY)) == 2


def test_distance() -> None:
    assert track.distance_m(0, 0, 1000 * M, 0, RADIUS) == pytest.approx(1000, rel=1e-9)

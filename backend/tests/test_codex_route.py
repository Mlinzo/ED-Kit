from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import db, routebio, routeplan, routes
from app.codex import codex_index
from app.projector import Projector
from app.routebio import CodexChance
from app.routeplan import PlanBody, PlanRequest, PlanStop
from app.schemas import RouteRequest
from tests.test_routes import START, FakeSearch, Planner, bio_body, body, feed, no_mapped

INNER = "$Codex_RegionName_18;"  # around Sol
OTHER = "$Codex_RegionName_7;"
CMDR = {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    c.execute("PRAGMA foreign_keys=OFF")
    return c


def stop(address: int, distance: float, region: str, *entries: tuple[str, float]) -> PlanStop:
    s = PlanStop(address, f"Sys {address}", 0.0, 0.0, 0.0, distance, region=region)
    s.bodies[1] = PlanBody(
        body_id=1,
        name=f"Sys {address} 1",
        kind="bio",
        distance_ls=10.0,
        scan_value=0,
        mapping_value=0,
        bio_signals=1,
        codex=tuple(
            CodexChance(key, "$Codex_Ent_Bacterial_01_Name;", None, w) for key, w in entries
        ),
    )
    return s


def collector() -> routeplan._Collector:
    req = PlanRequest(mode="riches", source="Start", goal="codex")
    return routeplan._Collector(req, FakeSearch([]), no_mapped, 1000.0)


def test_entries_of_a_body() -> None:
    est = routebio.estimate(bio_body(5, 7, (0, 0, 0), ("Bacterial", "Shrubs"), signals=2))
    assert est is not None and est.entries
    # Two genera confirmed by DSS: one entry each, shared among their candidate species/colours.
    assert sum(e.weight for e in est.entries) == pytest.approx(2.0)
    # The parent star is a Y brown dwarf: star-coloured species carry its colour code.
    star_coloured = [e for e in est.entries if e.colour and e.key.endswith("_Y_Name;")]
    assert star_coloured
    guess = routebio.estimate(bio_body(5, 8, (0, 0, 0), (), signals=2))
    assert guess is not None
    # Genera only predicted: at half weight, for the two signals.
    assert sum(e.weight for e in guess.entries) == pytest.approx(1.0)


def test_deduced_genus_counts_fully() -> None:
    # Thin neon at 40 K: only a Bacterium can grow there, so one signal is surely it.
    raw = {
        **bio_body(5, 9, (0, 0, 0), (), signals=1),
        "subtype": "Icy body",
        "atmosphere": "Thin Neon",
        "atmosphere_composition": [{"name": "Neon", "share": 100.0}],
        "surface_temperature": 40.0,
        "gravity": 0.3,
        "surface_pressure": 0.002,
    }
    est = routebio.estimate(raw)
    assert est is not None and est.genuses == ()  # nobody mapped it
    assert {e.species.split("_")[2] for e in est.entries} == {"Bacterial"}
    assert sum(e.weight for e in est.entries) == pytest.approx(1.0)
    # Two signals and one genus possible: the rules miss one, nothing is sure.
    est = routebio.estimate({**raw, "signals": [{"count": 2, "name": "Biological"}]})
    assert est is not None
    assert sum(e.weight for e in est.entries) == pytest.approx(routebio.UNCONFIRMED_GENUS)


def test_each_entry_counts_once() -> None:
    c = collector()
    a = stop(1, 10, INNER, ("X", 1.0))
    b = stop(2, 20, INNER, ("X", 1.0))  # the same entry, already covered by a
    d = stop(3, 30, INNER, ("Y", 0.6))
    e = stop(4, 40, OTHER, ("X", 1.0))  # the same species in another region: new again
    assert c.cover([a, b, d, e], 10) == [a, d, e]
    assert c.cover([a, b, d, e], 2) == [a, d]
    # Uncertain entries still leave something for a second stop.
    half = stop(5, 50, INNER, ("Z", 0.5), ("W", 0.5))
    assert c.codex_value(half, {("Z", INNER): 0.5}) == pytest.approx(0.75)
    # The same entry on two bodies of one stop: once, if surely there; else on either.
    twice = stop(7, 70, OTHER, ("V", 1.0))
    twice.bodies[2] = PlanBody(
        2, "Sys 7 2", "bio", 20.0, 0, 0, bio_signals=1, codex=twice.bodies[1].codex
    )
    assert c.codex_value(twice, {}) == pytest.approx(1.0)
    maybe = stop(8, 80, OTHER, ("U", 0.5))
    maybe.bodies[2] = PlanBody(
        2, "Sys 8 2", "bio", 20.0, 0, 0, bio_signals=1, codex=maybe.bodies[1].codex
    )
    assert c.codex_value(maybe, {}) == pytest.approx(0.75)
    # Along a line: the stops adding the most first.
    both = stop(6, 60, INNER, ("X", 1.0), ("Y", 1.0))
    assert c.best([a, d, both], 5) == [both]


def test_codex_route_searches_biology_and_skips_what_you_logged(conn: sqlite3.Connection) -> None:
    bodies = [
        bio_body(1, 3, (10, 0, 0), ("Bacterial", "Shrubs")),
        bio_body(2, 3, (20, 0, 0), ("Bacterial", "Shrubs")),
        body(4, 1, (5, 0, 0)),  # an ELW: no biology, not even searched for
    ]
    req = PlanRequest(mode="riches", source="Start", goal="codex", body_types=("elw",))
    search = FakeSearch(bodies)
    plan = routeplan.plan(req, search, no_mapped, START, {})
    assert {k for k, _ in search.body_calls} == {"bio"}
    assert plan.stops and plan.stops[0].address == 1 and plan.stops[0].region == INNER
    assert all(b.codex for s in plan.stops for b in s.bodies.values())
    # Every entry of the first body logged here: nothing new left on either body.
    every = {
        e.key: [(INNER, "2026-10-17T09:00:00Z")]
        for b in plan.stops[0].bodies.values()
        for e in b.codex
    }
    assert routeplan.plan(req, FakeSearch(bodies), no_mapped, START, every).stops == []


def test_codex_route_view(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(conn, proj, CMDR)
    a = stop(1, 10, INNER, ("$Codex_Ent_Bacterial_01_F_Name;", 1.0))
    b = stop(
        2,
        20,
        INNER,
        ("$Codex_Ent_Bacterial_01_F_Name;", 0.5),
        ("$Codex_Ent_Shrubs_01_F_Name;", 0.5),
    )
    plan = routeplan.Plan(source=START, destination=None, stops=[a, b], truncated=False)
    routes.store(conn, RouteRequest(mode="riches", goal="codex"), plan, None)
    view = routes.route_view(conn, "F1", Planner())
    first, second = view.stops
    assert first.codex_new == 1.0 and first.bodies[0].codex[0].chance == 1.0
    assert first.bodies[0].codex[0].species == "Bacterium Aurasus"
    assert second.codex_new == 0.5  # Aurasus is covered by the first stop
    assert view.codex_left == 1.5
    # Logged in the game since: gone from the route.
    conn.execute(
        "INSERT INTO codex_entries(fid, ts, entry_id, name, species, category, region) "
        "VALUES('F1', '2026-10-17T11:00:00Z', 1, ?, ?, 'bio', ?)",
        ("$Codex_Ent_Bacterial_01_F_Name;", "$Codex_Ent_Bacterial_01_Name;", INNER),
    )
    assert "$Codex_Ent_Bacterial_01_F_Name;" in codex_index(conn, "F1")
    view = routes.route_view(conn, "F1", Planner())
    assert [s.codex_new for s in view.stops] == [0.0, 0.5] and view.codex_left == 0.5

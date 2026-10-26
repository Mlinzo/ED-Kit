from __future__ import annotations

import json
import math
import random
import sqlite3
import time
from pathlib import Path
from typing import Any

import pytest

from app import db, routebio, routeplan, routes, spansh
from app.projector import Projector
from app.routeplan import PlanError, PlanRequest, Point
from app.schemas import RoutePoint, RouteRequest

START = Point("Start", 0.0, 0.0, 0.0)


def body(
    system: int,
    body_id: int,
    xyz: tuple[float, float, float],
    subtype: str = "Earth-like world",
    state: str = "Not terraformable",
    value: int = 1_000_000,
    name: str | None = None,
) -> dict[str, Any]:
    sys_name = name or f"Sys {system}"
    return {
        "id64": system | (body_id << 55),
        "name": f"{sys_name} {body_id}",
        "subtype": subtype,
        "terraforming_state": state,
        "distance_to_arrival": 100.0 * body_id,
        "estimated_scan_value": value // 4,
        "estimated_mapping_value": value,
        "system_id64": system,
        "system_name": sys_name,
        "system_x": xyz[0],
        "system_y": xyz[1],
        "system_z": xyz[2],
    }


class FakeSearch:
    """Spansh in memory: applies the filters the planner sends, sorts and pages like Spansh."""

    def __init__(
        self,
        bodies: list[dict[str, Any]],
        systems: dict[int, dict[str, Any]] | None = None,
        named: dict[str, tuple[float, float, float]] | None = None,
        permits: set[int] | None = None,
    ) -> None:
        self.all = bodies
        self.info = systems or {}
        self.named = {"Start": (0.0, 0.0, 0.0), **(named or {})}
        self.permits = permits or set()
        self.body_calls: list[tuple[str, int]] = []
        self.system_calls = 0

    def _ref(self, reference: dict[str, Any]):
        if "reference_coords" in reference:
            c = reference["reference_coords"]
            p = (c["x"], c["y"], c["z"])
            return (lambda q: math.dist(p, q)), None
        if "reference_system" in reference:
            name = reference["reference_system"]
            if name not in self.named:
                raise spansh.SpanshRejected("unknown")
            p = self.named[name]
            ref = {"name": name, "x": p[0], "y": p[1], "z": p[2]}
            return (lambda q: math.dist(p, q)), ref
        route = reference["reference_route"]
        if route["source"] not in self.named or route["destination"] not in self.named:
            raise spansh.SpanshRejected("unknown")
        a, b = self.named[route["source"]], self.named[route["destination"]]

        def to_segment(q):
            ab = [y - x for x, y in zip(a, b, strict=True)]
            t = sum((qi - ai) * c for qi, ai, c in zip(q, a, ab, strict=True)) / sum(
                c * c for c in ab
            )
            t = max(0.0, min(1.0, t))
            return math.dist(q, [ai + t * c for ai, c in zip(a, ab, strict=True)])

        refs = [
            {"name": n, "x": p[0], "y": p[1], "z": p[2]}
            for n, p in ((route["source"], a), (route["destination"], b))
        ]
        return to_segment, refs

    def bodies(self, filters, reference, page):
        distance, ref = self._ref(reference)
        bio = "signals" in filters
        self.body_calls.append(("bio" if bio else filters["subtype"]["value"][0], page))
        states = (filters.get("terraforming_state") or {}).get("value")
        lo = (filters.get("estimated_mapping_value") or {}).get("value", [0])[0]
        max_d = float(filters["distance"]["max"])
        hits = []
        for b in self.all:
            d = distance((b["system_x"], b["system_y"], b["system_z"]))
            if d > max_d:
                continue
            if bio:
                keep = routebio.bio_signals(b) > 0 and bool(b.get("is_landable"))
            else:
                keep = (
                    b["subtype"] in filters["subtype"]["value"]
                    and (not states or b["terraforming_state"] in states)
                    and b["estimated_mapping_value"] >= lo
                )
            if not keep:
                continue
            hits.append({**b, "distance": d})
        hits.sort(key=lambda b: b["distance"])
        size = routeplan.PAGE_SIZE
        return {
            "count": len(hits),
            "reference": ref,
            "results": hits[page * size : (page + 1) * size],
        }

    def systems(self, ids):
        self.system_calls += 1
        return {i: self.info[i] for i in ids if i in self.info}

    def permit_locked(self):
        return set(self.permits)


def no_mapped(_ids):
    return {}


def test_riches_picks_nearest_valuable_systems_and_skips_permits() -> None:
    bodies = [
        body(1, 1, (10, 0, 0)),
        body(2, 1, (20, 0, 0), "High metal content world", "Terraformable", 600_000),
        body(2, 2, (20, 0, 0), "High metal content world", "Not terraformable", 600_000),  # no
        body(3, 1, (30, 0, 0), "Water world", "Terraformable", 900_000),
        body(4, 1, (40, 0, 0), "Water world", "Not terraformable", 400_000),  # ww not asked
        body(5, 1, (5, 0, 0)),  # permit-locked
        body(6, 1, (15, 0, 0), "High metal content world", "Terraformable", 200_000),  # cheap
        body(7, 1, (500, 0, 0)),  # outside the radius
    ]
    search = FakeSearch(bodies, permits={5})
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start", radius_ly=100), search, no_mapped
    )
    assert [s.address for s in plan.stops] == [1, 2, 3]
    assert [list(s.bodies) for s in plan.stops] == [[1], [1], [1]]
    assert plan.stops[1].bodies[1].kind == "thmc" and plan.stops[2].bodies[1].kind == "tww"
    assert [round(s.hop_ly) for s in plan.stops] == [10, 10, 10]
    assert plan.source.name == "Start" and not plan.truncated
    assert search.system_calls == 0  # populated systems allowed: no per-system checks


def test_riches_only_unpopulated_pages_until_enough(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routeplan, "PAGE_SIZE", 2)
    bodies = [body(i, 1, (i, 0, 0)) for i in range(1, 11)]
    info = {i: {"population": 1000 if i <= 6 else 0} for i in range(1, 11)}
    search = FakeSearch(bodies, info)
    req = PlanRequest(mode="riches", source="Start", max_systems=3, include_populated=False)
    plan = routeplan.plan(req, search, no_mapped)
    assert sorted(s.address for s in plan.stops) == [7, 8, 9]
    assert plan.truncated  # system 10 qualifies too
    assert search.system_calls >= 1


def test_riches_skips_systems_you_mapped() -> None:
    bodies = [
        body(1, 1, (10, 0, 0)),
        body(1, 2, (10, 0, 0)),
        body(2, 1, (20, 0, 0)),
        body(3, 1, (30, 0, 0)),
    ]
    mapped = {(1, 1), (1, 2), (2, 1)}
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start"),
        FakeSearch(bodies),
        lambda ids: {m: (True, 0) for m in mapped if m[0] in set(ids)},
    )
    assert [s.address for s in plan.stops] == [3]
    keep = routeplan.plan(
        PlanRequest(mode="riches", source="Start", skip_mapped=False),
        FakeSearch(bodies),
        lambda ids: dict.fromkeys(mapped, (True, 0)),
    )
    assert len(keep.stops) == 3


def test_riches_uses_local_coordinates_and_reports_unknown_systems() -> None:
    search = FakeSearch([body(1, 1, (110, 0, 0))])
    here = Point("Fresh Discovery", 100.0, 0.0, 0.0)  # unknown to Spansh
    plan = routeplan.plan(PlanRequest(mode="riches", source=here.name), search, no_mapped, here)
    assert [s.address for s in plan.stops] == [1] and plan.source == here
    with pytest.raises(PlanError) as err:
        routeplan.plan(PlanRequest(mode="riches", source="Nowhere"), search, no_mapped)
    assert err.value.code == "unknown_system"


def test_line_orders_stops_along_the_corridor() -> None:
    bodies = [
        body(1, 1, (80, 5, 0)),
        body(2, 1, (20, -10, 0)),
        body(3, 1, (50, 40, 0)),  # too far from the line
        body(4, 1, (50, 0, 3)),
    ]
    search = FakeSearch(bodies, named={"End": (100.0, 0.0, 0.0)})
    req = PlanRequest(mode="line", source="Start", destination="End", deviation_ly=15)
    plan = routeplan.plan(req, search, no_mapped)
    assert [s.address for s in plan.stops] == [2, 4, 1]
    assert plan.destination is not None and plan.destination.name == "End"
    with pytest.raises(PlanError) as err:
        routeplan.plan(PlanRequest(mode="line", source="Start"), search, no_mapped)
    assert err.value.code == "no_destination"


def test_two_opt_untangles_a_crossed_path() -> None:
    rng = random.Random(7)
    pts = [(0.0, 0.0, 0.0)] + [(rng.uniform(0, 100), rng.uniform(0, 100), 0.0) for _ in range(300)]
    naive = list(range(len(pts)))  # visiting order = generation order: lots of crossings
    before = routeplan.path_length(pts, naive)
    started = time.perf_counter()
    better = routeplan.two_opt(pts, list(naive), budget_s=2.0)
    assert time.perf_counter() - started < 2.5
    assert better[0] == 0 and sorted(better) == naive
    assert routeplan.path_length(pts, better) < before * 0.5


def test_nearest_neighbour_route_is_fast_and_short() -> None:
    rng = random.Random(3)
    bodies = [
        body(i, 1, (rng.uniform(-200, 200), rng.uniform(-50, 50), rng.uniform(-200, 200)))
        for i in range(1, 701)
    ]
    started = time.perf_counter()
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start", radius_ly=1000, max_systems=700),
        FakeSearch(bodies),
        no_mapped,
    )
    assert time.perf_counter() - started < 3.0
    assert len(plan.stops) == 700
    total = sum(s.hop_ly for s in plan.stops)
    pts = [(0.0, 0.0, 0.0)] + [(b["system_x"], b["system_y"], b["system_z"]) for b in bodies]
    assert total < routeplan.path_length(pts, list(range(len(pts)))) * 0.15  # vs random order
    # 2-opt improves on the plain nearest-neighbour path.
    left, path = set(range(1, len(pts))), [0]
    while left:
        nxt = min(left, key=lambda i: math.dist(pts[path[-1]], pts[i]))
        left.remove(nxt)
        path.append(nxt)
    assert total < routeplan.path_length(pts, path)


# --------------------------------------------------------------------------- storage and view


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


class Planner:
    online = True
    building = False
    error = None


def test_route_view_tracks_progress_from_the_journal(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
        {"timestamp": "2026-10-17T10:00:01Z", "event": "Loadout", "MaxJumpRange": 30.0},
        {
            "timestamp": "2026-10-17T10:00:02Z",
            "event": "Location",
            "StarSystem": "Start",
            "SystemAddress": 999,
            "StarPos": [0.0, 0.0, 0.0],
        },
    )
    bodies = [
        body(1, 1, (10, 0, 0), name="Alpha"),
        body(1, 2, (10, 0, 0), name="Alpha"),
        body(2, 1, (50, 0, 0), name="Beta"),
    ]
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start"), FakeSearch(bodies), no_mapped, START
    )
    routes.store(conn, RouteRequest(mode="riches"), plan, None)

    view = routes.route_view(conn, "F1", Planner())
    assert [s.name for s in view.stops] == ["Alpha", "Beta"] and view.next_seq == 1
    assert view.current_system == "Start" and view.jump_range_ly == 30.0
    assert view.current_position == RoutePoint(name="Start", x=0.0, y=0.0, z=0.0)
    assert (view.stops[1].x, view.stops[1].y, view.stops[1].z) == (50.0, 0.0, 0.0)
    assert view.distance_to_next_ly == 10.0 and view.jumps_to_next == 1
    assert view.stops[1].jumps == 2  # 40 ly with a 30 ly jump range
    assert [b.short_name for b in view.stops[0].bodies] == ["1", "2"]
    assert view.total_value == 3_000_000 and view.collected_value == 0

    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-17T10:10:00Z",
            "event": "FSDJump",
            "StarSystem": "Alpha",
            "SystemAddress": 1,
            "StarPos": [10.0, 0.0, 0.0],
            "JumpDist": 10.0,
        },
        *(
            {
                "timestamp": "2026-10-17T10:20:00Z",
                "event": "SAAScanComplete",
                "SystemAddress": 1,
                "BodyID": b,
                "ProbesUsed": 4,
                "EfficiencyTarget": 6,
            }
            for b in (1, 2)
        ),
    )
    view = routes.route_view(conn, "F1", Planner())
    assert view.current_position is not None and view.current_position.x == 10.0
    alpha = view.stops[0]
    assert alpha.visited and alpha.done and alpha.here and all(b.mapped for b in alpha.bodies)
    assert view.next_seq == 2 and view.done_count == 1 and view.collected_value == 2_000_000
    assert view.distance_to_next_ly == 40.0

    assert routes.set_skipped(conn, 2, True)
    view = routes.route_view(conn, "F1", Planner())
    assert view.next_seq is None and view.skipped_count == 1
    routes.clear(conn)
    assert routes.route_view(conn, "F1", Planner()).stops == []


def test_planner_builds_on_a_thread_and_fills_populations(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    c = db.connect(path)
    db.init_schema(c)
    c.close()
    fake = FakeSearch([body(1, 1, (10, 0, 0)), body(2, 1, (20, 0, 0))], {1: {"population": 5000}})

    class Wrapped(FakeSearch):
        oldest = None
        requests = 0

        def close(self) -> None:
            pass

    wrapped = Wrapped(fake.all, fake.info)
    changes: list[int] = []
    planner = routes.RoutePlanner(path, True, lambda: changes.append(1), lambda p, r: wrapped)
    planner.start(RouteRequest(mode="riches", source="Start"))
    for _ in range(100):
        c = db.connect(path)
        populated = c.execute(
            "SELECT COUNT(*) FROM route_stops WHERE population IS NOT NULL"
        ).fetchone()[0]
        c.close()
        if not planner.building and populated:
            break
        time.sleep(0.02)
    conn = db.connect(path)
    view = routes.route_view(conn, None, planner)
    assert not view.building and view.error is None
    assert [s.population for s in view.stops] == [5000, None]
    assert len(changes) >= 3  # started, built, populations

    planner.start(RouteRequest(mode="riches", source="Nowhere"))
    for _ in range(100):
        if not planner.building:
            break
        time.sleep(0.02)
    view = routes.route_view(conn, None, planner)
    assert view.error == "unknown_system" and len(view.stops) == 2  # the old route stays


# --------------------------------------------------------------------------- cache


def test_cached_search_remembers_pages_systems_and_permits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "t.db"
    c = db.connect(path)
    db.init_schema(c)
    c.close()
    calls: list[str] = []

    def fake_post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
        filters = payload["filters"]
        if url == spansh.BODIES_SEARCH:
            calls.append("bodies")
            return {
                "count": 1,
                "reference": None,
                "results": [{**body(1, 1, (1, 2, 3)), "synthesis_recipes": "x"}],
            }
        if "needs_permit" in filters:
            calls.append("permits")
            return {"count": 2, "results": [{"id64": 7}, {"id64": 8}]}
        calls.append("systems")
        return {
            "results": [
                {"id64": int(i), "population": 10, "needs_permit": False}
                for i in filters["id64"]["value"]
            ]
        }

    monkeypatch.setattr(spansh, "_post", fake_post)
    ref = {"reference_system": "Start"}
    first = spansh.CachedSearch(path)
    page = first.bodies({"subtype": {"value": ["Earth-like world"]}}, ref, 0)
    assert "synthesis_recipes" not in page["results"][0]  # trimmed before caching
    assert first.systems([1, 2]) == {
        1: {"population": 10, "needs_permit": False},
        2: {"population": 10, "needs_permit": False},
    }
    assert first.permit_locked() == {7, 8}
    first.close()

    second = spansh.CachedSearch(path)
    assert second.bodies({"subtype": {"value": ["Earth-like world"]}}, ref, 0) == page
    assert second.systems([2, 1]) == {
        1: {"population": 10, "needs_permit": False},
        2: {"population": 10, "needs_permit": False},
    }
    assert second.permit_locked() == {7, 8}
    assert calls == ["bodies", "systems", "permits"] and second.requests == 0
    assert second.oldest is not None
    second.close()

    fresh = spansh.CachedSearch(path, refresh=True)
    fresh.bodies({"subtype": {"value": ["Earth-like world"]}}, ref, 0)
    assert calls[-1] == "bodies"
    fresh.close()


def test_route_endpoints_offline(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    settings = Settings(
        journal_dir=tmp_path / "journals", data_dir=tmp_path / "data", static_dir=None, online=False
    )
    with TestClient(create_app(settings)) as client:
        view = client.get("/api/view/route").json()
        assert view["online"] is False and view["stops"] == [] and view["params"] is None
        assert client.post("/api/route", json={"mode": "riches"}).status_code == 409
        empty = {"mode": "riches", "bodyTypes": []}
        assert client.post("/api/route", json=empty).status_code == 422
        assert client.put("/api/route/stops/1", json={"skipped": True}).status_code == 404
        assert client.delete("/api/route").status_code == 204


def test_system_threshold_waits_for_all_bodies_of_a_system(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routeplan, "PAGE_SIZE", 2)
    thmc = ("High metal content world", "Terraformable", 600_000)
    bodies = [body(i, 1, (i, 0, 0), *thmc) for i in range(1, 6)]  # 600k each: below 1.5M
    # System 10: its ELW comes with the first ELW page, its THMC only on the third THMC page.
    bodies += [body(10, 1, (10, 0, 0)), body(10, 2, (10, 0, 0), *thmc)]
    req = PlanRequest(mode="riches", source="Start", max_systems=1, min_system_value=1_500_000)
    plan = routeplan.plan(req, FakeSearch(bodies), no_mapped)
    assert [s.address for s in plan.stops] == [10]
    assert sorted(plan.stops[0].bodies) == [1, 2]  # complete, not just the ELW


def test_system_threshold_counts_only_bodies_still_to_map() -> None:
    bodies = [body(1, 1, (10, 0, 0)), body(1, 2, (10, 0, 0)), body(2, 1, (20, 0, 0))]
    req = PlanRequest(mode="riches", source="Start", min_system_value=1_500_000)
    mapped = {(1, 1): (True, 0)}
    plan = routeplan.plan(req, FakeSearch(bodies), lambda ids: mapped)
    assert plan.stops == []  # system 1 has 1M left, system 2 has 1M
    both = routeplan.plan(
        PlanRequest(mode="riches", source="Start", min_system_value=1_500_000, skip_mapped=False),
        FakeSearch(bodies),
        lambda ids: mapped,
    )
    assert [s.address for s in both.stops] == [1]


# --------------------------------------------------------------------------- exobiology


def bio_body(
    system: int,
    body_id: int,
    xyz: tuple[float, float, float],
    genuses: tuple[str, ...] = ("Bacterial", "Shrubs"),
    signals: int = 2,
    landable: bool = True,
) -> dict[str, Any]:
    """A Spansh search result for a thin-ammonia rocky body (like Delphi 5 b)."""
    return {
        **body(system, body_id, xyz, "Rocky body", "Not terraformable", 2_000),
        "atmosphere": "Thin Ammonia",
        "atmosphere_composition": [{"name": "Ammonia", "share": 100.0}],
        "gravity": 0.14,
        "surface_temperature": 164.0,
        "surface_pressure": 0.0012,
        "volcanism_type": "No volcanism",
        "is_landable": landable,
        "parents": [
            {"id64": system | (1 << 55), "subtype": "Y (Brown dwarf) Star", "type": "Star"}
        ],
        "signals": [
            {"count": 15, "name": "Planetary Mining Location"},
            {"count": signals, "name": "Biological"},
        ],
        "genuses": [{"name": g} for g in genuses],
        "system_region": "Inner Orion Spur",
    }


def test_spansh_genus_names_map_to_codex_symbols() -> None:
    assert routebio.genus_symbol("Bacterial") == "$Codex_Ent_Bacterial_Genus_Name;"
    assert routebio.genus_symbol("Shrubs") == "$Codex_Ent_Shrubs_Genus_Name;"  # Frutexa
    assert routebio.genus_symbol("Cactoids") == "$Codex_Ent_Cactoid_Genus_Name;"
    assert routebio.genus_symbol("Bark Mounds") == "$Codex_Ent_Cone_Name;"
    assert routebio.genus_symbol("Anemones") == "$Codex_Ent_Sphere_Name;"
    assert routebio.genus_symbol("Tubers") == "$Codex_Ent_Tube_Name;"  # Sinuous Tubers
    assert routebio.genus_symbol("Something new") is None


def test_spansh_body_becomes_journal_like_facts() -> None:
    raw = {
        **bio_body(5, 7, (0, 0, 0)),
        "atmosphere": "Thin Sulphur dioxide",
        "atmosphere_composition": [{"name": "Sulphur dioxide", "share": 100.0}],
        "volcanism_type": None,
    }
    converted = routebio.facts_from_search(raw)
    assert converted is not None
    body, system = converted
    assert body.body_id == 7 and body.planet_class == "Rocky body" and body.landable
    assert body.atmosphere == "thin sulphur dioxide atmosphere"
    assert body.atmosphere_composition == {"SulphurDioxide": 100.0}
    assert body.gravity_g is not None and abs(body.gravity_g - 0.14) < 1e-9
    assert body.pressure_atm is not None and abs(body.pressure_atm - 0.0012) < 1e-9
    assert body.volcanism is None  # not reported, unlike "No volcanism"
    assert body.parents == [("Star", 1)] and system.bodies[1].star_type == "Y"
    assert system.region == "Inner Orion Spur"


def test_bio_estimate_uses_known_genera() -> None:
    known = routebio.estimate(bio_body(5, 7, (0, 0, 0), ("Bacterial", "Shrubs"), signals=2))
    assert known is not None and known.signals == 2 and len(known.genuses) == 2
    assert 0 < known.low <= known.high
    guess = routebio.estimate(bio_body(5, 8, (0, 0, 0), (), signals=2))
    assert guess is not None and guess.genuses == () and guess.high >= known.high
    assert routebio.estimate({**bio_body(5, 9, (0, 0, 0)), "signals": []}) is None


def test_bio_route_prices_bodies_by_their_species() -> None:
    bodies = [
        bio_body(1, 3, (10, 0, 0), ("Bacterial", "Shrubs")),
        bio_body(2, 3, (20, 0, 0), ("Bacterial",), signals=1),
        bio_body(3, 3, (30, 0, 0), landable=False),
        body(4, 1, (5, 0, 0)),  # an ELW: no biology
    ]
    rich = routebio.estimate(bodies[0])
    poor = routebio.estimate(bodies[1])
    assert rich is not None and poor is not None and rich.high > poor.high
    req = PlanRequest(mode="riches", source="Start", body_types=("bio",), bio_min_value=0)
    plan = routeplan.plan(req, FakeSearch(bodies), no_mapped)
    assert [s.address for s in plan.stops] == [1, 2]
    first = plan.stops[0].bodies[3]
    assert first.kind == "bio" and first.bio_signals == 2 and first.bio_max == rich.high
    assert len(first.genuses) == 2

    pricey = PlanRequest(
        mode="riches", source="Start", body_types=("bio",), bio_min_value=poor.high + 1
    )
    assert [s.address for s in routeplan.plan(pricey, FakeSearch(bodies), no_mapped).stops] == [1]
    known = PlanRequest(
        mode="riches",
        source="Start",
        body_types=("bio",),
        bio_min_value=0,
        bio_require_genuses=True,
    )
    unknown = [bio_body(1, 3, (10, 0, 0), ())]
    assert routeplan.plan(known, FakeSearch(unknown), no_mapped).stops == []
    # Every species analysed: the system is done and left out.
    done = routeplan.plan(req, FakeSearch(bodies), lambda ids: {(1, 3): (False, 2)})
    assert [s.address for s in done.stops] == [2]


def test_bio_route_view_counts_analysed_species(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
    )
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start", body_types=("bio",), bio_min_value=0),
        FakeSearch([bio_body(1, 3, (10, 0, 0), ("Bacterial", "Shrubs"))]),
        no_mapped,
        START,
    )
    routes.store(conn, RouteRequest(mode="riches"), plan, None)
    view = routes.route_view(conn, "F1", Planner())
    (stop,) = view.stops
    (b,) = stop.bodies
    assert b.kind == "bio" and b.bio_signals == 2 and b.genuses == ["Bacterium", "Frutexa"]
    assert stop.value == b.bio_max and stop.value_min == b.bio_min and not stop.done

    def analyse(species: str, ts: str) -> dict:
        return {
            "timestamp": ts,
            "event": "ScanOrganic",
            "ScanType": "Analyse",
            "Genus": "$Codex_Ent_Bacterial_Genus_Name;",
            "Species": species,
            "SystemAddress": 1,
            "Body": 3,
        }

    feed(conn, proj, analyse("$Codex_Ent_Bacterial_01_Name;", "2026-10-17T10:10:00Z"))
    view = routes.route_view(conn, "F1", Planner())
    assert view.stops[0].bodies[0].bio_done == 1 and not view.stops[0].done
    assert view.collected_value > 0
    feed(conn, proj, analyse("$Codex_Ent_Shrubs_01_Name;", "2026-10-17T10:20:00Z"))
    view = routes.route_view(conn, "F1", Planner())
    assert view.stops[0].done and view.next_seq is None


def test_mapping_and_biology_count_together() -> None:
    thmc = ("High metal content world", "Terraformable", 600_000)
    # Body 2 of system 1 is a terraformable HMC with biology: it counts for both.
    both = {**bio_body(1, 2, (10, 0, 0), ("Bacterial",), signals=1), "subtype": thmc[0]}
    both.update(terraforming_state=thmc[1], estimated_mapping_value=thmc[2])
    bodies = [
        body(1, 1, (10, 0, 0)),  # ELW, 1M
        both,
        bio_body(2, 3, (20, 0, 0), ("Bacterial", "Shrubs")),  # biology only
        body(3, 1, (30, 0, 0), *thmc),  # 600k of mapping only
    ]
    bio = routebio.estimate(both)
    assert bio is not None
    req = PlanRequest(
        mode="riches", source="Start", body_types=("elw", "thmc", "bio"), bio_min_value=0
    )
    plan = routeplan.plan(req, FakeSearch(bodies), no_mapped)
    assert [s.address for s in plan.stops] == [1, 2, 3]
    merged = plan.stops[0].bodies[2]
    assert merged.kind == "thmc" and merged.mapping_value == 600_000
    assert merged.bio_signals == 1 and merged.bio_max == bio.high
    assert plan.stops[1].bodies[3].kind == "bio"

    # The system threshold is on mapping and biology together: system 1 is worth exactly
    # 1M (ELW) + 600k (THMC) + its biology.
    only_bio = routebio.estimate(bodies[2])
    assert only_bio is not None
    total = 1_600_000 + bio.high

    def stops_at(threshold: int) -> list[int]:
        rich = PlanRequest(
            mode="riches",
            source="Start",
            body_types=("elw", "thmc", "bio"),
            bio_min_value=0,
            min_system_value=threshold,
        )
        return [s.address for s in routeplan.plan(rich, FakeSearch(bodies), no_mapped).stops]

    assert 1 in stops_at(total) and 1 not in stops_at(total + 1)
    assert (2 in stops_at(total)) == (only_bio.high >= total)
    assert 3 not in stops_at(total)  # 600k of mapping only

    # Mapped but its species not analysed: the merged body still has biology to do.
    progress = {(1, 1): (True, 0), (1, 2): (True, 0)}
    left = routeplan.plan(req, FakeSearch(bodies), lambda ids: progress)
    assert 1 in [s.address for s in left.stops]
    finished = {(1, 1): (True, 0), (1, 2): (True, 1)}
    gone = routeplan.plan(req, FakeSearch(bodies), lambda ids: finished)
    assert 1 not in [s.address for s in gone.stops]


def test_remaining_value_drops_what_is_done() -> None:
    b = routeplan.PlanBody(
        1, "x", "thmc", None, 0, 600_000, bio_signals=2, bio_min=4_000_000, bio_max=10_000_000
    )
    assert b.remaining(None) == 10_600_000
    assert b.remaining((True, 0)) == 10_000_000
    assert b.remaining((True, 1)) == 5_000_000
    assert b.remaining((True, 1), low=True) == 2_000_000
    assert b.remaining((True, 2)) == 0 and b.finished((True, 2))
    assert not b.finished((False, 2))


def test_line_keeps_the_most_valuable_systems() -> None:
    thmc = ("High metal content world", "Terraformable")
    bodies = [body(i, 1, (i * 10.0, (-1) ** i * 8.0, 0), *thmc, 500_000 + i) for i in range(1, 9)]
    bodies.append(body(50, 1, (45, 0, 0), "Earth-like world", "Not terraformable", 2_000_000))
    search = FakeSearch(bodies, named={"End": (100.0, 0.0, 0.0)})
    req = PlanRequest(mode="line", source="Start", destination="End", max_systems=3)
    plan = routeplan.plan(req, search, no_mapped)
    assert plan.truncated
    assert sorted(s.address for s in plan.stops) == [7, 8, 50]  # the ELW, then the dearest
    assert [s.address for s in plan.stops] == [50, 7, 8]  # in order along the line


def test_two_opt_can_keep_the_last_node() -> None:
    pts = [(0.0, 0.0, 0.0), (10.0, 5.0, 0.0), (20.0, -5.0, 0.0), (30.0, 5.0, 0.0), (5.0, 0.0, 0.0)]
    free = routeplan.two_opt(pts, [0, 1, 2, 3, 4])
    fixed = routeplan.two_opt(pts, [0, 1, 2, 3, 4], fixed_end=True)
    assert free[-1] != 4  # the near point (5, 0) moves to the front
    assert fixed[0] == 0 and fixed[-1] == 4


def test_route_stops_can_be_moved_and_removed(conn: sqlite3.Connection) -> None:
    bodies = [body(i, 1, (i * 10.0, 0, 0), name=f"S{i}") for i in (1, 2, 3, 4)]
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start"), FakeSearch(bodies), no_mapped, START
    )
    routes.store(conn, RouteRequest(mode="riches"), plan, None)
    assert routes.set_skipped(conn, 2, True)

    assert routes.move_stop(conn, 4, 1)  # S4 first
    view = routes.route_view(conn, None, Planner())
    assert [s.name for s in view.stops] == ["S4", "S1", "S2", "S3"]
    assert [s.seq for s in view.stops] == [1, 2, 3, 4]
    assert [s.hop_ly for s in view.stops] == [40.0, 30.0, 10.0, 10.0]
    assert view.stops[2].skipped  # S2 kept its skip

    assert routes.remove_stop(conn, 1)
    view = routes.route_view(conn, None, Planner())
    assert [s.name for s in view.stops] == ["S1", "S2", "S3"]
    assert view.stops[0].hop_ly == 10.0 and len(view.stops[0].bodies) == 1
    assert conn.execute("SELECT COUNT(*) FROM route_bodies").fetchone()[0] == 3
    assert not routes.move_stop(conn, 9, 1) and not routes.remove_stop(conn, 9)


def test_jumps_to_the_next_stop_count_the_fuel_aboard(conn: sqlite3.Connection) -> None:
    # A Mandalay with 112 t of fuel: 34.9 ly at most, 27.4 ly with the tank full (the game's
    # galaxy map), so a stop 32.6 ly away takes two jumps unless the tank holds <= 32 t.
    k, power, unladen = 3.9e-10, 2.45, 383.2
    used = k * (20.0 * (unladen + 112.0)) ** power
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
        {
            "timestamp": "2026-10-17T10:00:01Z",
            "event": "Loadout",
            "Ship": "mandalay",
            "ShipID": 3,
            "UnladenMass": unladen,
            "MaxJumpRange": 34.9,
            "FuelCapacity": {"Main": 112.0, "Reserve": 0.5},
            "Modules": [
                {"Slot": "FrameShiftDrive", "Item": "int_hyperdrive_overcharge_size5_class5"},
                {"Slot": "Slot06_Size3", "Item": "int_fuelscoop_size3_class4"},
            ],
        },
        {
            "timestamp": "2026-10-17T10:01:00Z",
            "event": "FSDJump",
            "StarSystem": "Start",
            "SystemAddress": 999,
            "StarPos": [0.0, 0.0, 0.0],
            "JumpDist": 20.0,
            "FuelUsed": used,
            "FuelLevel": 112.0 - used,
        },
        {"timestamp": "2026-10-17T10:02:00Z", "event": "FuelScoop", "Total": 112.0},
    )
    stops = [body(1, 1, (32.62, 0, 0), name="Alpha"), body(2, 1, (65.24, 0, 0), name="Beta")]
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start"), FakeSearch(stops), no_mapped, START
    )
    routes.store(conn, RouteRequest(mode="riches"), plan, None)

    view = routes.route_view(conn, "F1", Planner())
    assert view.jump_range_ly == 34.9
    assert view.jump_range_now_ly == pytest.approx(27.37, abs=0.01)
    assert view.jump_range_full_ly == view.jump_range_now_ly
    assert view.jumps_to_next == 2 and view.stops[1].jumps == 2
    assert view.one_jump_fuel_t == pytest.approx(32.3, abs=0.1)

    # 20 t aboard (Status.json): one jump from here; the hops further on still count a full tank.
    view = routes.route_view(conn, "F1", Planner(), live_fuel=20.0)
    assert view.jump_range_now_ly is not None and view.jump_range_now_ly > 32.62
    assert view.jumps_to_next == 1 and view.one_jump_fuel_t is None
    assert view.stops[1].jumps == 2


def test_systems_you_sampled_species_in_are_left_out() -> None:
    bodies = [
        bio_body(1, 3, (10, 0, 0), ("Bacterial", "Shrubs")),
        bio_body(2, 3, (20, 0, 0), ("Bacterial",), signals=1),
    ]
    req = PlanRequest(mode="riches", source="Start", body_types=("bio",), bio_min_value=0)
    # One of two species analysed in system 1: what is left there does not bring you back.
    sampled = {(1, 3): (False, 1)}
    assert [
        s.address for s in routeplan.plan(req, FakeSearch(bodies), lambda ids: sampled).stops
    ] == [2]
    keep = PlanRequest(
        mode="riches", source="Start", body_types=("bio",), bio_min_value=0, skip_mapped=False
    )
    assert [
        s.address for s in routeplan.plan(keep, FakeSearch(bodies), lambda ids: sampled).stops
    ] == [1, 2]


def test_stops_you_went_past_count_as_skipped(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-17T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
        {
            "timestamp": "2026-10-17T10:00:02Z",
            "event": "Location",
            "StarSystem": "Start",
            "SystemAddress": 999,
            "StarPos": [0.0, 0.0, 0.0],
        },
    )
    bodies = [
        body(1, 1, (10, 0, 0), name="Alpha"),
        body(2, 1, (20, 0, 0), name="Beta"),
        body(3, 1, (30, 0, 0), name="Gamma"),
    ]
    plan = routeplan.plan(
        PlanRequest(mode="riches", source="Start"), FakeSearch(bodies), no_mapped, START
    )
    routes.store(conn, RouteRequest(mode="riches"), plan, None)
    conn.execute("UPDATE route SET created_at = '2026-10-17T10:05:00+00:00'")

    def arrive(name: str, address: int, x: float, ts: str) -> None:
        feed(
            conn,
            proj,
            {
                "timestamp": ts,
                "event": "FSDJump",
                "StarSystem": name,
                "SystemAddress": address,
                "StarPos": [x, 0.0, 0.0],
                "JumpDist": 10.0,
            },
        )

    arrive("Alpha", 1, 10.0, "2026-10-17T10:10:00Z")
    view = routes.route_view(conn, "F1", Planner())
    assert view.next_seq == 1 and view.stops[0].here and not view.stops[0].passed

    # On to Beta with Alpha unmapped: Alpha was skipped, Beta is the next stop.
    arrive("Beta", 2, 20.0, "2026-10-17T10:20:00Z")
    view = routes.route_view(conn, "F1", Planner())
    alpha, beta = view.stops[0], view.stops[1]
    assert alpha.passed and not alpha.skipped and not alpha.done
    assert view.next_seq == 2 and beta.here and view.skipped_count == 1

    # Back at Alpha: it is the next stop again.
    arrive("Alpha", 1, 10.0, "2026-10-17T10:30:00Z")
    view = routes.route_view(conn, "F1", Planner())
    assert view.next_seq == 1 and not view.stops[0].passed


def test_bio_route_minimum_value_of_one_species() -> None:
    cheap = bio_body(1, 3, (10, 0, 0), ("Bacterial",), signals=1)
    dear = bio_body(2, 3, (20, 0, 0), ("Conchas",), signals=1)
    both = bio_body(3, 3, (30, 0, 0), ("Bacterial", "Conchas"))
    low, high = routebio.estimate(cheap), routebio.estimate(dear)
    assert low is not None and high is not None and low.best < 5_000_000 <= high.best
    bodies = [cheap, dear, both]

    def stops(threshold: int) -> list[int]:
        req = PlanRequest(
            mode="riches",
            source="Start",
            body_types=("bio",),
            bio_min_value=0,
            bio_min_species_value=threshold,
        )
        return [s.address for s in routeplan.plan(req, FakeSearch(bodies), no_mapped).stops]

    assert stops(0) == [1, 2, 3]
    # Only planets where a species worth 5M may grow: the cheap one is left out, the one with
    # both genera stays.
    assert stops(5_000_000) == [2, 3]
    # Its value counts only the species worth that much: the Bacterium is left out.
    every, counted = routebio.estimate(both), routebio.estimate(both, 5_000_000)
    assert every is not None and counted is not None
    assert counted.high == high.high < every.high
    assert counted.low == (high.low if high.low >= 5_000_000 else 0)
    assert counted.best == every.best

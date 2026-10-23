from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from app import boxel, db, routefirsts, routes, spansh
from app.projector import Projector
from app.routeplan import PlanError, PlanRequest, Point
from app.schemas import RouteRequest

# Real systems (Spansh, 2026-10-22): name, id64, coordinates.
FROALT_B = ("Froalt FR-S b31-7", 16037273877777, (-1997.0625, 43.53125, 14976.46875))
REAL = [
    FROALT_B,
    ("Froalt MC-S b31-49", 108396518849809, (-1977.0625, -22.09375, 14983.53125)),
    ("Froalt DG-W c15-159", 43786084327050, (-2019.96875, 17.28125, 14980.90625)),
    ("Blae Eaec NO-O d7-27", 937804402499, (-1856.25, -154.0625, 14963.53125)),
    ("Froalt FG-Y f2192", 1176977802189, (-2036.9375, 121.75, 14842.1875)),
    ("Core Sys Sector MC-V b2-7", 16064385656233, (22.5, -5.625, 13.28125)),
]
FAR = Point("Start", -2000.0, 0.0, 15000.0)  # ~15 000 ly from Sol: most systems are firsts


def test_boxels_of_real_systems() -> None:
    for name, id64, xyz in REAL:
        box, number = boxel.decode(id64)
        corner = box.corner
        assert all(c <= p <= c + box.size for c, p in zip(corner, xyz, strict=True)), name
        assert box.address(number) == id64
        prefix = boxel.generated_prefix(name, id64)
        assert prefix is not None and f"{prefix}{number}" == name
    box, number = boxel.decode(FROALT_B[1])
    assert (box.mass_code, number, box.size) == (1, 7, 20.0)
    # A body's id above the system's does not change the boxel.
    assert boxel.decode(FROALT_B[1] | (5 << 55)) == (box, number)
    # Catalogue and renamed systems, or a number that does not match the id64: not generated.
    assert boxel.generated_prefix("Sol", 10477373803) is None
    assert boxel.generated_prefix("Froalt FR-S b31-8", FROALT_B[1]) is None


def system(
    name: str,
    id64: int,
    xyz: tuple[float, float, float],
    *,
    scanned: bool = True,
    permit: bool = False,
    population: int = 0,
) -> dict[str, Any]:
    return {
        "id64": id64,
        "name": name,
        "x": xyz[0],
        "y": xyz[1],
        "z": xyz[2],
        "population": population,
        "needs_permit": permit,
        "main_star": scanned,
        "bodies": 3 if scanned else 0,
    }


def members(
    known: tuple[str, int, tuple[float, float, float]], numbers: list[int], **kw: Any
) -> list[dict[str, Any]]:
    """Systems of a real system's boxel, by number, all at its position."""
    name, id64, xyz = known
    box, _ = boxel.decode(id64)
    prefix = boxel.generated_prefix(name, id64)
    assert prefix is not None
    return [system(f"{prefix}{n}", box.address(n), xyz, **kw) for n in numbers]


class FakeNear:
    """Spansh's systems search in memory: nearest first, paged like Spansh."""

    def __init__(
        self,
        systems: list[dict[str, Any]],
        elsewhere: set[int] | None = None,
        named: dict[str, tuple[float, float, float]] | None = None,
    ) -> None:
        self.all = systems
        self.elsewhere = elsewhere or set()  # known to Spansh, outside every page
        self.named = named or {}
        self.asked: list[int] = []

    def systems_near(self, reference, max_distance, page):
        if "reference_route" in reference:
            r = reference["reference_route"]
            if r["source"] not in self.named or r["destination"] not in self.named:
                raise spansh.SpanshRejected("unknown")
            a, b = self.named[r["source"]], self.named[r["destination"]]

            def distance(q):
                ab = [y - x for x, y in zip(a, b, strict=True)]
                t = sum((qi - ai) * c for qi, ai, c in zip(q, a, ab, strict=True))
                t = max(0.0, min(1.0, t / sum(c * c for c in ab)))
                return math.dist(q, [ai + t * c for ai, c in zip(a, ab, strict=True)])

            ref = [
                {"name": n, "x": p[0], "y": p[1], "z": p[2]}
                for n, p in ((r["source"], a), (r["destination"], b))
            ]
        else:
            c = reference["reference_coords"]
            p = (c["x"], c["y"], c["z"])

            def distance(q):
                return math.dist(p, q)

            ref = None
        hits = []
        for s in self.all:
            d = distance((s["x"], s["y"], s["z"]))
            if d <= max_distance:
                hits.append({**s, "distance": d})
        hits.sort(key=lambda s: (s["distance"], s["id64"]))
        size = spansh.PAGE_SIZE
        return {
            "count": len(hits),
            "reference": ref,
            "results": hits[page * size : (page + 1) * size],
        }

    def systems(self, ids):
        self.asked += ids
        known = {s["id64"] for s in self.all} | self.elsewhere
        return {i: {"population": 0, "needs_permit": False} for i in ids if i in known}


def test_firsts_take_missing_numbers_and_systems_seen_only_in_routes() -> None:
    b_box, _ = boxel.decode(FROALT_B[1])
    near = (FAR.x + 5, FAR.y, FAR.z)
    route_only = system("Froalt AB-C a1-2", 123_456_789, near, scanned=False)
    catalogue = members(REAL[1], [0, 3]) + [
        {**system("HIP 99999", boxel.decode(REAL[1][1])[0].address(1), REAL[1][2])}
    ]
    systems = [
        *members(FROALT_B, [0, 1, 3, 7]),  # numbers 2, 4, 5, 6 missing
        *catalogue,  # a catalogue star there: its holes may be no system at all
        *members(REAL[2], [0, 5], permit=True),  # permit-locked
        *members(REAL[3], [0, 9]),  # mass code d: 80 ly, too vague a position
        route_only,
        system("Populated", 987_654_321, near, scanned=False, population=1000),
    ]
    req = PlanRequest(mode="riches", goal="firsts", source="Start", radius_ly=400, max_systems=10)

    plan = routefirsts.plan(req, FakeNear(systems), set(), FAR)
    by_name = {s.name: s for s in plan.stops}
    assert set(by_name) == {"Froalt AB-C a1-2", "Froalt FR-S b31-2"}
    gap = by_name["Froalt FR-S b31-2"]
    assert gap.address == b_box.address(2) and gap.discovery == "unknown" and gap.spread_ly == 10.0
    assert (gap.x, gap.y, gap.z) == b_box.centre
    seen = by_name["Froalt AB-C a1-2"]
    assert seen.discovery == "seen" and seen.spread_ly == 0.0 and seen.xyz == near
    assert plan.stops[0].name == "Froalt AB-C a1-2"  # the nearer one first
    assert plan.stops[0].hop_ly == pytest.approx(5.0)

    # Visited by you, or known to Spansh outside the pages read: the next number takes its place.
    search = FakeNear(systems, elsewhere={b_box.address(4)})
    plan = routefirsts.plan(req, search, {b_box.address(2), 123_456_789}, FAR)
    assert [s.name for s in plan.stops] == ["Froalt FR-S b31-5"]
    assert b_box.address(4) in search.asked


def test_a_boxel_across_the_edge_of_the_pages_read_gives_no_gap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Two systems a page, from the boxel's centre: the first page reaches 3 ly and holds its
    # number 3; numbers 0 to 2 are farther, not missing, only not read yet.
    monkeypatch.setattr(spansh, "PAGE_SIZE", 2)
    monkeypatch.setattr(routefirsts, "PAGE_SIZE", 2)
    box, _ = boxel.decode(FROALT_B[1])
    start = Point("Start", *box.centre)
    corner = box.corner
    near = members(FROALT_B, [3])[0] | {"x": start.x + 3, "y": start.y, "z": start.z}
    far = [
        m | {"x": corner[0] + 1, "y": corner[1], "z": corner[2]}
        for m in members(FROALT_B, [0, 1, 2])
    ]
    systems = [system("Seen 1", 1001, (start.x + 1, start.y, start.z), scanned=False), near, *far]
    req = PlanRequest(mode="riches", goal="firsts", source="Start", radius_ly=100, max_systems=1)
    search = FakeNear(systems)
    plan = routefirsts.plan(req, search, set(), start)
    assert [s.name for s in plan.stops] == ["Seen 1"] and search.asked == []


def test_firsts_around_a_point_take_the_nearest() -> None:
    # Route-only systems on a line away from the start, 10 ly apart.
    systems = [
        system(f"Seen {i}", 1000 + i, (FAR.x + 10 * i, FAR.y, FAR.z), scanned=False)
        for i in range(1, 30)
    ]
    req = PlanRequest(mode="riches", goal="firsts", source="Start", radius_ly=100, max_systems=5)
    plan = routefirsts.plan(req, FakeNear(systems), set(), FAR)
    assert [s.name for s in plan.stops] == [f"Seen {i}" for i in range(1, 6)]
    assert plan.truncated
    req.radius_ly = 25
    plan = routefirsts.plan(req, FakeNear(systems), set(), FAR)
    assert [s.name for s in plan.stops] == ["Seen 1", "Seen 2"] and not plan.truncated


def test_firsts_along_a_line_are_a_jump_apart() -> None:
    systems = [
        system(f"Seen {x}", 1000 + x, (float(x), 1.0, 0.0), scanned=False)
        for x in range(10, 100, 10)
    ]
    named = {"A": (0.0, 0.0, 0.0), "B": (100.0, 0.0, 0.0)}
    req = PlanRequest(
        mode="line",
        goal="firsts",
        source="A",
        destination="B",
        deviation_ly=5,
        max_systems=100,
        jump_range_ly=25.0,
    )
    plan = routefirsts.plan(req, FakeNear(systems, named=named), set())
    assert [s.name for s in plan.stops] == ["Seen 20", "Seen 40", "Seen 60", "Seen 80", "Seen 90"]
    assert plan.destination is not None and plan.destination.name == "B"
    # Fewer stops than jumps: spread to reach the destination.
    req.max_systems = 2
    plan = routefirsts.plan(req, FakeNear(systems, named=named), set())
    assert [s.name for s in plan.stops] == ["Seen 40", "Seen 90"]  # 50 is 50.01 ly off
    # A gap wider than a jump: the nearest ahead.
    far_apart = [s for s in systems if s["name"] in ("Seen 10", "Seen 70")]
    req.max_systems = 100
    plan = routefirsts.plan(req, FakeNear(far_apart, named=named), set())
    assert [s.name for s in plan.stops] == ["Seen 10", "Seen 70"]
    req.destination = "Nowhere"
    with pytest.raises(PlanError):
        routefirsts.plan(req, FakeNear(systems, named=named), set())


# --------------------------------------------------------------------------- view


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


def test_firsts_route_view_counts_your_first_discoveries(conn: sqlite3.Connection) -> None:
    proj = Projector(conn)
    feed(
        conn,
        proj,
        {"timestamp": "2026-10-22T10:00:00Z", "event": "Commander", "FID": "F1", "Name": "T"},
        {"timestamp": "2026-10-22T10:00:01Z", "event": "Loadout", "MaxJumpRange": 50.0},
        {
            "timestamp": "2026-10-22T10:00:02Z",
            "event": "Location",
            "StarSystem": "Start",
            "SystemAddress": 999,
            "StarPos": list(FAR.xyz),
        },
    )
    b_box, _ = boxel.decode(FROALT_B[1])
    seen = (FAR.x + 5, FAR.y, FAR.z)
    systems = [*members(FROALT_B, [0, 1, 3]), system("Froalt AB-C a1-2", 1234, seen, scanned=False)]
    req = RouteRequest(mode="riches", goal="firsts", radius_ly=100)
    plan = routefirsts.plan(routes._plan_request(req, FAR), FakeNear(systems), set(), FAR)
    routes.store(conn, req, plan, None)

    view = routes.route_view(conn, "F1", Planner())
    assert [s.name for s in view.stops] == ["Froalt AB-C a1-2", "Froalt FR-S b31-2"]
    first, gap = view.stops
    assert first.discovery is not None and first.discovery.probability == 0.9
    assert first.discovery.reasons == ["seen_in_routes"] and first.spread_ly == 0.0
    assert gap.discovery is not None and gap.discovery.probability == 0.95
    assert gap.discovery.reasons == ["not_in_databases"] and gap.spread_ly == 10.0
    assert view.firsts_left == 1.85 and view.firsts_found == 0 and view.next_seq == 1

    feed(
        conn,
        proj,
        {
            "timestamp": "2026-10-22T10:05:00Z",
            "event": "FSDJump",
            "StarSystem": "Froalt AB-C a1-2",
            "SystemAddress": 1234,
            "StarPos": list(seen),
            "JumpDist": 5.0,
        },
        {
            "timestamp": "2026-10-22T10:05:05Z",
            "event": "Scan",
            "ScanType": "AutoScan",
            "BodyName": "Froalt AB-C a1-2",
            "BodyID": 0,
            "StarSystem": "Froalt AB-C a1-2",
            "SystemAddress": 1234,
            "DistanceFromArrivalLS": 0.0,
            "StarType": "M",
            "WasDiscovered": False,
        },
    )
    view = routes.route_view(conn, "F1", Planner())
    first, gap = view.stops
    assert first.done and first.here and first.first is True and first.discovery is None
    assert view.next_seq == 2 and view.firsts_found == 1 and view.firsts_left == 0.95
    assert gap.first is None

    # Asked since: EDSM knows the system scanned, so somebody was there.
    conn.execute(
        "INSERT INTO discovery(id64, fetched_at, spansh, edsm) VALUES(?, ?, 0, 2)",
        (b_box.address(2), "2026-10-22T10:06:00+00:00"),
    )
    view = routes.route_view(conn, "F1", Planner())
    assert view.stops[1].discovery is not None and view.stops[1].discovery.state == "scanned"
    assert view.firsts_left == 0.02


def test_firsts_stops_keep_their_spread_when_moved(conn: sqlite3.Connection) -> None:
    systems = [
        *members(FROALT_B, [0, 1, 3]),
        system("Froalt AB-C a1-2", 1234, (FAR.x + 5, FAR.y, FAR.z), scanned=False),
    ]
    req = RouteRequest(mode="riches", goal="firsts", radius_ly=100)
    plan = routefirsts.plan(routes._plan_request(req, FAR), FakeNear(systems), set(), FAR)
    routes.store(conn, req, plan, None)
    assert routes.move_stop(conn, 2, 1)
    view = routes.route_view(conn, None, Planner())
    assert [(s.name, s.spread_ly) for s in view.stops] == [
        ("Froalt FR-S b31-2", 10.0),
        ("Froalt AB-C a1-2", 0.0),
    ]


def test_cached_search_keeps_known_systems_near_a_place(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "t.db"
    c = db.connect(path)
    db.init_schema(c)
    c.close()
    calls: list[dict[str, Any]] = []

    def fake_post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
        calls.append(payload)
        assert url == spansh.SYSTEMS_SEARCH
        return {
            "count": 2,
            "reference": None,
            "results": [
                {**system("A", 1, (1, 2, 3)), "bodies": [{"is_main_star": True}, {}], "x": 1},
                {**system("B", 2, (1, 2, 3)), "bodies": None},
            ],
        }

    monkeypatch.setattr(spansh, "_post", fake_post)
    ref = {"reference_coords": {"x": 0.0, "y": 0.0, "z": 0.0}}
    first = spansh.CachedSearch(path)
    page = first.systems_near(ref, 1000.0, 0)
    assert [(r["name"], r["main_star"], r["bodies"]) for r in page["results"]] == [
        ("A", True, 2),
        ("B", False, 0),
    ]
    assert calls[0]["sort"] == [{"distance": {"direction": "asc"}}]
    first.close()
    second = spansh.CachedSearch(path)
    assert second.systems_near(ref, 1000.0, 0) == page and len(calls) == 1
    second.close()

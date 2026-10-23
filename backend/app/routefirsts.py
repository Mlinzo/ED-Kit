"""Firsts routes: systems nobody has likely discovered yet.

Spansh knows only what somebody uploaded, so the stops are of two kinds:
- seen only in routes: Spansh has the system from a route somebody plotted (EDDN NavRoute) but
  neither its arrival star nor a body. The position is exact; far from the bubble 88 % of
  these were first discoveries (app.discovery);
- missing numbers: a generated name's id64 holds its boxel and its number there, and a boxel's
  numbers run from 0 with no holes (app.boxel). Spansh knowing "Froalt MC-S b31-49" means
  numbers 0 to 48 exist too, and those it does not know nobody uploaded (96 % first far out).
  The name is exact (the galaxy map finds it), the position only the boxel's centre: one such
  stop per boxel, so the stops keep apart, and only boxels up to 40 ly (mass codes a-c). A
  boxel with a system the generator did not name gives none: catalogue stars leave holes, names
  that do not exist. Nor does a boxel partly outside what has been read (around a point): near
  the bubble the pages reach 50-100 ly, and a boxel across that edge seemed full of missing
  numbers that were only systems not read yet. Along a line, where a boxel hardly fits in the
  corridor, every missing number is asked about by id64 instead.

Systems you have been to, populated and permit-locked ones are left out. How likely each stop
is a first comes from app.discovery: far from the bubble most are, near it few.

Around a point: the nearest candidates in a short open path, like the other routes. Along a
line: from the start, each stop is the candidate furthest along the line within one jump (the
full-tank range, or the line's length over the stop count when that is longer, so the stops
reach the destination), so every jump can land in a first.

Speed: the known systems come nearest first, a page (500) per request, cached for a day
(app.spansh.CachedSearch.systems_near); the missing numbers picked are then asked about by id64
(a system Spansh knows outside the pages read is dropped).
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Protocol

from app import boxel
from app.routeplan import (
    LINE_MAX_PAGES,
    MAX_RADIUS_LY,
    MAX_STOPS,
    RICHES_BUDGET_S,
    RICHES_MAX_BATCH,
    WORKERS,
    Plan,
    PlanError,
    PlanRequest,
    PlanStop,
    Point,
    order_open_path,
    reference_point,
    run_parallel,
    set_hops,
)
from app.spansh import MAX_WINDOW, PAGE_SIZE, Reference

MAX_GAP_MASS_CODE = 2  # c: 40 ly boxels; a larger boxel is too vague a position
HALF_DIAGONAL = math.sqrt(3) / 2  # of a cube, per ly of its edge
# Candidates asked about per stop wanted: some missing numbers turn out known.
SPARE = 1.5


class Search(Protocol):
    def systems_near(
        self, reference: Reference, max_distance: float, page: int
    ) -> dict[str, Any]: ...

    def systems(self, ids: list[int]) -> dict[int, dict[str, Any]]: ...


@dataclass(slots=True)
class _Box:
    """What the pages read tell of one boxel."""

    boxel: boxel.Boxel
    numbers: set[int] = field(default_factory=set)
    prefix: str | None = None  # a generated name without its number
    catalogued: bool = False  # a system the generator did not name
    locked: bool = False  # a system that needs a permit


def _xyz(raw: dict[str, Any]) -> tuple[float, float, float] | None:
    values = [raw.get(k) for k in ("x", "y", "z")]
    if any(not isinstance(v, int | float) or isinstance(v, bool) for v in values):
        return None
    x, y, z = (float(v) for v in values)  # type: ignore[arg-type]
    return (x, y, z)


class _Found:
    """Known systems gathered from the pages, and the candidates they give."""

    def __init__(self, visited: set[int]) -> None:
        self.visited = visited
        self.boxes: dict[int, _Box] = {}
        self.seen: dict[int, PlanStop] = {}
        self.asked: set[int] = set()  # missing numbers asked about by id64
        self.elsewhere: set[int] = set()  # those Spansh knows (outside the pages read)
        self.count: int | None = None
        self.pages = 0
        self.frontier = 0.0  # the farthest system read: every known one nearer is read too
        self.reference: Any = None

    def add_page(self, data: dict[str, Any]) -> None:
        self.count = int(data.get("count") or 0)
        self.pages += 1
        if self.reference is None:
            self.reference = data.get("reference")
        for r in data.get("results") or []:
            try:
                address = int(r["id64"])
            except (KeyError, TypeError, ValueError):
                continue
            xyz = _xyz(r)
            distance = r.get("distance")
            if isinstance(distance, int | float):
                self.frontier = max(self.frontier, float(distance))
            box, number = boxel.decode(address)
            entry = self.boxes.setdefault(box.bits, _Box(box))
            entry.numbers.add(number)
            name = str(r.get("name") or "")
            prefix = boxel.generated_prefix(name, address)
            if prefix is None:
                entry.catalogued = True
            elif entry.prefix is None:
                entry.prefix = prefix
            permit = bool(r.get("needs_permit"))
            entry.locked = entry.locked or permit
            untouched = not r.get("main_star") and not r.get("bodies")
            if (
                untouched
                and xyz is not None
                and not permit
                and not r.get("population")
                and address not in self.visited
            ):
                self.seen[address] = PlanStop(
                    address=address,
                    name=name,
                    x=xyz[0],
                    y=xyz[1],
                    z=xyz[2],
                    distance=float(distance) if isinstance(distance, int | float) else math.inf,
                    discovery="seen",
                )

    def exhausted(self) -> bool:
        return self.count is not None and self.pages * PAGE_SIZE >= min(self.count, MAX_WINDOW)

    def gaps(self, inside: Callable[[boxel.Boxel], bool]) -> list[PlanStop]:
        """One missing number per boxel (the lowest not known, nor visited by you), of the
        boxels `inside` what has been read: in one that is not, a number may only be missing
        from the pages."""
        out = []
        for entry in self.boxes.values():
            b = entry.boxel
            if (
                b.mass_code > MAX_GAP_MASS_CODE
                or entry.prefix is None
                or entry.catalogued
                or entry.locked
                or not inside(b)
            ):
                continue
            for number in range(max(entry.numbers)):
                address = b.address(number)
                if number in entry.numbers or address in self.elsewhere or address in self.visited:
                    continue
                x, y, z = b.centre
                out.append(
                    PlanStop(
                        address=address,
                        name=f"{entry.prefix}{number}",
                        x=x,
                        y=y,
                        z=z,
                        distance=math.inf,
                        discovery="unknown",
                        spread_ly=b.size / 2,
                    )
                )
                break
        return out

    def candidates(self, inside: Callable[[boxel.Boxel], bool]) -> list[PlanStop]:
        return [*self.seen.values(), *self.gaps(inside)]


def _drop_known(
    pool: ThreadPoolExecutor, search: Search, found: _Found, stops: list[PlanStop]
) -> bool:
    """Ask Spansh about the missing numbers among the stops (not asked before); those it knows
    join `found.elsewhere`. True when some did."""
    ids = [s.address for s in stops if s.discovery == "unknown" and s.address not in found.asked]
    found.asked.update(ids)
    batches = [ids[i : i + PAGE_SIZE] for i in range(0, len(ids), PAGE_SIZE)]
    known: set[int] = set()
    for info in run_parallel(pool, [lambda b=b: search.systems(b) for b in batches]):
        known.update(info)
    found.elsewhere |= known
    return bool(known)


def plan(req: PlanRequest, search: Search, visited: set[int], source: Point | None = None) -> Plan:
    """Plan a firsts route. `visited`: every system you have been to. `source`: the start's
    coordinates when known locally."""
    if req.mode == "line":
        return _plan_line(req, search, visited)
    return _plan_riches(req, search, visited, source)


def _plan_riches(req: PlanRequest, search: Search, visited: set[int], source: Point | None) -> Plan:
    wanted = max(1, min(req.max_systems, MAX_STOPS))
    radius = max(1.0, min(req.radius_ly, MAX_RADIUS_LY))
    reference: Reference = (
        {"reference_coords": {"x": source.x, "y": source.y, "z": source.z}}
        if source is not None
        else {"reference_system": req.source}
    )
    found = _Found(visited)
    deadline = time.monotonic() + RICHES_BUDGET_S
    with ThreadPoolExecutor(WORKERS) as pool:

        def fetch(n: int) -> None:
            first = found.pages
            for data in run_parallel(
                pool,
                [
                    lambda p=p: search.systems_near(reference, MAX_RADIUS_LY, p)
                    for p in range(first, first + n)
                ],
            ):
                found.add_page(data)

        fetch(1)
        if source is None:
            source = reference_point(found.reference, req.source)
        if source is None:
            raise PlanError("unknown_system", req.source)
        start = source.xyz

        def usable() -> list[PlanStop]:
            # Within the radius, and within what has been read: nothing nearer is missing.
            read = MAX_RADIUS_LY if found.exhausted() else found.frontier
            edge = min(radius, read)

            def inside(b: boxel.Boxel) -> bool:
                return math.dist(start, b.centre) + b.size * HALF_DIAGONAL <= read

            out = []
            for s in found.candidates(inside):
                s.distance = math.dist(start, s.xyz)
                if s.distance <= edge:
                    out.append(s)
            return sorted(out, key=lambda s: (s.distance, s.address))

        while True:
            stops = usable()
            read_all = found.exhausted() or found.frontier >= radius
            late = time.monotonic() > deadline
            if len(stops) < wanted * SPARE and not read_all and not late:
                left = math.ceil(min(found.count or 0, MAX_WINDOW) / PAGE_SIZE) - found.pages
                fetch(max(1, min(RICHES_MAX_BATCH, left)))
                continue
            # Missing numbers Spansh knows after all (outside the pages read) give way to the
            # next numbers of their boxels.
            if not _drop_known(pool, search, found, stops[: math.ceil(wanted * SPARE)]) or late:
                stops = [s for s in stops if s.address not in found.elsewhere]
                break
    chosen = order_open_path(start, stops[:wanted])
    set_hops(start, chosen)
    return Plan(source=source, destination=None, stops=chosen, truncated=len(stops) > wanted)


def _plan_line(req: PlanRequest, search: Search, visited: set[int]) -> Plan:
    if not req.destination:
        raise PlanError("no_destination")
    reference: Reference = {
        "reference_route": {"source": req.source, "destination": req.destination}
    }
    deviation = max(1.0, min(req.deviation_ly, 100.0))
    found = _Found(visited)
    with ThreadPoolExecutor(WORKERS) as pool:
        (first,) = run_parallel(pool, [lambda: search.systems_near(reference, deviation, 0)])
        found.add_page(first)
        total = min(found.count or 0, MAX_WINDOW, LINE_MAX_PAGES * PAGE_SIZE)
        rest = range(1, math.ceil(total / PAGE_SIZE))
        for data in run_parallel(
            pool, [lambda p=p: search.systems_near(reference, deviation, p) for p in rest]
        ):
            found.add_page(data)
        ref = found.reference
        pair = ref if isinstance(ref, list) and len(ref) == 2 else [None, None]
        source = reference_point(pair[0], req.source)
        destination = reference_point(pair[1], req.destination)
        if source is None or destination is None:
            raise PlanError("unknown_system")
        a, b = source.xyz, destination.xyz
        axis = [q - p for p, q in zip(a, b, strict=True)]
        length = math.sqrt(sum(c * c for c in axis)) or 1.0

        def place(s: PlanStop) -> bool:
            """Its position along the line (0..1) and distance from it; True inside the corridor."""
            t = sum((p - o) * c for p, o, c in zip(s.xyz, a, axis, strict=True)) / length**2
            s.along = t
            nearest = [o + t * c for o, c in zip(a, axis, strict=True)]
            s.distance = math.dist(s.xyz, nearest)
            return 0.0 < t < 1.0 and s.distance <= deviation

        # A boxel hardly ever fits in the corridor: every missing number is asked about.
        candidates = [s for s in found.candidates(lambda _: True) if place(s)]
        _drop_known(pool, search, found, candidates)
    candidates = [s for s in candidates if s.address not in found.elsewhere]
    wanted = max(1, min(req.max_systems, MAX_STOPS))
    reach = max(req.jump_range_ly or 0.0, length / wanted)
    stops = _spaced(
        a, sorted(candidates, key=lambda s: (s.along, s.address)), wanted, reach, length
    )
    set_hops(a, stops)
    return Plan(source=source, destination=destination, stops=stops, truncated=False)


def _spaced(
    start: tuple[float, float, float],
    candidates: list[PlanStop],
    wanted: int,
    reach: float,
    length: float,
) -> list[PlanStop]:
    """Stops along the line (candidates in order along it): each the one furthest along within
    `reach` of the one before (a missing number's spread counted against it), or the nearest
    ahead when none is."""
    out: list[PlanStop] = []
    here, spread, along = start, 0.0, 0.0
    first = 0  # candidates before it are behind
    while len(out) < wanted:
        while first < len(candidates) and candidates[first].along <= along:
            first += 1
        if first == len(candidates):
            break
        pick: PlanStop | None = None
        for s in candidates[first:]:
            if (s.along - along) * length > reach:
                break  # the rest are farther along the line than a jump
            if math.dist(here, s.xyz) + s.spread_ly + spread <= reach:
                pick = s  # in order along the line: the last one fitting is the furthest
        if pick is None:
            pick = min(candidates[first:], key=lambda s: (math.dist(here, s.xyz), s.address))
        out.append(pick)
        here, spread, along = pick.xyz, pick.spread_ly, pick.along
    return out

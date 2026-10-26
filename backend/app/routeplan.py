"""Route planning: valuable bodies from Spansh, our own stop order.

A system is worth what its bodies pay together: the mapping payout of the chosen kinds (Road
to Riches: ELW, terraformable water worlds ...) plus the species predicted on its landable
bodies with biological signals (app.routebio). One body can count for both.

Two modes, like EDTools:
- riches: the systems with valuable bodies nearest to a start point (within a radius), in a
  short open path from the start (nearest neighbour, then 2-opt);
- line: the most valuable such systems (up to the route's size) within a corridor around the
  straight line between two systems, in order along the line (2-opt removes the zigzags across
  the corridor; the path still ends at the destination).

A codex route (goal "codex") counts new codex entries instead of credits: bodies with
biological signals whose predicted species, in their likely colours, are not in your codex
for the body's region (app.routebio gives each entry a chance). An entry counts once per
route: stops are taken in order (nearest first, or the best first along a line) and each is
worth only what the stops before it have not already covered.

Every stop is a separate plot in the galaxy map. Bodies you have already mapped, or whose
species you have all analysed (journal), count as done; permit-locked systems are left out,
populated ones on request. Since the 2025 colonisation nearly every system with such bodies
near the bubble is populated, and mapping pays there all the same, so populated systems are
included by default.

Speed: the network is the cost (one Spansh search takes ~0.5 s). Searches run in parallel,
one per body kind, and stop as soon as enough systems are known; the ordering takes
milliseconds. Searches are cached (app.spansh.CachedSearch): one query per kind, and the
riches radius applied here rather than in the query, so changing the radius or a kind reuses
what is cached.
"""

from __future__ import annotations

import heapq
import math
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from app import regionmap, routebio
from app.codex import CodexIndex, codex_status
from app.spansh import MAX_WINDOW, PAGE_SIZE, Reference, SpanshError, SpanshRejected

# Body kind -> (Spansh subtype, accepted terraforming states or None for any).
BODY_TYPES: dict[str, tuple[str, tuple[str, ...] | None]] = {
    "elw": ("Earth-like world", None),
    "tww": ("Water world", ("Terraformable",)),
    "thmc": ("High metal content world", ("Terraformable",)),
    "ww": ("Water world", ("Not terraformable",)),
    "aw": ("Ammonia world", None),
    "trocky": ("Rocky body", ("Terraformable",)),
}
DEFAULT_TYPES = ("elw", "tww", "thmc")

MAX_RADIUS_LY = 1000.0
MAX_STOPS = 1000
# Riches mode: a high system threshold leaves few usable systems per page. Then several
# pages per kind are fetched per round, up to this many, and searching stops after the time
# budget (the route comes out shorter).
RICHES_MAX_BATCH = 3
RICHES_BUDGET_S = 6.0
# Line mode: bodies fetched per kind at most (nearest to the line first).
LINE_MAX_PAGES = 6
WORKERS = 6
SYSTEMS_BATCH = PAGE_SIZE
TWO_OPT_NEIGHBOURS = 10
TWO_OPT_BUDGET_S = 0.25

Mode = Literal["riches", "line"]
Goal = Literal["credits", "codex", "firsts"]
# Codex routes, in expected new entries: a body below this is left out, and so is a stop
# whose bodies add less than MIN_CODEX_STOP to what the stops before it cover.
MIN_CODEX_BODY = 0.25
MIN_CODEX_STOP = 0.5


@dataclass(slots=True)
class Point:
    name: str
    x: float
    y: float
    z: float

    @property
    def xyz(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.z)


@dataclass(slots=True)
class PlanBody:
    body_id: int
    name: str
    # A BODY_TYPES key when the body counts for mapping, "bio" when only for its biology.
    kind: str
    distance_ls: float | None
    scan_value: int
    mapping_value: int
    bio_signals: int = 0  # > 0 when the body counts for its biology
    bio_min: int = 0
    bio_max: int = 0
    genuses: tuple[str, ...] = ()  # codex genus symbols confirmed by DSS
    codex: tuple[routebio.CodexChance, ...] = ()  # codex routes: entries not in your codex

    @property
    def carto(self) -> bool:
        return self.kind != "bio"

    def remaining(self, progress: BodyProgress | None, *, low: bool = False) -> int:
        """What is still to earn here: the mapping payout unless mapped, the species not
        analysed yet (optimistic, or pessimistic with `low`)."""
        mapped, species = progress or (False, 0)
        value = self.mapping_value if self.carto and not mapped else 0
        if self.bio_signals > species:
            bio = self.bio_min if low else self.bio_max
            # Analysed species are paid already: count the rest of the estimate.
            value += bio * (self.bio_signals - species) // self.bio_signals
        return value

    def finished(self, progress: BodyProgress | None) -> bool:
        mapped, species = progress or (False, 0)
        return (not self.carto or mapped) and species >= self.bio_signals


@dataclass(slots=True)
class PlanStop:
    address: int
    name: str
    x: float
    y: float
    z: float
    distance: float  # from the start (riches) or from the line (line)
    bodies: dict[int, PlanBody] = field(default_factory=dict)
    hop_ly: float = 0.0
    along: float = 0.0  # line mode: position along the line, 0..1
    region: str | None = None  # codex region symbol (codex routes)
    jumps: int | None = None  # transit: jumps from the previous stop (Spansh)
    neutron: bool = False  # transit: supercharge the FSD at this stop's neutron star
    # Firsts: what Spansh knows of the system, "seen" (only in plotted routes) or "unknown"
    # (nothing: a missing number in its boxel, app.routefirsts)
    discovery: str | None = None
    spread_ly: float = 0.0  # firsts: how far the system may be from x, y, z on each axis

    @property
    def xyz(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.z)


@dataclass(slots=True)
class Plan:
    source: Point
    destination: Point | None
    stops: list[PlanStop]
    truncated: bool  # more systems qualified than the route holds


@dataclass(slots=True)
class PlanRequest:
    mode: Mode
    source: str
    goal: Goal = "credits"
    destination: str | None = None
    radius_ly: float = 200.0
    deviation_ly: float = 25.0
    max_systems: int = 100
    body_types: tuple[str, ...] = DEFAULT_TYPES
    min_value: int = 300_000  # mapping payout per body
    min_system_value: int = 0  # what is still to earn in a system (mapping + biology)
    include_populated: bool = True
    skip_mapped: bool = True  # leave out systems you have finished or sampled species in
    bio_min_value: int = 5_000_000  # biology per body (optimistic estimate); "bio" in types
    bio_min_species_value: int = 0  # a species that may grow on the body is worth at least this
    bio_require_genuses: bool = False  # only bodies whose genera are known (DSS)
    jump_range_ly: float | None = None  # firsts along a line: a full tank's range


class PlanError(Exception):
    """A route cannot be planned. `code` is labelled by the frontend: unknown_system,
    no_destination, spansh_unavailable, no_route (transit), no_jump_range (transit)."""

    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(code if detail is None else f"{code}: {detail}")
        self.code = code
        self.detail = detail


class Search(Protocol):
    def bodies(
        self, filters: dict[str, Any], reference: Reference, page: int
    ) -> dict[str, Any]: ...

    def systems(self, ids: list[int]) -> dict[int, dict[str, Any]]: ...

    def permit_locked(self) -> set[int]: ...


# Your progress on a body (journal): (mapped by you, distinct species you analysed there).
BodyProgress = tuple[bool, int]
# (system addresses) -> your progress per (address, body_id) there
ProgressLookup = Callable[[Iterable[int]], dict[tuple[int, int], BodyProgress]]


# --------------------------------------------------------------------------- queries


@dataclass(slots=True)
class _Group:
    """The search for one body kind."""

    filters: dict[str, Any]
    bio: bool = False  # bodies with biological signals (else one mapping kind)
    next_page: int = 0
    count: int | None = None
    last_distance: float = 0.0

    def exhausted(self, limit: float = math.inf) -> bool:
        """Every body of this kind within `limit` is known."""
        if self.last_distance > limit:
            return True
        return self.count is not None and self.next_page * PAGE_SIZE >= min(self.count, MAX_WINDOW)

    def has_more(self, max_pages: int, limit: float = math.inf) -> bool:
        return self.next_page < max_pages and not self.exhausted(limit)

    def pages_left(self, max_pages: int) -> int:
        total = (
            max_pages if self.count is None else math.ceil(min(self.count, MAX_WINDOW) / PAGE_SIZE)
        )
        return max(0, min(total, max_pages) - self.next_page)


def kind_of(subtype: str | None, state: str | None) -> str | None:
    for kind, (sub, states) in BODY_TYPES.items():
        if sub == subtype and (states is None or state in states):
            return kind
    return None


def _bio_group(max_distance: float) -> _Group:
    """Landable bodies with biological signals (values are estimated here, not by Spansh)."""
    return _Group(
        {
            "signals": [{"comparison": "<=>", "count": [1, 999], "name": "Biological"}],
            "is_landable": {"value": True},
            "distance": {"min": "0", "max": str(max_distance)},
        },
        bio=True,
    )


def _searches(req: PlanRequest, max_distance: float) -> list[_Group]:
    """One search per mapping kind, plus one for biology when "bio" is among the kinds; only
    biology for a codex route."""
    if req.goal == "codex":
        return [_bio_group(max_distance)]
    groups = _groups(req.body_types, max_distance, req.min_value)
    if "bio" in req.body_types:
        groups.append(_bio_group(max_distance))
    return groups


def _groups(kinds: Iterable[str], max_distance: float, min_value: int) -> list[_Group]:
    groups = []
    for kind in dict.fromkeys(kinds):  # unique, in order
        if kind not in BODY_TYPES:
            continue
        subtype, states = BODY_TYPES[kind]
        filters: dict[str, Any] = {
            "subtype": {"value": [subtype]},
            "distance": {"min": "0", "max": str(max_distance)},
        }
        if states is not None:
            filters["terraforming_state"] = {"value": list(states)}
        if min_value > 0:
            # In the query: a threshold above a whole kind (THMC never reach 1M) must not
            # page through thousands of bodies that are all dropped.
            filters["estimated_mapping_value"] = {"comparison": "<=>", "value": [min_value, 10**13]}
        groups.append(_Group(filters))
    return groups


def _num(raw: dict[str, Any], key: str) -> float | None:
    value = raw.get(key)
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


class _Collector:
    """Candidate systems gathered from body pages.

    Permit-locked systems (a short list fetched once) are always left out. Population is
    known only from a per-system check, so it is checked only when populated systems are
    excluded."""

    def __init__(
        self,
        req: PlanRequest,
        search: Search,
        progress: ProgressLookup,
        limit: float,
        codex: CodexIndex | None = None,
    ) -> None:
        self.req = req
        self.codex = codex or {}
        self.search = search
        self.progress_lookup = progress
        self.limit = limit  # bodies farther than this (from the reference) are ignored
        self.check_population = not req.include_populated
        self.stops: dict[int, PlanStop] = {}
        self.system_info: dict[int, dict[str, Any] | None] = {}
        self.permits: set[int] | None = None
        self.progress: dict[tuple[int, int], BodyProgress] = {}
        self.sampled: set[int] = set()  # systems where you have analysed species
        self.looked_up: set[int] = set()
        self.reference: Any = None

    def add_page(self, group: _Group, data: dict[str, Any]) -> None:
        group.count = int(data.get("count") or 0)
        group.next_page += 1
        if self.reference is None:
            self.reference = data.get("reference")
        for raw in data.get("results") or []:
            distance = _num(raw, "distance")
            if distance is not None:
                group.last_distance = max(group.last_distance, distance)
            self._add_body(raw, distance, bio_page=group.bio)

    def _add_body(self, raw: dict[str, Any], distance: float | None, *, bio_page: bool) -> None:
        x, y, z = _num(raw, "system_x"), _num(raw, "system_y"), _num(raw, "system_z")
        if x is None or y is None or z is None or raw.get("id64") is None:
            return
        if distance is not None and distance > self.limit:
            return
        mapping = int(raw.get("estimated_mapping_value") or 0)
        bio = None
        kind: str | None = None
        region: str | None = None
        new: tuple[routebio.CodexChance, ...] = ()
        if bio_page:
            bio = routebio.estimate(raw, self.req.bio_min_species_value)
            if bio is None:
                return
            if self.req.goal == "codex":
                region = regionmap.region_symbol(regionmap.region_at(x, z))
                new = tuple(
                    e for e in bio.entries if codex_status(self.codex, e.key, region) != "logged"
                )
                if sum(e.weight for e in new) < MIN_CODEX_BODY:
                    return
            elif bio.high < self.req.bio_min_value or bio.best < self.req.bio_min_species_value:
                return
            if self.req.bio_require_genuses and not bio.genuses:
                return
        else:
            kind = kind_of(raw.get("subtype"), raw.get("terraforming_state"))
            if kind is None or mapping < self.req.min_value:
                return
        try:
            address = int(raw["system_id64"])
            body_id = int(raw["id64"]) >> 55
        except (KeyError, TypeError, ValueError):
            return
        stop = self.stops.get(address)
        if stop is None:
            stop = PlanStop(
                address=address,
                name=str(raw.get("system_name") or address),
                x=x,
                y=y,
                z=z,
                distance=distance if distance is not None else math.inf,
                region=region,
            )
            self.stops[address] = stop
        # The same body may come from a mapping search and the biology search: merge.
        body = stop.bodies.get(body_id)
        if body is None:
            body = PlanBody(
                body_id=body_id,
                name=str(raw.get("name") or ""),
                kind="bio",
                distance_ls=_num(raw, "distance_to_arrival"),
                scan_value=int(raw.get("estimated_scan_value") or 0),
                mapping_value=mapping,
            )
            stop.bodies[body_id] = body
        if kind is not None:
            body.kind = kind
        if bio is not None:
            body.bio_signals, body.bio_min, body.bio_max = bio.signals, bio.low, bio.high
            body.genuses = bio.genuses
            body.codex = new

    def unchecked(self) -> list[int]:
        if not self.check_population:
            return []
        return [a for a in self.stops if a not in self.system_info]

    def store_systems(self, ids: list[int], info: dict[int, dict[str, Any]]) -> None:
        for address in ids:
            self.system_info[address] = info.get(address)

    def update_progress(self) -> None:
        """Your own progress (local journal data) in the systems seen so far."""
        new = [a for a in self.stops if a not in self.looked_up]
        if new:
            found = self.progress_lookup(new)
            self.progress.update(found)
            self.sampled.update(key[0] for key, (_, species) in found.items() if species > 0)
            self.looked_up.update(new)

    def done(self, stop: PlanStop, body: PlanBody) -> bool:
        return body.finished(self.progress.get((stop.address, body.body_id)))

    def checked(self, stop: PlanStop) -> bool:
        return not self.check_population or stop.address in self.system_info

    def valid(self, stop: PlanStop) -> bool:
        if self.permits is not None and stop.address in self.permits:
            return False
        info = self.system_info.get(stop.address)
        if info is not None and (
            info.get("needs_permit")
            or (self.check_population and (info.get("population") or 0) > 0)
        ):
            return False
        # Systems you have finished, or sampled species in: whatever is left there (what you
        # passed by), a route should not take you back for it.
        if self.req.skip_mapped and (
            stop.address in self.sampled or all(self.done(stop, b) for b in stop.bodies.values())
        ):
            return False
        if self.req.goal == "codex":
            return self.codex_value(stop, {}) >= MIN_CODEX_STOP
        return self.value(stop) >= self.req.min_system_value

    def codex_value(self, stop: PlanStop, covered: dict[tuple[str, str | None], float]) -> float:
        """New codex entries expected at the stop, past what `covered` (the chance each entry
        is logged at an earlier stop) takes already. An entry on several of its bodies counts
        as being on at least one of them."""
        local = dict(covered)
        _add_cover(local, stop, self.done)
        return sum(local.values()) - sum(covered.get(k, 0.0) for k in local)

    def cover(self, stops: Iterable[PlanStop], wanted: int) -> list[PlanStop]:
        """Codex routes: the stops, in this order, that each add enough new entries."""
        covered: dict[tuple[str, str | None], float] = {}
        out: list[PlanStop] = []
        for stop in stops:
            if len(out) >= wanted:
                break
            if self.codex_value(stop, covered) < MIN_CODEX_STOP:
                continue
            out.append(stop)
            _add_cover(covered, stop, self.done)
        return out

    def best(self, stops: list[PlanStop], wanted: int) -> list[PlanStop]:
        """Codex routes: the stops adding the most new entries, one at a time (greedy)."""
        covered: dict[tuple[str, str | None], float] = {}
        left = list(stops)
        out: list[PlanStop] = []
        while left and len(out) < wanted:
            gain, stop = max(
                ((self.codex_value(s, covered), s) for s in left),
                key=lambda gs: (gs[0], -gs[1].distance, -gs[1].address),
            )
            if gain < MIN_CODEX_STOP:
                break
            out.append(stop)
            left.remove(stop)
            _add_cover(covered, stop, self.done)
        return out

    def value(self, stop: PlanStop) -> int:
        """What the system pays: what is still to earn there (everything with skip_mapped
        off), optimistic for biology."""
        if not self.req.skip_mapped:
            return sum(b.remaining(None) for b in stop.bodies.values())
        return sum(
            b.remaining(self.progress.get((stop.address, b.body_id))) for b in stop.bodies.values()
        )

    def valid_stops(self, *, optimistic: bool = False) -> list[PlanStop]:
        """Usable stops, nearest first; `optimistic` also counts the ones not checked yet."""
        return sorted(
            (
                s
                for s in self.stops.values()
                if (self.checked(s) and self.valid(s)) or (optimistic and not self.checked(s))
            ),
            key=lambda s: (s.distance, s.address),
        )


def _add_cover(
    covered: dict[tuple[str, str | None], float],
    stop: PlanStop,
    done: Callable[[PlanStop, PlanBody], bool],
) -> None:
    """Count a stop's entries as covered (by the chance each is there)."""
    for b in stop.bodies.values():
        if done(stop, b):
            continue
        for e in b.codex:
            key = (e.key, stop.region)
            covered[key] = 1.0 - (1.0 - covered.get(key, 0.0)) * (1.0 - e.weight)


def run_parallel(pool: ThreadPoolExecutor, tasks: list[Callable[[], Any]]) -> list[Any]:
    """Runs the tasks in parallel; the first failure is raised as a PlanError."""
    futures = [pool.submit(task) for task in tasks]
    results = []
    for future in futures:
        try:
            results.append(future.result())
        except SpanshRejected as exc:
            raise PlanError("unknown_system") from exc
        except SpanshError as exc:
            raise PlanError("spansh_unavailable", str(exc)) from exc
    return results


def _fetch_round(
    pool: ThreadPoolExecutor, collector: _Collector, reference: Reference, pages: list[_Group]
) -> None:
    """Body pages (one more for each group listed, a group may be listed several times for
    consecutive pages), the permit list (first round) and the population checks due."""
    ids = collector.unchecked()
    tasks: list[Callable[[], Any]] = []
    if collector.permits is None:
        tasks.append(lambda: ("permits", collector.search.permit_locked()))
    planned: dict[int, int] = {}
    for group in pages:
        page = group.next_page + planned.get(id(group), 0)
        planned[id(group)] = planned.get(id(group), 0) + 1
        tasks.append(lambda g=group, p=page: (g, collector.search.bodies(g.filters, reference, p)))
    for start in range(0, len(ids), SYSTEMS_BATCH):
        batch = ids[start : start + SYSTEMS_BATCH]
        tasks.append(lambda b=batch: (b, collector.search.systems(b)))
    for key, data in run_parallel(pool, tasks):
        if isinstance(key, _Group):
            collector.add_page(key, data)
        elif key == "permits":
            collector.permits = data
        else:
            collector.store_systems(key, data)
    collector.update_progress()


def reference_point(raw: Any, fallback_name: str) -> Point | None:
    if not isinstance(raw, dict):
        return None
    x, y, z = _num(raw, "x"), _num(raw, "y"), _num(raw, "z")
    if x is None or y is None or z is None:
        return None
    return Point(str(raw.get("name") or fallback_name), x, y, z)


# --------------------------------------------------------------------------- planning


def plan(
    req: PlanRequest,
    search: Search,
    progress: ProgressLookup,
    source: Point | None = None,
    codex: CodexIndex | None = None,
) -> Plan:
    """Plan a route. `source`: the start's coordinates when known locally (then the search
    does not depend on Spansh knowing the system, e.g. one you just discovered). `codex`:
    your codex entries (codex routes)."""
    if req.mode == "line":
        return _plan_line(req, search, progress, codex)
    return _plan_riches(req, search, progress, source, codex)


def _plan_riches(
    req: PlanRequest,
    search: Search,
    progress: ProgressLookup,
    source: Point | None,
    codex: CodexIndex | None = None,
) -> Plan:
    wanted = max(1, min(req.max_systems, MAX_STOPS))
    radius = max(1.0, min(req.radius_ly, MAX_RADIUS_LY))
    reference: Reference = (
        {"reference_coords": {"x": source.x, "y": source.y, "z": source.z}}
        if source is not None
        else {"reference_system": req.source}
    )
    collector = _Collector(req, search, progress, radius, codex)
    # Always the widest radius in the query: the same cached pages serve any radius.
    groups = _searches(req, MAX_RADIUS_LY)
    max_pages = MAX_WINDOW // PAGE_SIZE
    deadline = time.monotonic() + RICHES_BUDGET_S

    def frontier() -> float:
        # Each search runs nearest first: a system's bodies are all known once every search
        # not finished has gone past its distance.
        return min((g.last_distance for g in groups if not g.exhausted(radius)), default=math.inf)

    with ThreadPoolExecutor(WORKERS) as pool:
        _fetch_round(pool, collector, reference, groups)
        while True:
            # Final once the `wanted` nearest usable systems are all inside the frontier.
            # Systems not checked for population yet count as usable until checked.
            maybe = collector.valid_stops(optimistic=True)
            if req.goal == "codex":
                maybe = collector.cover(maybe, len(maybe))
            edge = frontier()
            sure = sum(1 for s in maybe if s.distance <= edge)
            pending = [g for g in groups if g.has_more(max_pages, radius)]
            if not pending or sure >= wanted or time.monotonic() > deadline:
                if not collector.unchecked():
                    break
                _fetch_round(pool, collector, reference, [])  # population checks only
                continue
            nth = maybe[wanted - 1].distance if len(maybe) >= wanted else math.inf
            due = [g for g in pending if g.last_distance < nth]
            # Pages per search this round, from how many usable systems a page gave so far.
            fetched = sum(g.next_page for g in groups)
            rate = sure / fetched if fetched else 0.0
            if rate > 0:
                need = math.ceil((wanted - sure) / rate / max(1, len(due)))
                per = max(1, min(RICHES_MAX_BATCH, need))
            else:
                per = RICHES_MAX_BATCH
            batch = [g for g in due for _ in range(min(per, g.pages_left(max_pages)))]
            _fetch_round(pool, collector, reference, batch)
    if source is None:
        source = reference_point(collector.reference, req.source)
    if source is None:
        raise PlanError("unknown_system", req.source)
    edge = frontier()
    valid = collector.valid_stops()
    complete = [s for s in valid if s.distance <= edge]
    if req.goal == "codex":
        complete = collector.cover(complete, len(complete))
    stops = order_open_path(source.xyz, complete[:wanted])
    set_hops(source.xyz, stops)
    return Plan(source=source, destination=None, stops=stops, truncated=len(valid) > len(stops))


def _plan_line(
    req: PlanRequest, search: Search, progress: ProgressLookup, codex: CodexIndex | None = None
) -> Plan:
    if not req.destination:
        raise PlanError("no_destination")
    reference: Reference = {
        "reference_route": {"source": req.source, "destination": req.destination}
    }
    deviation = max(1.0, min(req.deviation_ly, 100.0))
    collector = _Collector(req, search, progress, deviation, codex)
    groups = _searches(req, deviation)
    with ThreadPoolExecutor(WORKERS) as pool:
        _fetch_round(pool, collector, reference, groups)
        # The counts are known now: fetch the rest of the corridor in one round.
        rest = []
        for g in groups:
            total = min(g.count or 0, MAX_WINDOW, LINE_MAX_PAGES * PAGE_SIZE)
            rest += [g] * max(0, math.ceil(total / PAGE_SIZE) - g.next_page)
        _fetch_round(pool, collector, reference, rest)
        if collector.unchecked():
            _fetch_round(pool, collector, reference, [])
    ref = collector.reference
    pair = ref if isinstance(ref, list) and len(ref) == 2 else [None, None]
    source = reference_point(pair[0], req.source)
    destination = reference_point(pair[1], req.destination)
    if source is None or destination is None:
        raise PlanError("unknown_system")
    truncated = any((g.count or 0) > LINE_MAX_PAGES * PAGE_SIZE for g in groups)
    valid = collector.valid_stops()
    wanted = max(1, min(req.max_systems, MAX_STOPS))
    if req.goal == "codex":
        best = collector.best(valid, wanted)
        truncated = truncated or len(best) < len(valid)
        valid = best
    elif len(valid) > wanted:
        # A corridor holds far more systems than anyone wants to stop at: the best ones.
        valid = sorted(valid, key=lambda s: (-collector.value(s), s.distance, s.address))[:wanted]
        truncated = True
    axis = [b - a for a, b in zip(source.xyz, destination.xyz, strict=True)]
    length2 = sum(c * c for c in axis) or 1.0
    for s in valid:
        s.along = (
            sum((p - a) * c for p, a, c in zip(s.xyz, source.xyz, axis, strict=True)) / length2
        )
    along = sorted(valid, key=lambda s: (s.along, s.address))
    stops = _order_between(source.xyz, destination.xyz, along)
    set_hops(source.xyz, stops)
    return Plan(source=source, destination=destination, stops=stops, truncated=truncated)


def set_hops(start: tuple[float, float, float], stops: list[PlanStop]) -> None:
    prev = start
    for s in stops:
        s.hop_ly = math.dist(prev, s.xyz)
        prev = s.xyz


# --------------------------------------------------------------------------- ordering


def order_open_path(start: tuple[float, float, float], stops: list[PlanStop]) -> list[PlanStop]:
    """Short open path from `start` through every stop: nearest neighbour, then 2-opt."""
    if len(stops) <= 2:
        return sorted(stops, key=lambda s: math.dist(start, s.xyz))
    pts = [start, *(s.xyz for s in stops)]  # node 0 is the start (fixed)
    left = set(range(1, len(pts)))
    path = [0]
    while left:
        here = pts[path[-1]]
        nxt = min(left, key=lambda i: math.dist(here, pts[i]))
        left.remove(nxt)
        path.append(nxt)
    path = two_opt(pts, path)
    return [stops[i - 1] for i in path[1:]]


def _order_between(
    start: tuple[float, float, float], end: tuple[float, float, float], stops: list[PlanStop]
) -> list[PlanStop]:
    """Stops already in order along the line, untangled by 2-opt with both ends fixed."""
    if len(stops) <= 2:
        return stops
    pts = [start, *(s.xyz for s in stops), end]
    path = two_opt(pts, list(range(len(pts))), fixed_end=True)
    return [stops[i - 1] for i in path[1:-1]]


def path_length(pts: list[tuple[float, float, float]], path: list[int]) -> float:
    return sum(math.dist(pts[a], pts[b]) for a, b in zip(path, path[1:], strict=False))


def two_opt(
    pts: list[tuple[float, float, float]],
    path: list[int],
    neighbours: int = TWO_OPT_NEIGHBOURS,
    budget_s: float = TWO_OPT_BUDGET_S,
    *,
    fixed_end: bool = False,
) -> list[int]:
    """2-opt for an open path with a fixed first node, over each node's nearest neighbours
    (the classic speed-up: an improving move almost always adds an edge to a near node).

    A move reverses path[x+1 .. y]: edges (p[x], p[x+1]) and (p[y], p[y+1]) become
    (p[x], p[y]) and (p[x+1], p[y+1]); past the end of the path the second edge is absent.
    For a node `a` and a near node `c`, the new edge a–c comes either from both nodes'
    successor edges (x, y = their positions) or from both predecessor edges (positions - 1).
    `fixed_end`: the last node stays last (a path to a destination).
    """
    n = len(path)
    if n < 4:
        return path

    def d(u: int, v: int) -> float:
        return math.dist(pts[u], pts[v])

    near = [
        heapq.nsmallest(neighbours, (j for j in range(n) if j != i), key=lambda j, i=i: d(i, j))
        for i in range(n)
    ]
    pos = [0] * n
    for idx, node in enumerate(path):
        pos[node] = idx

    def gain(x: int, y: int) -> float:
        a, b, c = path[x], path[x + 1], path[y]
        if y + 1 < n:
            e = path[y + 1]
            return d(a, b) + d(c, e) - d(a, c) - d(b, e)
        return d(a, b) - d(a, c)

    deadline = time.monotonic() + budget_s
    improved = True
    while improved and time.monotonic() < deadline:
        improved = False
        for a in range(n):
            for c in near[a]:
                i, j = pos[a], pos[c]
                dac = d(a, c)
                succ = i + 1 < n and dac < d(a, path[i + 1])
                pred = i > 0 and dac < d(a, path[i - 1])
                if not succ and not pred:
                    break  # nearer nodes come first: no later c can help
                lo, hi = min(i, j), max(i, j)
                if hi - lo < 2:
                    continue
                for x, y, ok in ((lo, hi, succ), (lo - 1, hi - 1, pred)):
                    if fixed_end and y == n - 1:
                        continue
                    if ok and x >= 0 and gain(x, y) > 1e-9:
                        path[x + 1 : y + 1] = path[x + 1 : y + 1][::-1]
                        for k in range(x + 1, y + 1):
                            pos[path[k]] = k
                        improved = True
                        break
                else:
                    continue
                break  # the path changed: on to the next node
    return path

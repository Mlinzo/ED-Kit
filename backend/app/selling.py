"""Where to sell exploration and organic data: the nearest stations with Universal Cartographics
(exploration data) or Vista Genomics (organic data).

Spansh station searches around you on a worker thread: per service, stations and fleet carriers
apart (carriers outnumber stations: near Sol 3 in 4 of those buying data, near Sag A* the 40
nearest are all carriers, and would crowd stations out). Kept in `sell_search` (the latest
search only) and reused while you stay near the spot it was made for:
within 20 ly, or a tenth of the way to the nearest station they found. Deep in the galaxy the
nearest is thousands of light years away, so one search lasts hundreds of jumps; in the bubble
it is redone every few jumps. Stations you docked at (`docks`) are added, which also works with
`--offline`.

Fleet carriers are shown only on request: they move (Spansh has a carrier where somebody last
reported it: not seen for 30 days, left out; the others show when they were seen) and their owner
decides who may dock. Spansh knows the docking access of about two in three carriers: those
closed to the public (squadron, friends, nobody) are always left out, the rest are marked open
or unknown; the owner can still close it any time. When carriers are hidden, the nearest one
nearer than every station is named as a hint. Each place is checked against the landing pad
your ship needs (app.ships).

The next jump of the route plotted in the game is asked about on its own (its stations, kept 6 h
in memory) and, when it has somewhere to sell, listed first: it is on the way, wherever the
nearest is.
"""

from __future__ import annotations

import json
import logging
import math
import queue
import sqlite3
import threading
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from app import db, spansh
from app.navroute import PlottedRoute, PlottedSystem
from app.schemas import SellCarrierHint, SellPlaceView, SellStationView, SellView
from app.ships import Pad, pad_size, ship_name

log = logging.getLogger(__name__)

CARTOGRAPHICS, GENOMICS = "Universal Cartographics", "Vista Genomics"
STATION_SIZE = 25  # per service; a station carries its market: a gzipped answer is ~0.3 MB
CARRIER_SIZE = 20  # per service
# Spansh station types other than fleet carriers (asked apart, see the module docstring).
STATION_TYPES = [
    "Coriolis Starport",
    "Orbis Starport",
    "Ocellus Starport",
    "Dodec Starport",
    "Asteroid base",
    "Outpost",
    "Planetary Port",
    "Planetary Outpost",
    "Settlement",
    "Mega ship",
]
CARRIER_TYPES = ["Drake-Class Carrier"]
FRESH_FOR = timedelta(hours=6)
RETRY_FAILED_AFTER = timedelta(minutes=10)
REUSE_WITHIN_LY = 20.0
REUSE_SHARE = 0.1  # of the distance to the nearest station found
CARRIER_SEEN_WITHIN = timedelta(days=30)
PLACES = 5
SYSTEM_SIZE = 5  # per service, around the next jump: its own stations come first

Kind = Literal["starport", "outpost", "planetary", "settlement", "megaship", "carrier", "other"]
# Who may dock at a carrier: everybody, not the public (squadron, friends, nobody), or not known.
Access = Literal["all", "restricted", "unknown"]

# Spansh station types and journal StationType values.
KINDS: dict[str, Kind] = {
    "coriolis starport": "starport",
    "orbis starport": "starport",
    "ocellus starport": "starport",
    "dodec starport": "starport",
    "asteroid base": "starport",
    "outpost": "outpost",
    "planetary port": "planetary",
    "planetary outpost": "planetary",
    "settlement": "settlement",
    "mega ship": "megaship",
    "drake-class carrier": "carrier",
    "fleet carrier": "carrier",
    # journal
    "coriolis": "starport",
    "orbis": "starport",
    "ocellus": "starport",
    "bernal": "starport",
    "dodec": "starport",
    "asteroidbase": "starport",
    "craterport": "planetary",
    "crateroutpost": "planetary",
    "surfacestation": "planetary",
    "onfootsettlement": "settlement",
    "megaship": "megaship",
    "fleetcarrier": "carrier",
}

Vec = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class Station:
    name: str
    market_id: int | None
    kind: Kind
    system_name: str
    system_address: int | None
    position: Vec
    dist_ls: float | None
    cartographics: bool
    genomics: bool
    pads: tuple[int, int, int] | None  # small, medium, large; None: unknown
    seen_at: datetime | None  # when Spansh last had it there (a carrier), or you docked
    docked: bool = False  # you docked here
    access: Access | None = None  # carriers only


def kind_of(station_type: str | None) -> Kind:
    return KINDS.get((station_type or "").strip().lower(), "other")


def fits(pads: tuple[int, int, int] | None, pad: Pad | None) -> bool:
    """Whether a ship needing `pad` can land (unknown pads or ship: yes)."""
    if pad is None or pads is None or not any(pads):
        return True
    small, medium, large = pads
    return {"S": small + medium + large, "M": medium + large, "L": large}[pad] > 0


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def access_of(value: Any) -> Access:
    if not value:
        return "unknown"
    return "all" if str(value).strip().lower() == "all" else "restricted"


def _int(value: Any) -> int:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0


def from_spansh(raw: dict[str, Any]) -> Station | None:
    position = (raw.get("system_x"), raw.get("system_y"), raw.get("system_z"))
    if not raw.get("name") or not raw.get("system_name") or None in position:
        return None
    services = set(raw.get("services") or [])
    pads = tuple(_int(raw.get(k)) for k in ("small_pads", "medium_pads", "large_pads"))
    kind = kind_of(raw.get("type"))
    return Station(
        name=str(raw["name"]),
        market_id=raw.get("market_id") if isinstance(raw.get("market_id"), int) else None,
        kind=kind,
        system_name=str(raw["system_name"]),
        system_address=raw.get("system_id64") if isinstance(raw.get("system_id64"), int) else None,
        position=(float(position[0]), float(position[1]), float(position[2])),  # type: ignore[arg-type]
        dist_ls=raw.get("distance_to_arrival"),
        cartographics=CARTOGRAPHICS in services,
        genomics=GENOMICS in services,
        pads=(pads[0], pads[1], pads[2]) if any(pads) else None,
        seen_at=parse_time(raw.get("updated_at")),
        access=access_of(raw.get("carrier_docking_access")) if kind == "carrier" else None,
    )


def journal_stations(conn: sqlite3.Connection, fid: str | None) -> list[Station]:
    """Stations buying data where you docked (the latest docking at each)."""
    out = []
    for r in conn.execute(
        "SELECT d.*, s.name AS system_name, s.x, s.y, s.z FROM docks d "
        "JOIN systems s ON s.address = d.system_address "
        "WHERE d.fid = ? AND (d.uc OR d.vg) AND s.x IS NOT NULL AND d.id IN "
        "(SELECT MAX(id) FROM docks WHERE fid = ? GROUP BY system_address, station)",
        (fid, fid),
    ):
        pads = (r["small_pads"], r["medium_pads"], r["large_pads"])
        out.append(
            Station(
                name=r["station"],
                market_id=r["market_id"],
                kind=kind_of(r["station_type"]),
                system_name=r["system_name"],
                system_address=r["system_address"],
                position=(r["x"], r["y"], r["z"]),
                dist_ls=r["dist_ls"],
                cartographics=bool(r["uc"]),
                genomics=bool(r["vg"]),
                pads=None if None in pads else (pads[0], pads[1], pads[2]),
                seen_at=parse_time(r["ts"]),
                docked=True,
                access="unknown" if kind_of(r["station_type"]) == "carrier" else None,
            )
        )
    return out


def merge(found: Iterable[Station], yours: Iterable[Station]) -> list[Station]:
    """Spansh's stations with the ones you docked at; Spansh's record wins (fresher), marked
    as docked. A station is its market id, or its name in its system."""

    def key(s: Station) -> tuple[Any, ...]:
        return ("m", s.market_id) if s.market_id else ("n", s.system_name.lower(), s.name.lower())

    out: dict[tuple[Any, ...], Station] = {}
    for s in found:
        if key(s) in out:  # in both searches: one record, both services
            have = out[key(s)]
            s = replace(
                have,
                cartographics=have.cartographics or s.cartographics,
                genomics=have.genomics or s.genomics,
            )
        out[key(s)] = s
    for s in yours:
        have = out.get(key(s))
        out[key(s)] = s if have is None else replace(have, docked=True)
    return list(out.values())


def _rank(s: Station) -> tuple[int, int, float]:
    """Better first: not a carrier, buys both kinds of data, nearer the arrival star."""
    both = s.cartographics and s.genomics
    return (s.kind == "carrier", not both, s.dist_ls if s.dist_ls is not None else math.inf)


Place = tuple[float, list[Station], int]  # distance, 1-2 stations shown, other stations there


def pick(
    stations: Iterable[Station],
    here: Vec,
    pad: Pad | None,
    now: datetime,
    limit: int = PLACES,
    carriers: bool = False,
    first: int | None = None,
) -> tuple[list[Place], tuple[float, Station] | None]:
    """The nearest systems where you can sell, and (carriers hidden) the nearest carrier when it
    is nearer than all of them.

    In each system the best station that buys both kinds of data, else the best for each kind.
    The `limit` nearest systems, plus the nearest for each kind when they are farther. The system
    `first` (the next jump), when you can sell there, leads the list (after the one you are in).
    Carriers closed to the public or not seen for 30 days are never used.
    """
    usable: list[Station] = []
    hidden: list[Station] = []
    for s in stations:
        if not (s.cartographics or s.genomics) or not fits(s.pads, pad):
            continue
        if s.kind == "carrier":
            stale = s.seen_at is None or now - s.seen_at > CARRIER_SEEN_WITHIN
            if s.access == "restricted" or stale:
                continue
            if not carriers:
                hidden.append(s)
                continue
        usable.append(s)

    systems: dict[Any, list[Station]] = {}
    for s in usable:
        systems.setdefault(s.system_address or s.system_name.lower(), []).append(s)
    ordered = sorted(systems.values(), key=lambda group: math.dist(here, group[0].position))

    chosen: list[Place] = []
    for group in ordered:
        group.sort(key=_rank)
        both = [s for s in group if s.cartographics and s.genomics]
        if both:
            show = both[:1]
        else:
            show = [
                best
                for best in (
                    next((s for s in group if s.cartographics), None),
                    next((s for s in group if s.genomics), None),
                )
                if best is not None
            ]
        chosen.append((math.dist(here, group[0].position), show, len(group) - len(show)))

    if first is not None:
        at = next((i for i, c in enumerate(chosen) if c[1][0].system_address == first), None)
        if at is not None:
            lead = 1 if at != 0 and chosen[0][0] < 0.5 else 0  # after the system you are in
            chosen.insert(lead, chosen.pop(at))

    top = chosen[:limit]
    for wanted in ("cartographics", "genomics"):
        if not any(getattr(s, wanted) for _, show, _ in top for s in show):
            first = next((c for c in chosen[limit:] if any(getattr(s, wanted) for s in c[1])), None)
            if first is not None:
                top.append(first)

    nearer = min(
        ((math.dist(here, s.position), s) for s in hidden), default=None, key=lambda c: c[0]
    )
    if nearer is not None and top and nearer[0] >= min(c[0] for c in top):
        nearer = None
    return top, nearer


# --------------------------------------------------------------------------- the search


def search(coords: Vec) -> list[dict[str, Any]]:
    """The Spansh searches around `coords` (per service: stations, carriers), in parallel;
    raises spansh.SpanshError."""
    jobs = [
        (service, size, types)
        for service in (CARTOGRAPHICS, GENOMICS)
        for size, types in ((STATION_SIZE, STATION_TYPES), (CARRIER_SIZE, CARRIER_TYPES))
    ]
    with ThreadPoolExecutor(len(jobs)) as pool:
        parts = list(pool.map(lambda job: spansh.stations(job[0], coords, job[1], job[2]), jobs))
    return [station for part in parts for station in part]


def search_system(system: PlottedSystem) -> list[dict[str, Any]]:
    """The stations in one system that buy data: the searches of `search` around it, a few
    places each (nearest first, so its own come first), kept to that system; raises
    spansh.SpanshError."""
    coords = (system.x, system.y, system.z)
    jobs = [
        (service, types)
        for service in (CARTOGRAPHICS, GENOMICS)
        for types in (STATION_TYPES, CARRIER_TYPES)
    ]
    with ThreadPoolExecutor(len(jobs)) as pool:
        parts = list(
            pool.map(lambda job: spansh.stations(job[0], coords, SYSTEM_SIZE, job[1]), jobs)
        )
    return [s for part in parts for s in part if s.get("system_id64") == system.address]


def next_jump(route: PlottedRoute | None, here: int | None) -> PlottedSystem | None:
    """The next system of the route plotted in the game, from where you are (None: no route,
    its end, or off it)."""
    if route is None or here is None:
        return None
    systems = route.systems
    at = next((i for i in range(len(systems) - 1, -1, -1) if systems[i].address == here), None)
    return systems[at + 1] if at is not None and at + 1 < len(systems) else None


def cached(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM sell_search WHERE id = 1").fetchone()


def covers(row: sqlite3.Row | None, here: Vec, now: datetime) -> bool:
    """Whether the stored search still answers for `here` (see the module docstring)."""
    if row is None:
        return False
    age = now - datetime.fromisoformat(row["fetched_at"])
    if not row["ok"]:
        return age < RETRY_FAILED_AFTER
    if age > FRESH_FOR:
        return False
    origin = (row["x"], row["y"], row["z"])
    stations = [s for s in map(from_spansh, json.loads(row["stations"])) if s is not None]
    nearest = min((math.dist(origin, s.position) for s in stations), default=0.0)
    return math.dist(origin, here) <= max(REUSE_WITHIN_LY, REUSE_SHARE * nearest)


class SellFinder:
    """Runs the station searches on a worker thread, one at a time; calls `on_change` when one
    is stored. The searches around you go to `sell_search`; those of single systems (the next
    jump) stay in memory."""

    def __init__(
        self,
        db_path: Path,
        on_change: Callable[[], None],
        find: Callable[[Vec], list[dict[str, Any]]] = search,
        find_system: Callable[[PlottedSystem], list[dict[str, Any]]] = search_system,
    ) -> None:
        self.db_path = db_path
        self.on_change = on_change
        self.find = find
        self.find_system = find_system
        self._queue: queue.Queue[Vec | PlottedSystem] = queue.Queue()
        self._lock = threading.Lock()
        self._busy = False
        # By system address: when it was asked about, and its stations (None: Spansh failed).
        self._systems: dict[int, tuple[datetime, list[dict[str, Any]] | None]] = {}
        self._asking: set[int] = set()
        self._thread = threading.Thread(target=self._run, name="selling", daemon=True)
        self._thread.start()

    @property
    def busy(self) -> bool:
        with self._lock:
            return self._busy

    def request(self, conn: sqlite3.Connection, here: Vec) -> None:
        """Search around `here` unless the stored search still covers it."""
        if covers(cached(conn), here, datetime.now(UTC)):
            return
        with self._lock:
            if self._busy:
                return  # asked again when this one is stored (on_change -> the view)
            self._busy = True
        self._queue.put(here)

    def request_system(self, system: PlottedSystem) -> None:
        """Ask about the stations of one system unless that was done lately."""
        now = datetime.now(UTC)
        with self._lock:
            known = self._systems.get(system.address)
            if known is not None:
                within = FRESH_FOR if known[1] is not None else RETRY_FAILED_AFTER
                if now - known[0] < within:
                    return
            if system.address in self._asking:
                return
            self._asking.add(system.address)
        self._queue.put(system)

    def system_stations(self, address: int) -> list[dict[str, Any]]:
        """What the last search of that system found (none yet, or it failed: nothing)."""
        with self._lock:
            known = self._systems.get(address)
        return (known[1] or []) if known is not None else []

    def _run(self) -> None:
        while True:
            job = self._queue.get()
            try:
                if isinstance(job, PlottedSystem):
                    self._search_system(job)
                else:
                    self._search(job)
            except Exception:  # noqa: BLE001 - never kill the worker
                log.exception("sell search failed")
            finally:
                with self._lock:
                    if isinstance(job, PlottedSystem):
                        self._asking.discard(job.address)
                    else:
                        self._busy = False
                self.on_change()

    def _search_system(self, system: PlottedSystem) -> None:
        found: list[dict[str, Any]] | None
        try:
            found = self.find_system(system)
        except spansh.SpanshError as exc:
            log.info("sell search in %s failed: %s", system.name, exc)
            found = None
        now = datetime.now(UTC)
        with self._lock:
            self._systems = {a: v for a, v in self._systems.items() if now - v[0] < FRESH_FOR}
            self._systems[system.address] = (now, found)

    def _search(self, here: Vec) -> None:
        ok, stations = True, []
        try:
            stations = self.find(here)
        except spansh.SpanshError as exc:
            log.info("sell search failed: %s", exc)
            ok = False
        conn = db.connect(self.db_path)
        try:
            conn.execute(
                "INSERT OR REPLACE INTO sell_search(id, fetched_at, x, y, z, ok, stations) "
                "VALUES(1, ?, ?, ?, ?, ?, ?)",
                (
                    datetime.now(UTC).isoformat(timespec="seconds"),
                    *here,
                    int(ok),
                    json.dumps(stations),
                ),
            )
        finally:
            conn.close()


# --------------------------------------------------------------------------- the view


def sell_view(
    conn: sqlite3.Connection,
    fid: str | None,
    state: sqlite3.Row | None,
    finder: SellFinder | None,
    carriers: bool = False,
    plotted: PlottedRoute | None = None,
) -> SellView:
    ship = state["ship_type"] if state else None
    pad = pad_size(ship)
    jump_range = state["jump_range"] if state else None
    here_row = (
        conn.execute(
            "SELECT x, y, z FROM systems WHERE address = ?", (state["system_address"],)
        ).fetchone()
        if state and state["system_address"] is not None
        else None
    )
    base = SellView(
        state="offline" if finder is None else "ready",
        ship=ship_name(ship),
        pad=pad,
        places=[],
        searched_at=None,
        here_carto_bodies=0,
        carriers=carriers,
        nearer_carrier=None,
    )
    if here_row is None or here_row["x"] is None:
        return base.model_copy(update={"state": "unknown_position"})
    here = (here_row["x"], here_row["y"], here_row["z"])
    local = conn.execute(
        "SELECT COUNT(*) FROM body_cmdr WHERE fid = ? AND system_address = ? AND carto = 'unsold'",
        (fid, state["system_address"]),
    ).fetchone()[0]
    base = base.model_copy(update={"here_carto_bodies": local})

    found: list[Station] = []
    if finder is not None:
        finder.request(conn, here)
        row = cached(conn)
        if row is not None and row["ok"]:
            found = [s for s in map(from_spansh, json.loads(row["stations"])) if s is not None]
            base = base.model_copy(update={"searched_at": row["fetched_at"]})
        if finder.busy:
            base = base.model_copy(update={"state": "pending"})
        elif row is None or not row["ok"]:
            base = base.model_copy(update={"state": "failed"})

    upcoming = next_jump(plotted, state["system_address"])
    if finder is not None and upcoming is not None:
        finder.request_system(upcoming)
        found += [s for s in map(from_spansh, finder.system_stations(upcoming.address)) if s]

    stations = merge(found, journal_stations(conn, fid))
    first = upcoming.address if upcoming is not None else None
    picked, nearer = pick(stations, here, pad, datetime.now(UTC), carriers=carriers, first=first)
    places = [
        SellPlaceView(
            system_name=show[0].system_name,
            system_address=str(show[0].system_address) if show[0].system_address else None,
            distance_ly=round(distance, 1),
            jumps=jumps_to(distance, jump_range),
            stations=[_station_view(s) for s in show],
            more=more,
            next_jump=first is not None and show[0].system_address == first,
        )
        for distance, show, more in picked
    ]
    hint = (
        SellCarrierHint(
            name=nearer[1].name,
            system_name=nearer[1].system_name,
            distance_ly=round(nearer[0], 1),
            jumps=jumps_to(nearer[0], jump_range),
        )
        if nearer is not None
        else None
    )
    return base.model_copy(update={"places": places, "nearer_carrier": hint})


def jumps_to(distance: float, jump_range: float | None) -> int | None:
    if not jump_range or jump_range <= 0:
        return None
    return max(1, math.ceil(distance / jump_range)) if distance >= 0.5 else 0


def _station_view(s: Station) -> SellStationView:
    return SellStationView(
        name=s.name,
        kind=s.kind,
        dist_ls=round(s.dist_ls) if s.dist_ls is not None else None,
        cartographics=s.cartographics,
        genomics=s.genomics,
        seen_at=(
            s.seen_at.isoformat(timespec="seconds").replace("+00:00", "Z")
            if s.kind == "carrier" and s.seen_at
            else None
        ),
        docked=s.docked,
        access=s.access if s.access != "restricted" else None,
    )

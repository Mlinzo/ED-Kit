"""The Shop tab: the nearest shipyards and outfitting, and the nearest stations selling a ship
or a module.

Spansh's station search knows a station's shipyard and outfitting as the last player who docked
there with an EDDN uploader (EDMC, EDDiscovery...) reported them, so the date of that report
is shown: it can be months old. Stations and fleet carriers are asked apart, as for selling
data (app.selling: carriers move and their owner decides who may dock, so they are shown only
on request, the nearest one named when it is nearer than every station). Spansh's module filter
knows the name, class and rating but ignores the mount, so each station is checked for the
exact item (its journal symbol) here. Before anything is chosen, the tab lists the stations
with a shipyard or outfitting, with how many ships and modules Spansh knows they sell. An
answer is kept in memory and reused for an hour while you stay within 20 ly of where it was
asked.

What else stands in the way is told, not filtered: the navy rank a ship needs (from the
journal's Rank and Promotion events), a module unlocked first (Powerplay, a technology broker:
stations list it only to commanders who have it), a system that needs a permit (Spansh's list,
kept by the route planner). Places where your ship cannot land are left out (app.ships).

The catalog (app/data/shop.json) is built by tools/shop_catalog.py from EDCD FDevIDs.
"""

from __future__ import annotations

import gzip
import json
import math
import sqlite3
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any, Literal

from app import spansh
from app.schemas import (
    SellCarrierHint,
    ShopCatalogView,
    ShopModuleView,
    ShopPlaceView,
    ShopRankNeed,
    ShopRankView,
    ShopShipStats,
    ShopShipView,
    ShopStationView,
    ShopVariantView,
    ShopView,
)
from app.selling import (
    CARRIER_SEEN_WITHIN,
    CARRIER_TYPES,
    STATION_TYPES,
    access_of,
    fits,
    jumps_to,
    kind_of,
    parse_time,
)
from app.ships import Pad, pad_size, ship_name

DATA = Path(__file__).parent / "data" / "shop.json"
STATION_SIZE = 40  # a station carries its market: ~10 KB gzipped each
CARRIER_SIZE = 20
FRESH_FOR = timedelta(hours=1)
REUSE_WITHIN_LY = 20.0
KEEP_ANSWERS = 50
PLACES = 10
STATIONS_PER_PLACE = 3
SHOP_SERVICES = ["Shipyard", "Outfitting"]  # Spansh's names; several values: either

Navy = Literal["empire", "federation"]
# The navy rank a ship needs (Elite Dangerous Wiki, Empire/Ranks and Federation/Ranks, checked
# 2026-10-21): journal ship symbol -> navy, rank number as in the journal's Rank event.
RANKS: dict[str, tuple[Navy, int]] = {
    "empire_courier": ("empire", 3),
    "empire_trader": ("empire", 7),
    "cutter": ("empire", 12),
    "federation_dropship": ("federation", 3),
    "federation_dropship_mkii": ("federation", 5),
    "federation_gunship": ("federation", 7),
    "federation_corvette": ("federation", 12),
}
RANK_NAMES: dict[Navy, list[str]] = {
    "empire": [
        "None",
        "Outsider",
        "Serf",
        "Master",
        "Squire",
        "Knight",
        "Lord",
        "Baron",
        "Viscount",
        "Count",
        "Earl",
        "Marquis",
        "Duke",
        "Prince",
        "King",
    ],  # fmt: skip
    "federation": [
        "None",
        "Recruit",
        "Cadet",
        "Midshipman",
        "Petty Officer",
        "Chief Petty Officer",
        "Warrant Officer",
        "Ensign",
        "Lieutenant",
        "Lieutenant Commander",
        "Post Commander",
        "Post Captain",
        "Rear Admiral",
        "Vice Admiral",
        "Admiral",
    ],  # fmt: skip
}
NAVY_KEYS: dict[Navy, str] = {"empire": "Empire", "federation": "Federation"}

Vec = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class Item:
    kind: Literal["ship", "module"]
    symbol: str  # journal symbol, lower case
    name: str
    size: int | None = None
    rating: str | None = None
    mount: str | None = None
    guidance: str | None = None
    unlock: str | None = None

    def label(self) -> str:
        """ "Anaconda", "Frame Shift Drive 5A", "Multi-Cannon 2E Gimballed"."""
        if self.kind == "ship":
            return self.name
        extra = " ".join(x for x in (self.mount, self.guidance) if x)
        return f"{self.name} {self.size}{self.rating}" + (f" {extra}" if extra else "")


@cache
def _catalog() -> dict[str, Any]:
    return json.loads(DATA.read_text(encoding="utf-8"))


@cache
def _items() -> dict[str, Item]:
    data = _catalog()
    items = {s["symbol"]: Item("ship", s["symbol"], s["name"]) for s in data["ships"]}
    for m in data["modules"]:
        for v in m["variants"]:
            items[v["symbol"]] = Item(
                "module",
                v["symbol"],
                m["name"],
                v["class"],
                v["rating"],
                v["mount"],
                v["guidance"],
                m["unlock"],
            )
    return items


def find(symbol: str) -> Item | None:
    return _items().get(symbol.lower())


def _rank_need(symbol: str) -> ShopRankNeed | None:
    need = RANKS.get(symbol)
    return ShopRankNeed(navy=need[0], need=RANK_NAMES[need[0]][need[1]]) if need else None


def catalog_view() -> ShopCatalogView:
    data = _catalog()
    return ShopCatalogView(
        ships=[
            ShopShipView(
                symbol=s["symbol"],
                name=s["name"],
                stats=ShopShipStats(**s["stats"]) if "stats" in s else None,
                rank=_rank_need(s["symbol"]),
                unsold=s.get("unsold", False),
            )
            for s in data["ships"]
        ],
        modules=[
            ShopModuleView(
                name=m["name"],
                category=m["category"],
                type=m.get("type"),
                unlock=m["unlock"],
                variants=[
                    ShopVariantView(
                        symbol=v["symbol"],
                        size=v["class"],
                        rating=v["rating"],
                        mount=v["mount"],
                        guidance=v["guidance"],
                        price=v.get("price"),
                        mass=v.get("mass"),
                        power=v.get("power"),
                        integrity=v.get("integrity"),
                        stats=v.get("stats") or {},
                    )
                    for v in m["variants"]
                ],
            )
            for m in data["modules"]
        ],
    )


@cache
def catalog_json() -> tuple[bytes, bytes]:
    """The catalog as JSON, plain and gzipped (~200 KB / ~25 KB): it changes only with the app."""
    raw = catalog_view().model_dump_json(by_alias=True).encode("utf-8")
    return raw, gzip.compress(raw, 6)


# --------------------------------------------------------------------------- the search


def _filters(item: Item) -> dict[str, Any]:
    if item.kind == "ship":
        return {"ships": [{"name": {"value": [item.name]}}]}
    return {
        "modules": [
            {
                "name": {"value": [item.name]},
                "class": {"value": [str(item.size)]},
                "rating": {"value": [item.rating]},
            }
        ]
    }


def offer(raw: dict[str, Any], item: Item) -> dict[str, Any] | None:
    """The station's fields with its price for `item`, or None when it lacks that exact item."""
    ship = item.kind == "ship"
    key = "symbol" if ship else "ed_symbol"
    match = next(
        (
            e
            for e in raw.get("ships" if ship else "modules") or []
            if isinstance(e, dict) and str(e.get(key) or "").lower() == item.symbol
        ),
        None,
    )
    if match is None:
        return None
    offer_at = raw.get("shipyard_updated_at" if ship else "outfitting_updated_at")
    return {k: raw.get(k) for k in spansh.STATION_FIELDS} | {
        "price": match.get("price"),
        "offer_at": offer_at or raw.get("updated_at"),
    }


def shop(raw: dict[str, Any]) -> dict[str, Any] | None:
    """A station with a shipyard or outfitting: its fields and how many ships and modules Spansh
    knows it sells (None: no such service; 0: the service, but no list)."""
    services = {s.get("name") for s in raw.get("services") or [] if isinstance(s, dict)}
    yard, outfitting = "Shipyard" in services, "Outfitting" in services
    if not (yard or outfitting):
        return None
    dates = [
        d
        for d in (raw.get("shipyard_updated_at"), raw.get("outfitting_updated_at"))
        if isinstance(d, str) and d
    ]
    return {k: raw.get(k) for k in spansh.STATION_FIELDS} | {
        "ship_count": len(raw.get("ships") or []) if yard else None,
        "module_count": len(raw.get("modules") or []) if outfitting else None,
        "offer_at": max(dates, default=None),
    }


def search(item: Item | None, coords: Vec) -> list[dict[str, Any]]:
    """Stations and carriers selling `item` (None: with a shipyard or outfitting) near
    `coords`, asked in parallel; raises spansh.SpanshError."""
    filters = _filters(item) if item else {"services": [{"name": {"value": SHOP_SERVICES}}]}
    jobs = ((STATION_SIZE, STATION_TYPES), (CARRIER_SIZE, CARRIER_TYPES))
    with ThreadPoolExecutor(len(jobs)) as pool:
        parts = list(
            pool.map(lambda job: spansh.station_search(filters, coords, job[0], job[1]), jobs)
        )
    keep: Callable[[dict[str, Any]], dict[str, Any] | None] = (
        (lambda raw: offer(raw, item)) if item else shop
    )
    return [o for part in parts for raw in part if (o := keep(raw)) is not None]


def _permit_locked(db_path: Path) -> set[int]:
    cached = spansh.CachedSearch(db_path)
    try:
        return cached.permit_locked()
    finally:
        cached.close()


class ShopFinder:
    """Spansh's answers per item, kept in memory (see the module docstring); thread-safe, one
    search per item at a time."""

    def __init__(
        self,
        db_path: Path | None,
        find: Callable[[Item | None, Vec], list[dict[str, Any]]] = search,
        permits: Callable[[], set[int]] | None = None,
    ) -> None:
        self._find = find
        self._permits = permits or (lambda: _permit_locked(db_path) if db_path else set())
        self._lock = threading.Lock()
        self._item_locks: dict[str, threading.Lock] = {}
        self._answers: dict[str, tuple[datetime, Vec, list[dict[str, Any]]]] = {}
        self._permit_ids: set[int] | None = None

    def stations(self, item: Item | None, here: Vec) -> tuple[list[dict[str, Any]], datetime]:
        """The offers for `item` (None: the shops) and when Spansh was asked; raises
        spansh.SpanshError."""
        key = item.symbol if item else ""
        with self._lock:
            item_lock = self._item_locks.setdefault(key, threading.Lock())
        with item_lock:
            now = datetime.now(UTC)
            kept = self._answers.get(key)
            if kept and now - kept[0] <= FRESH_FOR and math.dist(kept[1], here) <= REUSE_WITHIN_LY:
                return kept[2], kept[0]
            found = self._find(item, here)
            with self._lock:
                self._answers[key] = (now, here, found)
                while len(self._answers) > KEEP_ANSWERS:
                    oldest = min(self._answers, key=lambda k: self._answers[k][0])
                    del self._answers[oldest]
            return found, now

    def permit_locked(self) -> set[int]:
        """Systems that need a permit (empty when Spansh cannot be asked)."""
        if self._permit_ids is None:
            try:
                self._permit_ids = self._permits()
            except spansh.SpanshError:
                return set()
        return self._permit_ids


def _pads(o: dict[str, Any]) -> tuple[int, int, int] | None:
    pads = tuple(int(o.get(k) or 0) for k in ("small_pads", "medium_pads", "large_pads"))
    return (pads[0], pads[1], pads[2]) if any(pads) else None


def _position(o: dict[str, Any]) -> Vec | None:
    x, y, z = (o.get(k) for k in ("system_x", "system_y", "system_z"))
    if not all(isinstance(v, int | float) for v in (x, y, z)):
        return None
    return (float(x), float(y), float(z))  # type: ignore[arg-type]


Place = tuple[float, list[dict[str, Any]], int]  # distance, stations shown, others there


def pick(
    offers: list[dict[str, Any]],
    here: Vec,
    pad: Pad | None,
    now: datetime,
    carriers: bool = False,
    limit: int = PLACES,
) -> tuple[list[Place], tuple[float, dict[str, Any]] | None]:
    """The nearest systems selling it (stations where your ship can land, the best first), and
    (carriers hidden) the nearest carrier when it is nearer than all of them. Carriers closed
    to the public or not seen for 30 days are never used."""
    usable: list[tuple[float, dict[str, Any]]] = []
    hidden: list[tuple[float, dict[str, Any]]] = []
    for o in offers:
        position = _position(o)
        if position is None or not o.get("name") or not fits(_pads(o), pad):
            continue
        distance = math.dist(here, position)
        if kind_of(o.get("type")) == "carrier":
            seen = parse_time(o.get("updated_at"))
            stale = seen is None or now - seen > CARRIER_SEEN_WITHIN
            if access_of(o.get("carrier_docking_access")) == "restricted" or stale:
                continue
            if not carriers:
                hidden.append((distance, o))
                continue
        usable.append((distance, o))

    systems: dict[Any, list[tuple[float, dict[str, Any]]]] = {}
    for distance, o in usable:
        systems.setdefault(o.get("system_id64") or o.get("system_name"), []).append((distance, o))

    def rank(entry: tuple[float, dict[str, Any]]) -> tuple[bool, float]:
        o = entry[1]
        ls = o.get("distance_to_arrival")
        return (
            kind_of(o.get("type")) == "carrier",
            ls if isinstance(ls, int | float) else math.inf,
        )

    places: list[Place] = []
    for group in sorted(systems.values(), key=lambda g: g[0][0])[:limit]:
        group.sort(key=rank)
        shown = [o for _, o in group[:STATIONS_PER_PLACE]]
        places.append((group[0][0], shown, len(group) - len(shown)))

    nearer = min(hidden, default=None, key=lambda c: c[0])
    if nearer is not None and places and nearer[0] >= places[0][0]:
        nearer = None
    return places, nearer


# --------------------------------------------------------------------------- the view


def ranks(conn: sqlite3.Connection) -> dict[Navy, int]:
    """Navy ranks from the journal: the latest Rank event and the promotions after it."""
    have: dict[Navy, int] = {}
    for (raw,) in conn.execute(
        "SELECT raw FROM events WHERE event IN ('Rank', 'Promotion') ORDER BY id DESC LIMIT 100"
    ):
        ev = json.loads(raw)
        for navy, key in NAVY_KEYS.items():
            if navy not in have and isinstance(ev.get(key), int):
                have[navy] = ev[key]
        if ev.get("event") == "Rank":
            break
    return have


def _rank_view(conn: sqlite3.Connection, item: Item) -> ShopRankView | None:
    need = RANKS.get(item.symbol) if item.kind == "ship" else None
    if need is None:
        return None
    navy, rank = need
    names = RANK_NAMES[navy]
    have = ranks(conn).get(navy)
    return ShopRankView(
        navy=navy,
        need=names[rank],
        have=names[have] if have is not None and 0 <= have < len(names) else None,
        ok=None if have is None else have >= rank,
    )


def _station_view(o: dict[str, Any], permits: set[int]) -> ShopStationView:
    kind = kind_of(o.get("type"))
    ls = o.get("distance_to_arrival")
    price = o.get("price")
    access = access_of(o.get("carrier_docking_access")) if kind == "carrier" else None
    return ShopStationView(
        name=str(o["name"]),
        kind=kind,
        dist_ls=round(ls) if isinstance(ls, int | float) else None,
        price=price if isinstance(price, int) and price > 0 else None,
        offer_at=o.get("offer_at") if isinstance(o.get("offer_at"), str) else None,
        access=access if access != "restricted" else None,
        permit=o.get("system_id64") in permits,
        ship_count=o.get("ship_count"),
        module_count=o.get("module_count"),
    )


def shop_view(
    conn: sqlite3.Connection,
    state: sqlite3.Row | None,
    finder: ShopFinder | None,
    symbol: str | None,
    carriers: bool = False,
) -> ShopView:
    ship = state["ship_type"] if state else None
    pad = pad_size(ship)
    jump_range = state["jump_range"] if state else None
    view = ShopView(
        state="ready",
        item=None,
        ship=ship_name(ship),
        pad=pad,
        carriers=carriers,
        places=[],
        nearer_carrier=None,
        rank=None,
        unlock=None,
        searched_at=None,
    )
    item = find(symbol) if symbol else None
    if symbol and item is None:
        return view.model_copy(update={"state": "unknown_item"})
    if item is not None:
        view = view.model_copy(
            update={"item": item.label(), "unlock": item.unlock, "rank": _rank_view(conn, item)}
        )
    if finder is None:
        return view.model_copy(update={"state": "offline"})
    here_row = (
        conn.execute(
            "SELECT x, y, z FROM systems WHERE address = ?", (state["system_address"],)
        ).fetchone()
        if state and state["system_address"] is not None
        else None
    )
    if here_row is None or here_row["x"] is None:
        return view.model_copy(update={"state": "unknown_position"})
    here = (here_row["x"], here_row["y"], here_row["z"])
    try:
        found, asked_at = finder.stations(item, here)
    except spansh.SpanshError:
        return view.model_copy(update={"state": "failed"})

    places, nearer = pick(found, here, pad, datetime.now(UTC), carriers)
    permits = finder.permit_locked() if places else set()
    return view.model_copy(
        update={
            "searched_at": asked_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "places": [
                ShopPlaceView(
                    system_name=str(shown[0].get("system_name")),
                    system_address=(
                        str(shown[0]["system_id64"]) if shown[0].get("system_id64") else None
                    ),
                    distance_ly=round(distance, 1),
                    jumps=jumps_to(distance, jump_range),
                    stations=[_station_view(o, permits) for o in shown],
                    more=more,
                )
                for distance, shown, more in places
            ],
            "nearer_carrier": (
                SellCarrierHint(
                    name=str(nearer[1]["name"]),
                    system_name=str(nearer[1].get("system_name")),
                    distance_ly=round(nearer[0], 1),
                    jumps=jumps_to(nearer[0], jump_range),
                )
                if nearer is not None
                else None
            ),
        }
    )

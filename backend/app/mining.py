"""The Mining tab: for a commodity worth mining, the rings near you with its hotspots and the
markets paying the most for it, from Spansh.

Terms:
- hotspot: a ring's signal for one commodity (the game shows it once the ring is scanned; Spansh
  has it from EDDN): its asteroids hold far more of that commodity. A ring with two or three of
  one kind ("x2") may have them overlap, which miners look for, but where they lie in the ring
  is not in the data, so only the count is told.
- reserve: how much a body's rings still hold (Pristine, Major, Common, Low, Depleted).
- buyer: a market with demand for the commodity; its price is what it pays a tonne (Spansh's
  `sell_price`) and its demand the tonnes it wants, both as of the market's latest report.
- trip: from you to a ring, then on to the buyer nearest to that ring.

Buyers are the markets paying the most within `REACH_LY` of you (the best price first, then the
nearest: most of the bubble pays one floor price, so the nearest of those come next). Your ship
for large pads asks for stations with one; places where it cannot land are left out as in the
Shop (app.shop.usable), and fleet carriers are listed only on request. Carriers often pay far
more (buy orders of their owners), so while they are hidden the best one is named when it pays
more than every station listed. Osmium has no hotspots (none in Spansh on 2026-10-27): only its
buyers are asked for. Answers are kept by the Shop's finder: an hour, within 20 ly.

Filters (`RingFilters`, `BuyerFilters`): rings of bodies with chosen reserves or near the
arrival star; markets wanting at least some tonnes, reported lately, or near the star. Spansh
applies them, so they reach past the first answers; it ignores a filter it does not know
without a word (a distance as `{min, max}`, a ring type: checked 2026-10-27), so its answer is
held against them here too.
"""

from __future__ import annotations

import math
import sqlite3
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from app import spansh
from app.schemas import (
    MiningBuyerView,
    MiningCommodityView,
    MiningRingView,
    MiningSellView,
    MiningSignalView,
    MiningTripView,
    MiningView,
)
from app.selling import (
    CARRIER_TYPES,
    STATION_TYPES,
    access_of,
    jumps_to,
    kind_of,
    parse_time,
    pledged_power,
)
from app.ships import latest_loadout, pad_size, ship_name
from app.shop import Item, Near, ShopFinder, Vec, here_of, pads_of, position_of, usable
from app.shop import find as find_item

# Journal symbols, in the tab's order. All but Osmium can have hotspots in a ring; Spansh names
# the hotspots as the market names the commodity ("Low Temperature Diamonds", "Void Opal").
HOTSPOTS = (
    "platinum",
    "painite",
    "lowtemperaturediamond",
    "opal",
    "alexandrite",
    "benitoite",
    "grandidierite",
    "monazite",
    "musgravite",
    "rhodplumsite",
    "serendibite",
    "bromellite",
    "tritium",
)
MINED = (*HOTSPOTS[:4], "osmium", *HOTSPOTS[4:])
REACH_LY = 500.0
STATION_SIZE = 40
CARRIER_SIZE = 20
BUYERS = 25  # listed
RING_BODIES = 30  # asked for (a body can have two rings)
RINGS = 20  # listed
RING_FIELDS = (
    "name",
    "system_name",
    "system_id64",
    "system_x",
    "system_y",
    "system_z",
    "distance_to_arrival",
    "reserve_level",
    "rings",
)


def find(symbol: str) -> Item | None:
    """A commodity the tab offers (None for anything else, mined or not)."""
    return find_item(symbol) if symbol.lower() in MINED else None


def commodities() -> list[MiningCommodityView]:
    return [
        MiningCommodityView(symbol=s, name=item.name, hotspots=s in HOTSPOTS)
        for s in MINED
        if (item := find_item(s)) is not None
    ]


# --------------------------------------------------------------------------- the filters

Reserve = Literal["Pristine", "Major", "Common", "Low", "Depleted"]
RESERVES: tuple[Reserve, ...] = ("Pristine", "Major", "Common", "Low", "Depleted")  # most first


def parse_reserves(text: str | None) -> frozenset[Reserve]:
    """Reserves from a query ("Pristine,Major"; none: any); raises ValueError on an unknown one."""
    names = [n.strip() for n in (text or "").split(",") if n.strip()]
    unknown = [n for n in names if n not in RESERVES]
    if unknown:
        raise ValueError(f"unknown reserves: {', '.join(unknown)}")
    return frozenset(r for r in RESERVES if r in names)


def _upto(top: int) -> dict[str, Any]:
    """Spansh's form of a number range from 0 (`{min, max}` it ignores but for `distance`)."""
    return {"value": [0, top], "comparison": "<=>"}


def _near_star(o: dict[str, Any], max_ls: int | None) -> bool:
    ls = o.get("distance_to_arrival")
    return max_ls is None or (isinstance(ls, int | float) and ls <= max_ls)


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class RingFilters:
    """The rings wanted: on bodies with these reserves (none: any), within `max_ls` of the
    arrival star."""

    reserves: frozenset[Reserve] = frozenset()
    max_ls: int | None = None

    def key(self) -> str:
        return f"{'+'.join(r for r in RESERVES if r in self.reserves)}/{self.max_ls}"

    def spansh(self) -> dict[str, Any]:
        found: dict[str, Any] = {}
        if self.reserves:
            found["reserve_level"] = {"value": [r for r in RESERVES if r in self.reserves]}
        if self.max_ls is not None:
            found["distance_to_arrival"] = _upto(self.max_ls)
        return found

    def admits(self, body: dict[str, Any]) -> bool:
        if self.reserves and body.get("reserve_level") not in self.reserves:
            return False
        return _near_star(body, self.max_ls)


@dataclass(frozen=True, slots=True)
class BuyerFilters:
    """The markets wanted: wanting at least `min_demand` tonnes, reported within `max_age_days`,
    within `max_ls` of the arrival star."""

    min_demand: int = 1
    max_age_days: int | None = None
    max_ls: int | None = None

    def key(self) -> str:
        return f"{self.min_demand}/{self.max_age_days}/{self.max_ls}"

    def spansh(self, name: str, now: datetime) -> dict[str, Any]:
        demand = {"value": [self.min_demand, 10**9], "comparison": "<=>"}
        found: dict[str, Any] = {"market": [{"name": name, "demand": demand}]}
        if self.max_age_days is not None:
            since, until = now - timedelta(days=self.max_age_days), now + timedelta(days=1)
            found["market_updated_at"] = {"value": [_iso(since), _iso(until)], "comparison": "<=>"}
        if self.max_ls is not None:
            found["distance_to_arrival"] = _upto(self.max_ls)
        return found

    def admits(self, offer: dict[str, Any], now: datetime) -> bool:
        if offer["demand"] < self.min_demand:
            return False
        if self.max_age_days is not None:
            at = parse_time(offer.get("offer_at"))
            if at is None or now - at > timedelta(days=self.max_age_days):
                return False
        return _near_star(offer, self.max_ls)


ANY_RING = RingFilters()
ANY_BUYER = BuyerFilters()


# --------------------------------------------------------------------------- the searches


def bid(raw: dict[str, Any], item: Item) -> dict[str, Any] | None:
    """The station's fields with what it pays for `item` and how much it wants, or None when it
    does not buy it."""
    row = next(
        (
            m
            for m in raw.get("market") or []
            if isinstance(m, dict) and m.get("commodity") == item.name
        ),
        None,
    )
    if row is None:
        return None
    price, demand = row.get("sell_price"), row.get("demand")
    if not isinstance(price, int) or not isinstance(demand, int) or price <= 0 or demand <= 0:
        return None
    return {k: raw.get(k) for k in spansh.STATION_FIELDS} | {
        "price": price,
        "demand": demand,
        "offer_at": raw.get("market_updated_at") or raw.get("updated_at"),
    }


def search_buyers(
    item: Item,
    coords: Vec,
    large: bool,
    wanted: BuyerFilters = ANY_BUYER,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """The stations and carriers paying the most for `item` within `REACH_LY` of `coords` (with
    a large pad: `large`) that are `wanted`, asked in parallel; raises spansh.SpanshError."""
    filters = wanted.spansh(item.name, now or datetime.now(UTC))
    filters["distance"] = {"min": 0, "max": REACH_LY}
    if large:
        filters["has_large_pad"] = {"value": True}
    sort = [
        {"market_sell_price": [{"name": item.name, "direction": "desc"}]},
        *spansh.NEAREST_FIRST,
    ]
    jobs = ((STATION_SIZE, STATION_TYPES), (CARRIER_SIZE, CARRIER_TYPES))
    with ThreadPoolExecutor(len(jobs)) as pool:
        parts = list(
            pool.map(lambda job: spansh.station_search(filters, coords, job[0], job[1], sort), jobs)
        )
    return [b for part in parts for raw in part if (b := bid(raw, item)) is not None]


def search_rings(item: Item, coords: Vec, wanted: RingFilters = ANY_RING) -> list[dict[str, Any]]:
    """The bodies nearest to `coords` that are `wanted`, with a ring with hotspots of `item`;
    raises spansh.SpanshError."""
    hotspots = {"ring_signals": [{"name": item.name, "value": [1, 99], "comparison": "<=>"}]}
    return spansh.body_search(hotspots | wanted.spansh(), coords, RING_BODIES, RING_FIELDS)


AskBuyers = Callable[[Item, Vec, bool, BuyerFilters], list[dict[str, Any]]]
AskRings = Callable[[Item, Vec, RingFilters], list[dict[str, Any]]]


class MiningFinder:
    """Spansh's answers for the tab, kept by the Shop's finder (as are the systems needing a
    permit)."""

    def __init__(
        self,
        shops: ShopFinder,
        find_buyers: AskBuyers = search_buyers,
        find_rings: AskRings = search_rings,
    ) -> None:
        self._shops = shops
        self._find_buyers = find_buyers
        self._find_rings = find_rings

    def buyers(
        self, item: Item, here: Vec, large: bool, wanted: BuyerFilters
    ) -> tuple[list[dict[str, Any]], datetime]:
        """The buyers and when Spansh was asked; raises spansh.SpanshError."""
        key = f"buyers:{item.symbol}:{'large' if large else 'any'}:{wanted.key()}"
        return self._shops.kept(key, here, lambda: self._find_buyers(item, here, large, wanted))

    def rings(self, item: Item, here: Vec, wanted: RingFilters) -> list[dict[str, Any]]:
        """The bodies with its hotspots in a ring; raises spansh.SpanshError."""
        key = f"rings:{item.symbol}:{wanted.key()}"
        return self._shops.kept(key, here, lambda: self._find_rings(item, here, wanted))[0]

    def permit_locked(self) -> set[int]:
        return self._shops.permit_locked()


# --------------------------------------------------------------------------- the view


def _largest_pad(o: dict[str, Any]) -> str | None:
    pads = pads_of(o)
    if pads is None:
        return None
    return "L" if pads[2] else "M" if pads[1] else "S"


def _buyer_view(near: Near, jump_range: float | None, permits: set[int]) -> MiningBuyerView:
    distance, o = near
    kind = kind_of(o.get("type"))
    ls = o.get("distance_to_arrival")
    return MiningBuyerView(
        station=str(o["name"]),
        kind=kind,
        system_name=str(o.get("system_name")),
        system_address=str(o["system_id64"]) if o.get("system_id64") else None,
        distance_ly=round(distance, 1),
        jumps=jumps_to(distance, jump_range),
        dist_ls=round(ls) if isinstance(ls, int | float) else None,
        pad=_largest_pad(o),
        price=o["price"],
        demand=o["demand"],
        market_at=o.get("offer_at") if isinstance(o.get("offer_at"), str) else None,
        permit=o.get("system_id64") in permits,
        access=access_of(o.get("carrier_docking_access")) if kind == "carrier" else None,
    )


def _nearest_buyer(position: Vec, buyers: list[Near]) -> MiningSellView | None:
    near = [(math.dist(position, p), o) for _, o in buyers if (p := position_of(o))]
    if not near:
        return None
    distance, o = min(near, key=lambda n: n[0])
    return MiningSellView(
        station=str(o["name"]),
        system_name=str(o.get("system_name")),
        distance_ly=round(distance, 1),
        price=o["price"],
    )


def _signals(ring: dict[str, Any]) -> dict[str, int]:
    return {
        s["name"]: s["count"]
        for s in ring.get("signals") or []
        if isinstance(s, dict)
        and isinstance(s.get("name"), str)
        and isinstance(s.get("count"), int)
    }


def _ring_views(
    body: dict[str, Any], item: Item, here: Vec, jump_range: float | None, buyers: list[Near]
) -> list[tuple[float, MiningRingView]]:
    position = position_of(body)
    if position is None or not body.get("name"):
        return []
    distance = math.dist(here, position)
    ls = body.get("distance_to_arrival")
    found = []
    for ring in body.get("rings") or []:
        signals = _signals(ring) if isinstance(ring, dict) else {}
        count = signals.pop(item.name, 0)
        if count <= 0:
            continue
        others = sorted(signals.items(), key=lambda s: (-s[1], s[0]))
        view = MiningRingView(
            name=str(ring.get("name")),
            body=str(body["name"]),
            system_name=str(body.get("system_name")),
            system_address=str(body["system_id64"]) if body.get("system_id64") else None,
            distance_ly=round(distance, 1),
            jumps=jumps_to(distance, jump_range),
            dist_ls=round(ls) if isinstance(ls, int | float) else None,
            type=ring.get("type"),
            reserve=body.get("reserve_level"),
            count=count,
            others=[MiningSignalView(name=n, count=c) for n, c in others],
            reported_at=ring.get("signals_updated_at"),
            sell=_nearest_buyer(position, buyers),
        )
        found.append((distance, view))
    return found


def _trip(rings: list[MiningRingView]) -> MiningTripView | None:
    trips = [(r.distance_ly + r.sell.distance_ly, r, r.sell) for r in rings if r.sell is not None]
    if not trips:
        return None
    total, ring, sell = min(trips, key=lambda t: t[0])
    return MiningTripView(
        ring=ring.name,
        system_name=ring.system_name,
        distance_ly=ring.distance_ly,
        sell=sell,
        total_ly=round(total, 1),
    )


def _better_carrier(
    hidden: list[Near], buyers: list[MiningBuyerView], jump_range: float | None
) -> MiningBuyerView | None:
    best = max(hidden, default=None, key=lambda n: (n[1]["price"], -n[0]))
    if best is None or (buyers and best[1]["price"] <= buyers[0].price):
        return None
    return _buyer_view(best, jump_range, set())


def cargo_capacity(conn: sqlite3.Connection) -> int | None:
    """Your ship's hold, t (the latest Loadout; None: unknown or none)."""
    loadout = latest_loadout(conn)
    cargo = loadout[1].get("CargoCapacity") if loadout else None
    return cargo if isinstance(cargo, int) and cargo > 0 else None


def mining_view(
    conn: sqlite3.Connection,
    state: sqlite3.Row | None,
    finder: MiningFinder | None,
    symbol: str | None,
    carriers: bool = False,
    rings_wanted: RingFilters = ANY_RING,
    buyers_wanted: BuyerFilters = ANY_BUYER,
) -> MiningView:
    ship = state["ship_type"] if state else None
    pad = pad_size(ship)
    jump_range = state["jump_range"] if state else None
    view = MiningView(
        state="ready",
        commodities=commodities(),
        item=None,
        name=None,
        hotspots=False,
        ship=ship_name(ship),
        pad=pad,
        carriers=carriers,
        buyers=[],
        better_carrier=None,
        rings=[],
        trip=None,
        searched_at=None,
        reach_ly=REACH_LY,
        cargo=cargo_capacity(conn),
    )
    if symbol is None:
        return view
    item = find(symbol)
    if item is None:
        return view.model_copy(update={"state": "unknown_item"})
    hotspots = item.symbol in HOTSPOTS
    view = view.model_copy(update={"item": item.symbol, "name": item.name, "hotspots": hotspots})
    if finder is None:
        return view.model_copy(update={"state": "offline"})
    here = here_of(conn, state)
    if here is None:
        return view.model_copy(update={"state": "unknown_position"})
    try:
        offers, asked_at = finder.buyers(item, here, pad == "L", buyers_wanted)
        bodies = finder.rings(item, here, rings_wanted) if hotspots else []
    except spansh.SpanshError:
        return view.model_copy(update={"state": "failed"})

    now = datetime.now(UTC)
    offers = [o for o in offers if buyers_wanted.admits(o, now)]
    bodies = [b for b in bodies if rings_wanted.admits(b)]
    shown, hidden = usable(offers, here, pad, now, carriers, pledged_power(conn))
    shown = sorted(shown, key=lambda n: (-n[1]["price"], n[0]))[:BUYERS]
    permits = finder.permit_locked() if shown else set()
    buyers = [_buyer_view(n, jump_range, permits) for n in shown]
    rings = sorted(
        (r for b in bodies for r in _ring_views(b, item, here, jump_range, shown)),
        key=lambda r: r[0],
    )
    ring_views = [r for _, r in rings[:RINGS]]
    return view.model_copy(
        update={
            "searched_at": asked_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "buyers": buyers,
            "better_carrier": _better_carrier(hidden, buyers, jump_range),
            "rings": ring_views,
            "trip": _trip(ring_views),
        }
    )

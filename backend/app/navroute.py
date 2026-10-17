"""The route plotted in the game (NavRoute.json): what lies ahead on it.

The game writes the whole plotted route to NavRoute.json (the journal's NavRoute event only
says it changed) and empties it on NavRouteClear. Read live like Status.json, never stored.

Ahead of you: where the next scoopable star is and whether the fuel lasts until there (the
drive's fuel curve, app.fuel, scooping the tank full at every scoopable star), neutron stars
and white dwarfs (supercharge, but mind the jets), and how likely each system is still
undiscovered (app.discovery).
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app import fuel
from app.discovery import DiscoveryChecker, cached, chance
from app.facts import facts_from_json
from app.schemas import (
    DiscoveryChanceView,
    FuelForecastView,
    NavHopView,
    NavRouteView,
    StarKind,
)
from app.views import cmdr_state

# Main sequence stars and their giants take a fuel scoop (KGBFOAM); not AeBe, MS, TTS...
SCOOPABLE = re.compile(r"[OBAFGKM](_\w+)?")


def star_kind(star_class: str) -> StarKind:
    if star_class == "N":
        return "neutron"
    if star_class.startswith("D"):
        return "white_dwarf"
    if star_class in ("H", "SupermassiveBlackHole"):
        return "black_hole"
    if SCOOPABLE.fullmatch(star_class):
        return "scoopable"
    return "other"


@dataclass(frozen=True, slots=True)
class PlottedSystem:
    name: str
    address: int
    x: float
    y: float
    z: float
    star_class: str


@dataclass(frozen=True, slots=True)
class PlottedRoute:
    timestamp: str | None
    systems: tuple[PlottedSystem, ...]


def parse_navroute(data: dict[str, Any]) -> PlottedRoute:
    systems = []
    for entry in data.get("Route") or []:
        if not isinstance(entry, dict):
            continue
        pos = entry.get("StarPos")
        address = entry.get("SystemAddress")
        if not entry.get("StarSystem") or address is None or not isinstance(pos, list):
            continue
        if len(pos) != 3:
            continue
        systems.append(
            PlottedSystem(
                name=str(entry["StarSystem"]),
                address=int(address),
                x=float(pos[0]),
                y=float(pos[1]),
                z=float(pos[2]),
                star_class=str(entry.get("StarClass") or ""),
            )
        )
    return PlottedRoute(timestamp=data.get("timestamp"), systems=tuple(systems))


class NavRouteReader:
    """NavRoute.json, re-read when it changes. Partial writes are ignored until complete."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._signature: tuple[int, int] | None = None
        self.current: PlottedRoute | None = None

    def poll(self) -> bool:
        """True when the plotted route changed since the last successful read."""
        try:
            stat = self.path.stat()
        except OSError:
            if self.current is None:
                return False
            self.current, self._signature = None, None
            return True
        signature = (stat.st_mtime_ns, stat.st_size)
        if signature == self._signature:
            return False
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return False
        if not isinstance(data, dict):
            return False
        self._signature = signature
        route = parse_navroute(data)
        if route == self.current:
            return False
        self.current = route
        return True


# --------------------------------------------------------------------------- the view


def _empty(online: bool, fuel_view: FuelForecastView) -> NavRouteView:
    return NavRouteView(
        online=online,
        checking=False,
        plotted_at=None,
        hops=[],
        here_index=None,
        jumps_left=0,
        ly_left=0.0,
        fuel=fuel_view,
        next_neutron=None,
        next_white_dwarf=None,
        neutrons_ahead=0,
        white_dwarfs_ahead=0,
        undiscovered_expected=0.0,
        warnings=[],
    )


def _arrival_stars(conn: sqlite3.Connection, addresses: list[int]) -> dict[int, bool | None]:
    """Your scans of the systems' arrival stars: WasDiscovered (True: somebody was first)."""
    out: dict[int, bool | None] = {}
    for start in range(0, len(addresses), 900):  # SQLite parameter limit
        chunk = addresses[start : start + 900]
        marks = ",".join("?" * len(chunk))
        for row in conn.execute(
            "SELECT system_address, facts FROM bodies "
            f"WHERE kind = 'star' AND system_address IN ({marks})",
            chunk,
        ):
            facts = facts_from_json(row["facts"])
            if facts.distance_ls == 0:
                out[row["system_address"]] = facts.was_discovered
    return out


def _visited_since(conn: sqlite3.Connection, fid: str | None, since: str | None) -> set[int]:
    if not fid:
        return set()
    return {
        r[0]
        for r in conn.execute(
            "SELECT system_address FROM visits WHERE fid = ? AND ts >= ?", (fid, since or "")
        )
    }


def navroute_view(
    conn: sqlite3.Connection,
    fid: str | None,
    route: PlottedRoute | None,
    live_fuel: float | None,
    checker: DiscoveryChecker | None,
) -> NavRouteView:
    online = checker is not None
    ship = fuel.ship_fuel(conn, fid)
    level = live_fuel if live_fuel is not None else (ship.level if ship else None)
    no_fuel = FuelForecastView(
        level=level,
        capacity=ship.capacity if ship else None,
        has_scoop=ship.has_scoop if ship else False,
        learnt_from=ship.curve.samples if ship and ship.curve else 0,
        needed=None,
        enough=None,
        short_at=None,
        jumps_to_scoop=None,
        fuel_at_scoop=None,
        longest_dry=0,
        longest_dry_fuel=None,
    )
    if route is None or not route.systems:
        return _empty(online, no_fuel)
    systems = route.systems

    state = cmdr_state(conn, fid)
    here_address = state["system_address"] if state else None
    here_index = next(
        (i for i in range(len(systems) - 1, -1, -1) if systems[i].address == here_address), None
    )
    visited = _visited_since(conn, fid, route.timestamp)

    def status(i: int) -> str:
        if here_index is not None:
            return "passed" if i < here_index else "here" if i == here_index else "ahead"
        return "passed" if systems[i].address in visited else "ahead"

    statuses = [status(i) for i in range(len(systems))]
    kinds = [star_kind(s.star_class) for s in systems]
    hops_ly = [0.0] + [
        math.dist((a.x, a.y, a.z), (b.x, b.y, b.z))
        for a, b in zip(systems, systems[1:], strict=False)
    ]
    ahead = [i for i, st in enumerate(statuses) if st == "ahead"]

    # Fuel forecast: jump by jump from the level now, the tank scooped full at scoopable stars.
    used: dict[int, float] = {}
    after: dict[int, float] = {}
    refuel: set[int] = set()
    short_at: int | None = None
    can_forecast = ship is not None and ship.curve is not None and level is not None
    if can_forecast:
        assert ship is not None and level is not None
        tank = level
        for i in ahead:
            need = ship.jump_fuel(hops_ly[i], tank) or 0.0
            used[i] = need
            if need > tank + 1e-9:
                short_at = i
                break
            tank -= need
            after[i] = tank
            if kinds[i] == "scoopable" and ship.has_scoop and ship.capacity:
                refuel.add(i)
                tank = max(tank, ship.capacity)

    needed = None
    if can_forecast:
        assert ship is not None and level is not None
        tank, needed = level, 0.0
        for i in ahead:
            need = ship.jump_fuel(hops_ly[i], max(tank, 0.0)) or 0.0
            needed += need
            tank -= need

    scoop_at = next((i for i in ahead if kinds[i] == "scoopable"), None)
    first_ahead = ahead[0] if ahead else None
    jumps_to = (lambda i: ahead.index(i) + 1) if ahead else (lambda i: 0)

    # Legs between fuel stops: the jumps from one scoopable star (or here) to the next one,
    # the jump into it included. The longest, and what each needs from a full tank.
    legs: list[list[int]] = [[]]
    for i in ahead:
        legs[-1].append(i)
        if kinds[i] == "scoopable":
            legs.append([])
    legs = [leg for leg in legs if leg] or [[]]

    def from_full(leg: list[int]) -> float | None:
        if not can_forecast or ship is None or not ship.capacity:
            return None
        tank, total = ship.capacity, 0.0
        for i in leg:
            need = ship.jump_fuel(hops_ly[i], max(tank, 0.0)) or 0.0
            total += need
            tank -= need
        return total

    longest = max(legs, key=len)
    longest_fuel = from_full(longest) if longest else None
    capacity = ship.capacity if ship is not None else None

    warnings: list[str] = []
    if short_at is not None:
        here_scoopable = here_index is not None and kinds[here_index] == "scoopable"
        first_leg = from_full(legs[0])
        # Scooping here helps only when a full tank reaches the next scoopable star.
        helps = short_at in legs[0] and first_leg is not None and capacity and first_leg <= capacity
        if here_scoopable and ship is not None and ship.has_scoop and helps:
            warnings.append("refuel_here")
        else:
            warnings.append("fuel_short")
    elif scoop_at is not None and scoop_at in after and used:
        if after[scoop_at] < max(used.values()):
            warnings.append("fuel_tight")
    if longest_fuel is not None and capacity and longest_fuel > capacity:
        warnings.append("dry_stretch")
    if first_ahead is not None and kinds[first_ahead] == "neutron":
        warnings.append("neutron_next")
    if first_ahead is not None and kinds[first_ahead] == "white_dwarf":
        warnings.append("white_dwarf_next")
    if here_index is None and ahead:
        warnings.append("off_route")

    # Discovery: your own scans first, then the community databases (asked in the background).
    yours = _arrival_stars(conn, [s.address for s in systems])
    known = cached(conn, (systems[i].address for i in ahead))
    if checker is not None:
        checker.request(
            conn,
            [
                (systems[i].address, systems[i].name)
                for i in ahead
                if systems[i].address not in yours
            ],
        )
    hops: list[NavHopView] = []
    expected = 0.0
    for i, s in enumerate(systems):
        discovery = None
        if statuses[i] == "ahead":
            if s.address in yours:
                discovery = DiscoveryChanceView(
                    probability=0.0, state="scanned", reasons=["visited"]
                )
            else:
                row = known.get(s.address)
                c = chance(
                    row["spansh"] if row else None,
                    row["edsm"] if row else None,
                    (s.x, s.y, s.z),
                    kinds[i],
                )
                discovery = DiscoveryChanceView(
                    probability=c.probability, state=c.state, reasons=list(c.reasons)
                )
                expected += c.probability or 0.0
        mine = yours.get(s.address)
        hops.append(
            NavHopView(
                index=i,
                address=str(s.address),
                name=s.name,
                star_class=s.star_class,
                star_kind=kinds[i],
                x=s.x,
                y=s.y,
                z=s.z,
                distance_ly=round(hops_ly[i], 2),
                status=statuses[i],
                fuel_used=round(used[i], 3) if i in used else None,
                fuel_after=round(after[i], 2) if i in after else None,
                refuel=i in refuel,
                short=i == short_at,
                discovery=discovery,
                discovered_by_you=(None if mine is None else not mine)
                if statuses[i] != "ahead"
                else None,
            )
        )

    def next_of(kind: str) -> int | None:
        i = next((i for i in ahead if kinds[i] == kind), None)
        return jumps_to(i) if i is not None else None

    return NavRouteView(
        online=online,
        checking=checker.busy if checker is not None else False,
        plotted_at=route.timestamp,
        hops=hops,
        here_index=here_index,
        jumps_left=len(ahead),
        ly_left=round(sum(hops_ly[i] for i in ahead), 2),
        fuel=no_fuel.model_copy(
            update={
                "needed": round(needed, 2) if needed is not None else None,
                "enough": (short_at is None) if can_forecast else None,
                "short_at": short_at,
                "jumps_to_scoop": jumps_to(scoop_at) if scoop_at is not None else None,
                "fuel_at_scoop": round(after[scoop_at], 2) if scoop_at in after else None,
                "longest_dry": len(longest),
                "longest_dry_fuel": round(longest_fuel, 2) if longest_fuel is not None else None,
            }
        ),
        next_neutron=next_of("neutron"),
        next_white_dwarf=next_of("white_dwarf"),
        neutrons_ahead=sum(1 for i in ahead if kinds[i] == "neutron"),
        white_dwarfs_ahead=sum(1 for i in ahead if kinds[i] == "white_dwarf"),
        undiscovered_expected=round(expected, 2),
        warnings=warnings,
    )

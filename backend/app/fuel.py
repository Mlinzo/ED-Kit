"""Fuel per jump for the current ship, learnt from its own jumps.

A jump burns  fuel = fuelmul * (distance * mass / optimal_mass) ** power  tons, where mass is
the ship at the start of the jump (unladen, fuel and cargo). `power` depends on the drive's
size only: 2.00 for size 2, +0.15 per size up (2.45 for size 5, 2.90 for size 8), the same
for SCO drives; 2.5025 for the SCO mk II (Spansh's drive table, cross-checked with the
journal: FuelUsed / JumpDist ** power is constant for a ship of constant mass).

fuelmul and the optimal mass depend on the class, the rating and engineering, so
k = fuelmul / optimal_mass ** power is learnt per drive (`fsd_key`: the drive, its engineered
optimal mass, an FSD booster) from its last unboosted jumps: the median of
fuel / (distance * mass) ** power. One jump is enough; a new drive has no estimate until it
has jumped once. On the player's journals the curve predicts FuelUsed within 0.01 %
(median; at most 1.5 %).

The jump range follows from the same law (EDSY's formula):
range = (min(fuel, F) / fuelmul) ** (1 / power) * optimal_mass / mass + booster, where F is the
drive's max fuel per jump and the reserve tank counts for nothing. The journal's MaxJumpRange
(Loadout) is the range with an empty hold and just F in the tank, so a heavier ship's range
scales down from it: the game's 34.90 ly is 27.4 ly with a full 112 t tank. F itself follows
from the curve (a full-range jump burns F); until the drive's first jump it is taken as 0,
which makes the range ~1-2 % long.
"""

from __future__ import annotations

import math
import re
import sqlite3
import statistics
from dataclasses import dataclass

from app.views import cmdr_state

FSD_SIZE = re.compile(r"int_hyperdrive(?:_overcharge)?_size(\d)_class\d")
MK2 = "overchargebooster_mkii"
SAMPLES = 30  # the latest jumps a curve is learnt from
# Guardian FSD booster: ly added to every jump whatever the mass, by size (EDSY).
BOOSTER = re.compile(r"int_guardianfsdbooster_size(\d)")
BOOSTER_LY = {1: 4.0, 2: 6.0, 3: 7.75, 4: 9.25, 5: 10.5}


def booster_ly(fsd_key: str | None) -> float:
    """The FSD booster's range from the drive's key (app.projector.fsd_key: it names it)."""
    match = BOOSTER.search(fsd_key or "")
    return BOOSTER_LY.get(int(match.group(1)), 0.0) if match else 0.0


def fuel_power(fsd_item: str | None) -> float | None:
    """The drive's fuel power, from its module symbol; None for an unknown drive."""
    if not fsd_item:
        return None
    if MK2 in fsd_item:
        return 2.5025
    match = FSD_SIZE.match(fsd_item)
    return 2.0 + 0.15 * (int(match.group(1)) - 2) if match else None


def supercharge_multiplier(fsd_item: str | None) -> int:
    """Jump range multiplier of a neutron star supercharge (Spansh: 6 for the SCO mk II)."""
    return 6 if fsd_item and MK2 in fsd_item else 4


@dataclass(frozen=True, slots=True)
class FuelCurve:
    k: float
    power: float
    samples: int

    def fuel(self, distance_ly: float, mass_t: float) -> float:
        return self.k * (distance_ly * mass_t) ** self.power


def fit_curve(samples: list[tuple[float, float, float]], power: float) -> FuelCurve | None:
    """Curve from (distance ly, fuel used t, mass t) of unboosted jumps; None without any."""
    ks = [used / (d * m) ** power for d, used, m in samples if d > 0.5 and used > 0 and m > 0]
    if not ks:
        return None
    return FuelCurve(statistics.median(ks), power, len(ks))


@dataclass(frozen=True, slots=True)
class ShipFuel:
    """What the forecast needs: the curve (None until the drive has jumped) and the ship."""

    curve: FuelCurve | None
    unladen_mass: float
    cargo: float
    capacity: float | None
    level: float | None  # last known from the journal (Status.json is fresher when live)
    has_scoop: bool
    max_range: float | None = None  # MaxJumpRange (Loadout): empty hold, fuel for one jump
    booster: float = 0.0  # ly a Guardian FSD booster adds to every jump

    def jump_fuel(self, distance_ly: float, fuel_before: float) -> float | None:
        if self.curve is None:
            return None
        return self.curve.fuel(distance_ly, self.unladen_mass + self.cargo + fuel_before)

    def max_fuel_per_jump(self) -> float | None:
        """F, what a full-range jump burns: MaxJumpRange is the range at the mass unladen + F,
        so F = curve(MaxJumpRange, unladen + F), a fixed point found in a few steps."""
        if self.curve is None or not self.max_range:
            return None
        top = 0.0
        for _ in range(50):
            nxt = self.curve.fuel(self.max_range, self.unladen_mass + top)
            if not math.isfinite(nxt) or nxt > 1000:
                return None
            if abs(nxt - top) < 1e-9:
                break
            top = nxt
        return top if top > 0 else None

    def _reach(self) -> tuple[float, float] | None:
        """(range x mass of a full-range jump without the booster, F or 0 if unknown)."""
        if not self.max_range:
            return None
        top = self.max_fuel_per_jump() or 0.0
        return (self.max_range - self.booster) * (self.unladen_mass + top), top

    def range_with(self, fuel: float) -> float | None:
        """Jump range (ly) with `fuel` t in the tank and the cargo aboard."""
        reach = self._reach()
        if reach is None:
            return None
        base, top = reach
        fuel = max(fuel, 0.0)
        if self.curve is not None and fuel < top:
            base *= (fuel / top) ** (1 / self.curve.power)  # not enough fuel for a full jump
        return base / (self.unladen_mass + self.cargo + fuel) + self.booster

    def most_fuel_for(self, distance_ly: float) -> float | None:
        """The most fuel the tank may hold to jump `distance_ly` in one go with the cargo aboard.
        None when F is unknown, or when even F alone in the tank does not get that far."""
        top = self.max_fuel_per_jump()
        reach = self._reach()
        if top is None or reach is None:
            return None
        if distance_ly <= self.booster:
            return self.capacity
        most = reach[0] / (distance_ly - self.booster) - self.unladen_mass - self.cargo
        return most if most >= top else None


def full_tank_range(ship: ShipFuel | None, max_range: float | None) -> float | None:
    """The range to plan a long way with: a full tank and the cargo aboard (scooping refills it
    on the way). MaxJumpRange when the ship's mass or tank is not known."""
    if ship is not None and ship.capacity:
        return ship.range_with(ship.capacity) or max_range
    return max_range


def ship_fuel(conn: sqlite3.Connection, fid: str | None) -> ShipFuel | None:
    state = cmdr_state(conn, fid)
    if state is None or state["unladen_mass"] is None:
        return None
    curve = None
    power = fuel_power(state["fsd_item"])
    if power is not None and state["fsd_key"]:
        # The curve belongs to the drive, not the hull: the same drive in another ship (or
        # a ship bought later) shares it, the mass term accounts for the rest.
        rows = conn.execute(
            "SELECT distance_ly, fuel_used, mass FROM fuel_jumps "
            "WHERE fid = ? AND fsd_key = ? AND boosted = 0 ORDER BY id DESC LIMIT ?",
            (fid, state["fsd_key"], SAMPLES),
        ).fetchall()
        curve = fit_curve([(r["distance_ly"], r["fuel_used"], r["mass"]) for r in rows], power)
    capacity, level = state["fuel_capacity"], state["fuel_level"]
    if capacity is not None and level is not None:
        level = min(level, capacity)  # a tank sold since the last fuel report
    return ShipFuel(
        curve=curve,
        unladen_mass=state["unladen_mass"],
        cargo=state["cargo"] or 0.0,
        capacity=capacity,
        level=level,
        has_scoop=bool(state["has_scoop"]),
        max_range=state["jump_range"],
        booster=booster_ly(state["fsd_key"]),
    )

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
"""

from __future__ import annotations

import re
import sqlite3
import statistics
from dataclasses import dataclass

from app.views import cmdr_state

FSD_SIZE = re.compile(r"int_hyperdrive(?:_overcharge)?_size(\d)_class\d")
MK2 = "overchargebooster_mkii"
SAMPLES = 30  # the latest jumps a curve is learnt from


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

    def jump_fuel(self, distance_ly: float, fuel_before: float) -> float | None:
        if self.curve is None:
            return None
        return self.curve.fuel(distance_ly, self.unladen_mass + self.cargo + fuel_before)


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
    return ShipFuel(
        curve=curve,
        unladen_mass=state["unladen_mass"],
        cargo=state["cargo"] or 0.0,
        capacity=state["fuel_capacity"],
        level=state["fuel_level"],
        has_scoop=bool(state["has_scoop"]),
    )

"""Boxels: the cubes the galaxy's generated systems are numbered in.

A system's id64 holds its boxel and its number there (EDCD's id64 notes): from the lowest bit,
the mass code (3 bits, a..h), then for z, y and x in turn the boxel within its sector
(7 - mass code bits) and the sector (7, 6 and 7 bits), then the number in the boxel
(11 + 3 * mass code bits); a body's id sits above, from bit 55. A boxel of mass code a is
10 ly on a side and each code up doubles it (h: a whole 1280 ly sector). A generated name says
the same: "Froalt MC-S b31-49" is number 49 of boxel "MC-S b31", mass code b.

Numbers in a boxel run from 0 with no holes. Checked on Spansh 2026-10-22: around Colonia
(well explored, no catalogue stars) 112 boxels within 50 ly held 448 known systems and no
hole. Near Sol, real catalogue stars (Gliese, LHS ...) took the place of generated ones and
left holes: "Core Sys Sector MC-V b2-5" is in no database, though everything there is known.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SECTOR_LY = 1280.0
# The lower corner of sector (0, 0, 0), galactic coordinates (ly).
ORIGIN = (-49985.0, -40985.0, -24105.0)
MASS_CODES = "abcdefgh"
BODY_SHIFT = 55

# "<sector> XX-Y <mass code><n1>-<n2>", "-<n1>" left out when it is 0: "Synuefe XO-P c22-17",
# "Pru Euq ZZ-Y d63".
_GENERATED = re.compile(r"^(?P<prefix>.+ [A-Z]{2}-[A-Z] (?P<code>[a-h])(?:\d+-)?)(?P<n>\d+)$")


@dataclass(frozen=True, slots=True)
class Boxel:
    mass_code: int  # 0..7: a..h
    bits: int  # the id64 below the number in the boxel: the boxel itself

    @property
    def size(self) -> float:
        """The edge of the cube, ly."""
        return 10.0 * (1 << self.mass_code)

    @property
    def corner(self) -> tuple[float, float, float]:
        """The lower corner, galactic coordinates (ly)."""
        free = 7 - self.mass_code
        rest = self.bits >> 3
        coords = []
        for sector_bits in (7, 6, 7):  # z, y, x
            inner = rest & ((1 << free) - 1)
            rest >>= free
            sector = rest & ((1 << sector_bits) - 1)
            rest >>= sector_bits
            coords.append(sector * SECTOR_LY + inner * self.size)
        z, y, x = coords
        return (x + ORIGIN[0], y + ORIGIN[1], z + ORIGIN[2])

    @property
    def centre(self) -> tuple[float, float, float]:
        half = self.size / 2
        x, y, z = self.corner
        return (x + half, y + half, z + half)

    def address(self, number: int) -> int:
        """The id64 of system `number` in this boxel."""
        return self.bits | (number << _number_shift(self.mass_code))


def _number_shift(mass_code: int) -> int:
    return 3 + 3 * (7 - mass_code) + 20


def decode(id64: int) -> tuple[Boxel, int]:
    """The boxel of a system and its number there."""
    system = id64 & ((1 << BODY_SHIFT) - 1)
    mass_code = system & 7
    shift = _number_shift(mass_code)
    return Boxel(mass_code, system & ((1 << shift) - 1)), system >> shift


def generated_prefix(name: str, id64: int) -> str | None:
    """The name without its number ("Froalt MC-S b31-"), if the generator named the system:
    the mass code and the number agree with the id64. None for catalogue and renamed systems."""
    m = _GENERATED.match(name)
    if m is None:
        return None
    boxel, number = decode(id64)
    if MASS_CODES[boxel.mass_code] != m["code"] or int(m["n"]) != number:
        return None
    return m["prefix"]

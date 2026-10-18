"""Which codex region a point of the galaxy is in.

The journal names the region only in `CodexEntry` events, so a system's region used to be
unknown until you logged something there. This map answers for any coordinates: a
2048 x 2048 grid over the galactic plane (x, z), ~49.3 ly per cell, run-length encoded, from
Ben Peddell's EliteDangerousRegionMap (MIT, data/regionmap-LICENSE), traced from the game's
own region map: https://github.com/klightspeed/EliteDangerousRegionMap (commit 6c1191a,
2026-05-12). Region numbers are the game's: 18 is "$Codex_RegionName_18;", Inner Orion Spur.
Regions span the whole height of the galaxy, so y does not matter.
"""

from __future__ import annotations

import json
import math
from bisect import bisect_right
from functools import cache
from pathlib import Path

from app.exobio.regions import CODEX_REGIONS

DATA = Path(__file__).parent / "data" / "regionmap.json"

# Galactic x and z of the grid's corner, and the cell size, as in the source.
X0 = -49985.0
Z0 = -24105.0
CELL_LY = 4096 / 83
SIZE = 2048


@cache
def _rows() -> list[tuple[list[int], list[int]]]:
    """Per row (z), from the minimum z up: where each run ends (exclusive) and its region."""
    data = json.loads(DATA.read_text("utf-8"))
    rows: list[tuple[list[int], list[int]]] = []
    for row in data["regionmap"]:
        ends: list[int] = []
        ids: list[int] = []
        x = 0
        for length, region in row:
            x += length
            ends.append(x)
            ids.append(region)
        rows.append((ends, ids))
    return rows


def region_at(x: float, z: float) -> int | None:
    """The codex region number (1..42) at these galactic coordinates; None outside the map."""
    px = math.floor((x - X0) / CELL_LY)
    pz = math.floor((z - Z0) / CELL_LY)
    if not (0 <= px < SIZE and 0 <= pz < SIZE):
        return None
    ends, ids = _rows()[pz]
    i = bisect_right(ends, px)
    region = ids[i] if i < len(ids) else 0
    return region or None


def region_symbol(region: int | None) -> str | None:
    """As the journal writes it: "$Codex_RegionName_18;"."""
    return f"$Codex_RegionName_{region};" if region else None


def region_number(symbol: str | None) -> int | None:
    """The number in "$Codex_RegionName_18;", or None for anything else."""
    if not symbol:
        return None
    digits = symbol.strip().removeprefix("$Codex_RegionName_").removesuffix(";")
    if not digits.isdigit():
        return None
    n = int(digits)
    return n if 1 <= n <= len(CODEX_REGIONS) else None


def name(region: int) -> str:
    return CODEX_REGIONS[region - 1]


@cache
def map_json() -> bytes:
    """The grid for the galaxy map's region layer: each row as flat [length, region, ...]."""
    rows = json.loads(DATA.read_text("utf-8"))["regionmap"]
    return json.dumps(
        {
            "x0": X0,
            "z0": Z0,
            "cellLy": CELL_LY,
            "size": SIZE,
            "names": list(CODEX_REGIONS),
            "rows": [[v for run in row for v in run] for row in rows],
        },
        separators=(",", ":"),
    ).encode()

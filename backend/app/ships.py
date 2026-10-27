"""Ships by journal symbol (`Loadout.Ship`): the name and the landing pad size they need.

Pad sizes from EDCD coriolis-data (`ships/*.json`, `properties.class`: 1 small, 2 medium,
3 large), matched to journal symbols through EDCD FDevIDs `shipyard.csv`; checked 2026-10-19.
A ship missing here needs an unknown pad: nothing is filtered for it.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Literal

Pad = Literal["S", "M", "L"]


def latest_loadout(conn: sqlite3.Connection) -> tuple[int, dict[str, Any]] | None:
    """Your current ship as the latest Loadout event has it: its event id and the event."""
    row = conn.execute(
        "SELECT id, raw FROM events WHERE event = 'Loadout' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return None if row is None else (row[0], json.loads(row[1]))


SHIPS: dict[str, tuple[str, Pad]] = {
    "adder": ("Adder", "S"),
    "cobramkiii": ("Cobra Mk III", "S"),
    "cobramkiv": ("Cobra Mk IV", "S"),
    "cobramkv": ("Cobra Mk V", "S"),
    "diamondback": ("Diamondback Scout", "S"),
    "diamondbackxl": ("Diamondback Explorer", "S"),
    "dolphin": ("Dolphin", "S"),
    "eagle": ("Eagle", "S"),
    "empire_courier": ("Imperial Courier", "S"),
    "empire_eagle": ("Imperial Eagle", "S"),
    "hauler": ("Hauler", "S"),
    "sidewinder": ("Sidewinder", "S"),
    "smallcombat01_nx": ("Kestrel Mk II", "S"),
    "viper": ("Viper Mk III", "S"),
    "viper_mkiv": ("Viper Mk IV", "S"),
    "vulture": ("Vulture", "S"),
    "asp": ("Asp Explorer", "M"),
    "asp_scout": ("Asp Scout", "M"),
    "corsair": ("Corsair", "M"),
    "federation_dropship": ("Federal Dropship", "M"),
    "federation_dropship_mkii": ("Federal Assault Ship", "M"),
    "federation_gunship": ("Federal Gunship", "M"),
    "ferdelance": ("Fer-de-Lance", "M"),
    "independant_trader": ("Keelback", "M"),
    "krait_light": ("Krait Phantom", "M"),
    "krait_mkii": ("Krait Mk II", "M"),
    "lakonminer": ("Type-11 Prospector", "M"),
    "mamba": ("Mamba", "M"),
    "mediumtransport01": ("Lynx Highliner", "M"),  # EDSY and the wiki, 2026-10-21
    "mandalay": ("Mandalay", "M"),
    "python": ("Python", "M"),
    "python_nx": ("Python Mk II", "M"),
    "type6": ("Type-6 Transporter", "M"),
    "type8": ("Type-8 Transporter", "M"),
    "typex": ("Alliance Chieftain", "M"),
    "typex_2": ("Alliance Crusader", "M"),
    "typex_3": ("Alliance Challenger", "M"),
    "anaconda": ("Anaconda", "L"),
    "anacondamkii": ("Anaconda Mk II", "L"),  # EDSY, 2026-10-22: not in FDevIDs yet
    "belugaliner": ("Beluga Liner", "L"),
    "cutter": ("Imperial Cutter", "L"),
    "empire_trader": ("Imperial Clipper", "L"),
    "explorer_nx": ("Caspian Explorer", "L"),
    "federation_corvette": ("Federal Corvette", "L"),
    "orca": ("Orca", "L"),
    "panthermkii": ("Panther Clipper Mk II", "L"),
    "type7": ("Type-7 Transporter", "L"),
    "type9": ("Type-9 Heavy", "L"),
    "type9_military": ("Type-10 Defender", "L"),
}


def ship_name(symbol: str | None) -> str | None:
    if not symbol:
        return None
    known = SHIPS.get(symbol.lower())
    return known[0] if known else None


def pad_size(symbol: str | None) -> Pad | None:
    if not symbol:
        return None
    known = SHIPS.get(symbol.lower())
    return known[1] if known else None

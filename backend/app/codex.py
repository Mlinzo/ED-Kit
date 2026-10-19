"""Your codex: which organisms you have logged, and where.

The game logs a codex entry per colour variant of a species and per galactic region
(app.exobio.variants). The index holds your entries by variant symbol and by species symbol
(any colour), each with the regions and times you logged them. On the player's journals the
marks agree with the game's own IsNewEntry on every CodexEntry (27 of 27, 2026-10-19).
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from collections.abc import Sequence

from app.exobio.variants import Variant
from app.schemas import CodexStatus

# codex symbol (a variant, or a species for any of its colours) -> [(region, timestamp)]
CodexIndex = dict[str, list[tuple[str | None, str]]]


def codex_index(conn: sqlite3.Connection, fid: str | None) -> CodexIndex:
    index: CodexIndex = defaultdict(list)
    for row in conn.execute(
        "SELECT name, species, region, ts FROM codex_entries WHERE fid = ? AND species IS NOT NULL",
        (fid,),
    ):
        index[row["species"]].append((row["region"], row["ts"]))
        if row["name"] and row["name"] != row["species"]:
            index[row["name"]].append((row["region"], row["ts"]))
    return index


def codex_status(
    index: CodexIndex, symbol: str, region: str | None, before: str | None = None
) -> CodexStatus:
    """Codex state of a variant (or of a species, any colour). `before`: ignore entries written
    from that moment on (the game logs the entry at the first sample, so an ongoing scan still
    counts as new)."""
    regions = {r for r, ts in index.get(symbol, ()) if before is None or ts < before}
    if not regions:
        return "new"
    if region is None or region in regions:
        return "logged"  # with the region unknown, any record counts
    return "new_region"


def colour_status(
    index: CodexIndex,
    variant: str | None,
    species: str,
    region: str | None,
    before: str | None = None,
) -> CodexStatus:
    """Codex state of one colour of a species: a colour not logged here is a new entry, but
    "new_colour" when the species itself is logged in this region (in another colour), and
    "new_region" when it is logged only elsewhere. Colour unknown: by species."""
    if not variant or variant == species:
        return codex_status(index, species, region, before)
    status = codex_status(index, variant, region, before)
    if status == "logged":
        return status
    by_species = codex_status(index, species, region, before)
    if by_species == "logged":
        return "new_colour"
    return "new_region" if "new_region" in (status, by_species) else "new"


# What a mix of colours shows: the strongest news among them.
_RANK: dict[CodexStatus, int] = {"new": 0, "new_region": 1, "new_colour": 2, "logged": 3}


def predicted_status(
    index: CodexIndex, species: str, found: Sequence[Variant] | None, region: str | None
) -> tuple[CodexStatus, float]:
    """A predicted species' codex state and how many new entries it is worth (0..1: the
    chance its colour is one you have not logged here). Colour unknown: by species."""
    if found is None:
        status = codex_status(index, species, region)
        return status, 0.0 if status == "logged" else 1.0
    states = [(colour_status(index, v.symbol, species, region), v.weight) for v in found]
    worth = sum(w for s, w in states if s != "logged")
    if worth <= 0:
        return "logged", 0.0
    return min((s for s, _ in states if s != "logged"), key=_RANK.__getitem__), worth

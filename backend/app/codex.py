"""Your codex: which organisms you have logged, and where.

The game logs a codex entry per colour variant of a species and per galactic region
(app.exobio.variants). The index holds your entries by variant symbol and by species symbol
(any colour), each with the regions and times you logged them.
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


def predicted_status(
    index: CodexIndex, species: str, found: Sequence[Variant] | None, region: str | None
) -> tuple[CodexStatus, float]:
    """A predicted species' codex state and how many new entries it is worth (0..1: the
    chance its colour is one you have not logged here). Colour unknown: by species."""
    if found is None:
        status = codex_status(index, species, region)
        return status, 0.0 if status == "logged" else 1.0
    states = [(codex_status(index, v.symbol, region), v.weight) for v in found]
    worth = sum(w for s, w in states if s != "logged")
    if worth <= 0:
        return "logged", 0.0
    return ("new" if any(s == "new" for s, _ in states) else "new_region"), worth

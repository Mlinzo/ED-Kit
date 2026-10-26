"""The chance of each candidate species of one genus on a body: one bio signal is one genus, so
when the rules leave several of its species, only one of them grows there.

A candidate weighs as often as Canonn logged it (all its colours together) on bodies with this
atmosphere and of this body type. The square root of that weight softens it: atmosphere and
body type are only part of what decides, and the raw counts are too sure of themselves.

Measured 2026-10-26 on 1,139 genera with two or more candidates where other players' finds on
Spansh name the species (bodies near Merope, Colonia, Sagittarius A*, Synuefe EN-H d11-96 and
HIP 19036): log loss 0.65 against 0.84 for equal shares. Of the candidates shown at 40-50 %,
45 % were the one; at 60-70 %, 67 %; at 80-90 %, 94 %. Best for Bacterium (Tela or Cerbrus in
a thin water atmosphere: 43 % / 57 %, observed 47 % / 53 % on 288 bodies), a little worse than
equal shares for Clypeus, Stratum and Concha, where the atmosphere does not tell the species
apart. Weighing the colour variant the body would give (its star class or material) instead of
the whole species made it worse (0.67), and so did gravity, temperature and pressure
histograms (coarse bins).

Data: app/data/species_odds.json, built by tools/species_odds.py from Canonn's biostats.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from app.exobio.engine import atmosphere_type
from app.models import BodyFacts

DATA = Path(__file__).resolve().parents[1] / "data" / "species_odds.json"
SOFTEN = 0.5  # weight ** SOFTEN: fitted on half of the measured finds, checked on the rest

_REPORTS: dict[str, dict] = json.loads(DATA.read_text("utf-8"))["species"]


def _weight(species: str, body: BodyFacts) -> float:
    item = _REPORTS.get(species)
    if item is None:
        return 0.0
    n = item["n"]
    w = float(n)
    atmosphere = atmosphere_type(body)
    if atmosphere is not None:
        w *= (item["atmospheres"].get(atmosphere, 0) + 0.5) / (n + 1)
    if body.planet_class:
        w *= (item["bodies"].get(body.planet_class, 0) + 0.5) / (n + 1)
    return w


def chances(species: Sequence[str], body: BodyFacts) -> dict[str, float] | None:
    """Each candidate's chance to be the one that grows on the body (they add up to 1), by
    species symbol; None when Canonn has no reports of one of them."""
    weights = {sp: _weight(sp, body) for sp in species}
    if not weights or min(weights.values()) <= 0:
        return None
    soft = {sp: w**SOFTEN for sp, w in weights.items()}
    total = sum(soft.values())
    return {sp: w / total for sp, w in soft.items()}

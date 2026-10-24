"""Codex colour variants: each colour of an Odyssey species is its own codex entry (per region).

The colour follows the class of the body's parent star (64 species) or a material on the body
(26). Canonn's observation statistics (biostats, checked 2026-10-19) back both: a star
variant's parent star has the variant's class in 97 % of the samples (median over 431
variants; the system's main star much less often), except past a Y dwarf: a body whose nearest
parent star is a Y dwarf takes the colour of the next star up (Y dwarfs give their own colour
in 1 % of 66,566 samples, T and L dwarfs in 87 % and 96 %; a player's seven samples around a Y
dwarf orbiting an F star all came out F, 2026-10-19). The material variants come in two
groups of six. Group A (antimony, polonium, ruthenium, technetium, tellurium, yttrium) never
share a body, so the one present decides. Group B (cadmium, mercury, molybdenum, niobium, tin,
tungsten) often do, and neither the largest share nor a fixed order decides between them (a
player's Fungoida Setisis came out Tin on a body with more molybdenum than tin): every group-B
material present is then a candidate. Legacy organisms have one entry each.

Data: app/data/codex_variants.json, built by tools/codex_variants.py from Canonn's codex
reference.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.exobio.engine import parent_stars, primary_star_class, star_class
from app.models import BodyFacts, SystemFacts

DATA = Path(__file__).resolve().parents[1] / "data" / "codex_variants.json"
_TABLE: dict[str, dict] = json.loads(DATA.read_text("utf-8"))["species"]
_SUFFIX = "_Name;"
_COLOURS = {
    f"{species[: -len(_SUFFIX)]}_{code}{_SUFFIX}".lower(): colour
    for species, info in _TABLE.items()
    for code, colour in info["colours"].items()
}


@dataclass(frozen=True, slots=True)
class Variant:
    symbol: str  # the codex entry, e.g. "$Codex_Ent_Aleoids_01_F_Name;"
    colour: str | None  # "Teal"; None for an organism without colours
    weight: float  # the chance it is this one: a body's candidates add up to 1


def variant_symbol(species: str, code: str) -> str:
    return f"{species[: -len(_SUFFIX)]}_{code}{_SUFFIX}"


def colour_of(symbol: str | None) -> str | None:
    """The colour of a variant symbol (a journal ScanOrganic `Variant`), None if it has none."""
    return _COLOURS.get(symbol.lower()) if symbol else None


def colour_star_class(body: BodyFacts, system: SystemFacts) -> str | None:
    """Class of the star that colours the body's life: the nearest parent star, but past Y
    dwarfs; with only Y dwarfs above the body, the system's main star. None when a star on the
    way is not known."""
    seen = False
    for star in parent_stars(body, system):
        seen = True
        cls = star_class(star.star_type) if star is not None else None
        if cls != "Y":
            return cls
    return primary_star_class(system) if seen else None


def variants(species: str, body: BodyFacts, system: SystemFacts) -> list[Variant] | None:
    """The codex entries this species would be on the body, with their chances; None when the
    colour cannot be told (the parent star or the materials unknown, or a star class this
    species has no colour for)."""
    info = _TABLE.get(species)
    if info is None:
        return [Variant(species, None, 1.0)]
    colours: dict[str, str] = info["colours"]
    if info["by"] == "star":
        cls = colour_star_class(body, system)
        if cls is None or cls not in colours:
            return None
        return [Variant(variant_symbol(species, cls), colours[cls], 1.0)]
    present = {name.lower() for name, share in body.materials.items() if share and share > 0}
    codes = sorted(code for code in colours if code.lower() in present)
    if not codes:
        return None
    return [Variant(variant_symbol(species, c), colours[c], 1.0 / len(codes)) for c in codes]

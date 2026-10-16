"""Matching engine: evaluates the rule table in `rules.py` against scanned body facts.

Each species has one or more alternative `Condition`s (usually one per atmosphere type)
plus species-wide constraints (parent star class, galactic region, ...). Every check is
three-valued:

    PASS     the fact is known and satisfies the constraint
    UNKNOWN  the fact is missing (region not seen yet, star not scanned, ...) or the
             constraint cannot be verified from the journal at all (nebula proximity)
    FAIL     the fact is known and violates the constraint

A condition takes the worst result of its checks; a species takes the best result of
its conditions, combined with its species-wide checks. PASS becomes confidence
"likely", UNKNOWN becomes "possible", FAIL drops the species.

Units: gravity is compared in g (`BodyFacts.gravity_g`), pressure in atmospheres
(`BodyFacts.pressure_atm`), temperature in Kelvin.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import IntEnum

from app.exobio.regions import ALL_REGIONS, region_key
from app.models import BodyFacts, SystemFacts

Range = tuple[float | None, float | None]
ANY_RANGE: Range = (None, None)


class Result(IntEnum):
    FAIL = 0
    UNKNOWN = 1
    PASS = 2


@dataclass(slots=True, frozen=True)
class Condition:
    """One set of surface conditions under which a species grows (all must hold).

    atmospheres: journal `AtmosphereType` values; None means any, including none.
    bodies: journal `PlanetClass` values; None means any.
    volcanism: tokens; "none" accepts a body without volcanism, "any" accepts any
        volcanism, other tokens are substrings of the journal volcanism text
        ("water" matches "major water geysers volcanism"). "rare" turns a mismatch
        into UNKNOWN instead of FAIL: the species is far less common there but has
        been logged (e.g. "no volcanism" species with ~0.1-1% of samples on volcanic
        bodies). None means no constraint.
    min_so2_percent: minimum SulphurDioxide share in `AtmosphereComposition`.
    min_distance_ls: minimum distance from the arrival star, light seconds.
    """

    atmospheres: frozenset[str] | None
    bodies: frozenset[str] | None = None
    gravity_g: Range = ANY_RANGE
    temperature_k: Range = ANY_RANGE
    pressure_atm: Range = ANY_RANGE
    volcanism: frozenset[str] | None = None
    min_so2_percent: float | None = None
    min_distance_ls: float | None = None


@dataclass(slots=True, frozen=True)
class SpeciesRule:
    """All prediction constraints for one species.

    parent_stars: star classes (see `star_class`) of the star the body orbits. Derived
        from the colour variants that exist for star-coloured species: a species has no
        variant, and does not grow, around the other classes.
    rare_parent_stars: classes without a colour variant where the species has still
        been logged often enough not to be noise (>= ~0.1% of samples); a body there
        gets "possible" instead of being dropped.
    primary_stars: star classes of the system's main star.
    regions: codex region keys (`regions.region_key`) where the species grows.
    systems: lower-case system names the species is unique to.
    unverifiable: a requirement the journal cannot confirm (e.g. "nebula"); caps the
        confidence at "possible".
    legacy: pre-Odyssey organism; predicted only when DSS confirms its genus, and may
        grow on bodies without atmosphere.
    """

    conditions: tuple[Condition, ...]
    parent_stars: frozenset[str] | None = None
    rare_parent_stars: frozenset[str] | None = None
    primary_stars: frozenset[str] | None = None
    regions: frozenset[str] | None = None
    systems: frozenset[str] | None = None
    unverifiable: str | None = None
    legacy: bool = False


# --- normalisation -------------------------------------------------------------------

# Star classes that have codex colour variants. A star outside this set (black hole,
# carbon star, exotic, ...) cannot be checked against variant lists.
VARIANT_STAR_CLASSES = frozenset(
    {"O", "B", "A", "F", "G", "K", "M", "L", "T", "Y", "TTS", "Ae", "W", "D", "N"}
)
_CARBON_S = {"C", "CN", "CJ", "CH", "CHd", "MS", "S"}


def star_class(star_type: str | None) -> str | None:
    """Collapse a journal `StarType` to the class used by codex variants.

    "DA"/"DBV"/... -> "D", "WN"/"WC"/... -> "W", "AeBe" -> "Ae", "K_OrangeGiant" -> "K",
    "M_RedSuperGiant" -> "M", "SupermassiveBlackHole" -> "H", carbon/S stars -> "CS".
    """
    if not star_type:
        return None
    st = star_type.strip()
    if st in ("TTS", "AeBe"):
        return "TTS" if st == "TTS" else "Ae"
    if st in ("H", "SupermassiveBlackHole"):
        return "H"
    if st in _CARBON_S:
        return "CS"
    if "_" in st:  # giants and supergiants: "A_BlueWhiteSuperGiant"
        st = st.split("_", 1)[0]
    if st.startswith("D"):  # white dwarfs: D, DA, DAB, DAZ, DB, DC, DQ, ...
        return "D"
    if st.startswith("W"):
        return "W"
    return st


_ATMOSPHERE_WORDS = re.compile(r"\b(hot|thin|thick|atmosphere)\b")
_ATMOSPHERE_ALIASES = {
    "sulfur dioxide": "SulphurDioxide",
    "sulphur dioxide": "SulphurDioxide",
    "ammonia and oxygen": "AmmoniaOxygen",
    "suitable for water based life": "EarthLike",
    "earth like": "EarthLike",
}


def atmosphere_type(body: BodyFacts) -> str | None:
    """Journal-style atmosphere type ("CarbonDioxide"), "" if airless, None if unknown.

    Falls back to parsing the descriptive `Atmosphere` text when `AtmosphereType` is
    missing (older journals).
    """
    at = body.atmosphere_type
    if at is not None:
        return "" if at in ("", "None") else at
    text = body.atmosphere
    if text is None:
        return None
    words = _ATMOSPHERE_WORDS.sub(" ", text.lower().replace("-", " "))
    words = " ".join(words.split())
    if not words or words == "no":
        return ""
    rich = words.endswith(" rich")
    if rich:
        words = words[: -len(" rich")]
    name = _ATMOSPHERE_ALIASES.get(words) or "".join(w.capitalize() for w in words.split())
    return name + ("Rich" if rich else "")


def volcanism_text(body: BodyFacts) -> str | None:
    """Lower-case volcanism description, "" for none, None if unknown."""
    v = body.volcanism
    if v is None:
        return None
    v = v.strip().lower()
    return "" if v in ("", "none", "no volcanism") else v


def parent_star_class(body: BodyFacts, system: SystemFacts) -> str | None:
    """Class of the nearest star in the body's `Parents` chain, None if not known."""
    for kind, body_id in body.parents:
        if kind == "Star":
            star = system.bodies.get(body_id)
            return star_class(star.star_type) if star is not None else None
    return None


def primary_star_class(system: SystemFacts) -> str | None:
    main = system.bodies.get(0)
    if main is not None and main.kind == "star":
        return star_class(main.star_type)
    for star in system.stars():
        if star.distance_ls == 0:
            return star_class(star.star_type)
    return None


# --- checks ----------------------------------------------------------------------------


def _in_range(value: float | None, bounds: Range) -> Result:
    lo, hi = bounds
    if lo is None and hi is None:
        return Result.PASS
    if value is None:
        return Result.UNKNOWN
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        return Result.FAIL
    return Result.PASS


def _member(value: str | None, allowed: frozenset[str] | None) -> Result:
    if allowed is None:
        return Result.PASS
    if value is None:
        return Result.UNKNOWN
    return Result.PASS if value in allowed else Result.FAIL


VOLC_RARE = "rare"  # volcanism token: a mismatch gives UNKNOWN instead of FAIL
_VOLC_KEYWORDS = frozenset({"none", "any", VOLC_RARE})


def _volcanism(text: str | None, allowed: frozenset[str] | None) -> Result:
    if allowed is None:
        return Result.PASS
    if text is None:
        return Result.UNKNOWN
    if text == "":
        ok = "none" in allowed
    else:
        ok = "any" in allowed or any(tok in text for tok in allowed - _VOLC_KEYWORDS)
    if ok:
        return Result.PASS
    return Result.UNKNOWN if VOLC_RARE in allowed else Result.FAIL


def _system(ctx: BodyContext, allowed: frozenset[str] | None) -> Result:
    """System-unique species. Without a system name, the body name prefix decides
    (bodies are named "<system> <designation>")."""
    if allowed is None:
        return Result.PASS
    if ctx.system is not None:
        return Result.PASS if ctx.system in allowed else Result.FAIL
    name = ctx.body_name
    if any(name == s or name.startswith(s + " ") for s in allowed):
        return Result.PASS
    return Result.FAIL if name else Result.UNKNOWN


def _star(
    cls: str | None, allowed: frozenset[str] | None, rare: frozenset[str] | None = None
) -> Result:
    if allowed is None or (cls is not None and cls in allowed):
        return Result.PASS
    if cls is None or cls not in VARIANT_STAR_CLASSES or (rare is not None and cls in rare):
        return Result.UNKNOWN
    return Result.FAIL


@dataclass(slots=True)
class BodyContext:
    """Facts extracted once per body and shared by all species checks."""

    atmosphere: str | None
    planet_class: str | None
    gravity_g: float | None
    temperature_k: float | None
    pressure_atm: float | None
    volcanism: str | None
    so2_percent: float | None
    distance_ls: float | None
    parent_star: str | None
    primary_star: str | None
    region: str | None
    system: str | None
    body_name: str

    @classmethod
    def build(cls, body: BodyFacts, system: SystemFacts) -> BodyContext:
        comp = body.atmosphere_composition
        atmosphere = atmosphere_type(body)
        if comp:
            so2: float | None = comp.get("SulphurDioxide", 0.0)
        elif atmosphere == "":
            so2 = 0.0
        else:
            so2 = None
        return cls(
            atmosphere=atmosphere,
            planet_class=body.planet_class,
            gravity_g=body.gravity_g,
            temperature_k=body.surface_temperature,
            pressure_atm=body.pressure_atm,
            volcanism=volcanism_text(body),
            so2_percent=so2,
            distance_ls=body.distance_ls,
            parent_star=parent_star_class(body, system),
            primary_star=primary_star_class(system),
            region=_known_region(system.region),
            system=system.name.lower() if system.name else None,
            body_name=(body.name or "").lower(),
        )


def _known_region(name: str | None) -> str | None:
    """Region key, or None when the name is not an English codex region name or symbol
    (a localised client writes e.g. Russian names into `Region_Localised`)."""
    key = region_key(name)
    return key if key in ALL_REGIONS else None


def check_condition(ctx: BodyContext, cond: Condition) -> Result:
    results = (
        _member(ctx.atmosphere, cond.atmospheres),
        _member(ctx.planet_class, cond.bodies),
        _in_range(ctx.gravity_g, cond.gravity_g),
        _in_range(ctx.temperature_k, cond.temperature_k),
        _in_range(ctx.pressure_atm, cond.pressure_atm),
        _volcanism(ctx.volcanism, cond.volcanism),
        _in_range(ctx.so2_percent, (cond.min_so2_percent, None)),
        _in_range(ctx.distance_ls, (cond.min_distance_ls, None)),
    )
    return min(results)


def check_species(ctx: BodyContext, rule: SpeciesRule) -> Result:
    best = max((check_condition(ctx, c) for c in rule.conditions), default=Result.FAIL)
    if best == Result.FAIL:
        return best
    results = [
        best,
        _star(ctx.parent_star, rule.parent_stars, rule.rare_parent_stars),
        _star(ctx.primary_star, rule.primary_stars),
        _member(ctx.region, rule.regions),
        _system(ctx, rule.systems),
    ]
    if rule.unverifiable:
        results.append(Result.UNKNOWN)
    return min(results)


def widen(cond: Condition, factor: float) -> Condition:
    """Copy of `cond` with numeric ranges widened by `factor` of their span (fallback)."""

    def w(bounds: Range, span_floor: float) -> Range:
        lo, hi = bounds
        if lo is None and hi is None:
            return bounds
        span = max((hi - lo) if lo is not None and hi is not None else 0.0, span_floor)
        return (
            None if lo is None else lo - span * factor,
            None if hi is None else hi + span * factor,
        )

    return Condition(
        atmospheres=cond.atmospheres,
        bodies=cond.bodies,
        gravity_g=w(cond.gravity_g, 0.1),
        temperature_k=w(cond.temperature_k, 20.0),
        pressure_atm=w(cond.pressure_atm, 0.01),
        volcanism=cond.volcanism,
        min_so2_percent=None,
        min_distance_ls=None,
    )

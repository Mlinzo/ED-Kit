"""Universal Cartographics value estimates for scanned bodies.

Public API (used by views; keep the signature stable):

    estimate_body_value(body, odyssey=True) -> BodyValue

Sources
-------
* MattG, "Exploration value formulae", Frontier forums thread 232000, first post as
  updated Sep 2022 (post-3.3 constants, mapping multipliers, Odyssey mapping bonus,
  honk bonus, the "bubble bodies" note and a table of reference values):
  https://forums.frontier.co.uk/threads/exploration-value-formulae.232000/
* Two independent implementations of the same thread, both Apache-2.0, agree on every
  constant used here (k per class, q, 0.2, 66.25, 10/3, 8.0956, 3.699622554, 1.25,
  +max(30 %, 555), 2.6, 500): EDDiscovery ``EliteDangerousCore/.../EstimatedValues.cs``
  and EDDI ``DataDefinitions/Body.cs``. No code was copied from either.
* EDMC-Pioneer (GPL-2.0; read for facts only): the honk value is ``value / 3`` per
  body (planets at least 500) and is carried by the main star's data.
* Frontier, 3.3 "Beyond - Chapter Four" patch notes: "A credit bonus will be awarded for
  players that get either 100% first discovered or 100% first mapped in a system".
* Journal manual appendix (elite-journal.readthedocs.io) for the StarType codes.
* Validated against real ``MultiSellExplorationData`` events (see tests/test_values.py):
  white dwarf, ordinary stars, every planet class except ammonia / metal-rich, the
  terraforming k values, both mapping cases (efficient and not) and the discovery share.

Where the sources disagree
--------------------------
* 500 Cr floor: EDDiscovery applies it before the mapping multipliers; MattG, EDDI and
  Pioneer after. MattG's reference table (small icy body mapped = 2 262 Cr) needs "after".
* ``Terraformed`` bodies: EDDI pays the full terraforming bonus, Pioneer allows 0 %; the
  real sale of Fomalhaut "Conversion" is exact (+3 Cr) only with no bonus.
* Natural Earth-likes (``TerraformState == ""``): EDDI pays no terraforming bonus; the
  sale with HIP 11728 1 and 31 Arietis B 1 is exact (+6 Cr) only with the full bonus.
* Terraformable metal-rich bodies: EDDiscovery adds k 65 631 (its own unconfirmed
  scaling), EDDI and Pioneer add nothing. None were ever sold here; no bonus is applied.
* Bubble bodies (``WasDiscovered`` false, ``WasMapped`` true): MattG gives the 2.6 bonus
  but no Odyssey mapping bonus (followed here); EDDI gives neither ("applied
  haphazardly"); EDDiscovery gives the Odyssey bonus but not 2.6. Unverified.
* Supermassive black hole k: EDDiscovery / EDDI use 33.5678 (3.2 value scaled by 5/12,
  "not confirmed in game"); Pioneer has no special case.

How a Universal Cartographics sale is built (per system)
--------------------------------------------------------
1. Each sold body pays its scan value: ``k + k * q * mass^0.2`` for planets,
   ``k + mass * k / 66.25`` for stars, with mapping multipliers when surface-mapped.
2. The arrival star (distance 0 Ls) additionally carries a *discovery share* for every
   other body in the system: ``max(500, base / 3)`` per planet, ``base / 3`` per star,
   nothing for belt clusters. MattG and Pioneer call it the "honk bonus", but the real
   sales show it is paid for all bodies in the system, scanned or not, also in systems
   where no FSS discovery scan ("honk") was ever made (e.g. Piscium Sector CM-L a8-2).
   That it needs the arrival star's own data in the same sale is inferred from the one
   such case (Gamma Doradus after a respawn in the system) and from Pioneer.
3. A system-wide bonus for being 100 % first discoverer or first mapper (3.3 patch
   notes). It is not per body and is not estimated here; none of the validated sales
   qualified (every body was already discovered), and the ``Bonus`` field was always 0.

``BodyValue.fss`` / ``BodyValue.dss`` include the body's discovery share, so summing them
over a fully scanned system reproduces the sale. The bare scan value is
``scan_payout()``, the share alone is ``discovery_share()``.

Findings from the validation that the forum post does not state
---------------------------------------------------------------
* ``TerraformState == "Terraformed"`` bodies (bubble ELWs) get no terraforming bonus;
  ``Terraforming`` bodies get it (HIP 52351 A 2, sale exact to 4 Cr).
* A Scan written right after mapping can report ``WasMapped: false`` for a body an
  earlier Scan reported as mapped; the earlier ``true`` is the one the payout follows.
* The terraforming bonus is a hidden per-body scale (EDDI: "Terraformability is a scale
  from 0-100%"; forum posters found 35 discrete k levels for HMCs); the journal does not
  expose it. This module assumes 100 % (the maximum), so estimates for such bodies are
  upper bounds. In the validation every terraformable HMC whose share could be isolated
  got 100 %; the shortfalls were on water worlds at 381-390 K or 418 atm (Uelliodhino 5
  7 %, Gamma Doradus D 1 14 %, Ross 298 5 57 %) and on an Earth-like with argon in its
  atmosphere (TRAPPIST-1 4, 26 %). Too few points to model.
"""

from __future__ import annotations

import math

from app.models import BodyFacts, BodyValue

# --- constants (MattG, Sep 2022) -------------------------------------------------------

PLANET_Q = 0.56591828  # planets: k + k * q * mass^0.2
PLANET_MASS_EXPONENT = 0.2
STAR_MASS_DIVISOR = 66.25  # stars: k + mass * k / 66.25

FIRST_DISCOVERY_MULTIPLIER = 2.6
MAPPED_MULTIPLIER = 3.3333333333  # mapped, but someone else mapped it first
FIRST_MAPPED_MULTIPLIER = 8.0956  # first to map a body discovered by someone else
FIRST_DISCOVERED_AND_MAPPED_MULTIPLIER = 3.699622554  # applied before the 2.6 FD bonus
EFFICIENCY_MULTIPLIER = 1.25  # probes used <= efficiency target
ODYSSEY_MAPPING_BONUS = 0.3  # extra 30 % of the mapped value ...
ODYSSEY_MAPPING_MIN_BONUS = 555  # ... or 555 Cr, whichever is higher
MIN_BODY_VALUE = 500  # floor for a planet's payout (before the FD multiplier)
DISCOVERY_SHARE_FRACTION = 1 / 3  # share of a body's base value carried by the arrival star

STAR_K_DEFAULT = 1200
STAR_K_WHITE_DWARF = 14057
STAR_K_NEUTRON_OR_BLACK_HOLE = 22628
STAR_K_SUPERMASSIVE_BLACK_HOLE = 33.5678  # scaled from 3.2 data; not confirmed in game

# Planet class (journal PlanetClass, lower-case) -> (base k, terraformable k).
# A terraformable k of 0 means no terraforming bonus is known for the class.
_EVERYTHING_ELSE_K = (300, 93328)
PLANET_K: dict[str, tuple[int, int]] = {
    "metal rich body": (21790, 0),
    "high metal content body": (9654, 100677),
    "rocky body": _EVERYTHING_ELSE_K,
    "icy body": _EVERYTHING_ELSE_K,
    "rocky ice body": _EVERYTHING_ELSE_K,
    "earthlike body": (64831, 116295),
    "water world": (64831, 116295),
    "ammonia world": (96932, 0),
    "sudarsky class i gas giant": (1656, 0),
    "sudarsky class ii gas giant": (9654, 0),
    "sudarsky class iii gas giant": (300, 0),
    "sudarsky class iv gas giant": (300, 0),
    "sudarsky class v gas giant": (300, 0),
    "gas giant with water based life": (300, 0),
    "gas giant with ammonia based life": (300, 0),
    "helium rich gas giant": (300, 0),
    "helium gas giant": (300, 0),
    "water giant": (300, 0),
    "water giant with life": (300, 0),
}

# Fallback masses when a scan lacks MassEM: median masses per class from MattG's table.
TYPICAL_PLANET_MASS_EM: dict[str, float] = {
    "metal rich body": 0.323933,
    "high metal content body": 0.344919,
    "rocky body": 0.003359,
    "icy body": 0.01854,
    "rocky ice body": 0.180686,
    "earthlike body": 0.498039,
    "water world": 0.780638,
    "ammonia world": 0.43914,
    "sudarsky class i gas giant": 69.55164,
    "sudarsky class ii gas giant": 476.2409,
    "sudarsky class iii gas giant": 1148.922,
    "sudarsky class iv gas giant": 2615.635,
    "sudarsky class v gas giant": 925.5758,
    "gas giant with water based life": 477.0018,
    "gas giant with ammonia based life": 170.4551,
    "helium rich gas giant": 550.1418,
    "helium gas giant": 550.1418,
    "water giant": 47.16377,
    "water giant with life": 47.16377,
}
TYPICAL_TERRAFORMABLE_MASS_EM: dict[str, float] = {
    "water world": 0.453011,
    "high metal content body": 0.466929,
    "rocky body": 0.142312,
}
DEFAULT_PLANET_MASS_EM = 1.0  # unknown class (EDDiscovery uses the same default)
DEFAULT_STELLAR_MASS = 1.0  # solar masses; the mass term barely moves star values

_TERRAFORM_BONUS_STATES = ("Terraformable", "Terraforming")


# --- helpers ---------------------------------------------------------------------------


def _positive(value: float | None) -> float | None:
    """Return a usable positive finite number, else None (keeps fractional powers real)."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _planet_class_key(body: BodyFacts) -> str:
    return (body.planet_class or "").strip().lower()


def _is_star(body: BodyFacts) -> bool:
    if body.kind == "star":
        return True
    if body.kind == "planet":
        return False
    return bool(body.star_type) and not body.planet_class


def is_first_discovery(body: BodyFacts) -> bool:
    return body.was_discovered is False


def is_first_mapping(body: BodyFacts) -> bool:
    return not _is_star(body) and body.was_mapped is False


def is_arrival_star(body: BodyFacts) -> bool:
    """The star you arrive at: it carries the system's discovery shares."""
    return _is_star(body) and body.distance_ls is not None and body.distance_ls == 0


def gets_terraform_bonus(body: BodyFacts) -> bool:
    """Terraformable or terraforming bodies, and natural Earth-likes.

    Already terraformed worlds get no bonus (verified against real sales).
    """
    state = body.terraform_state or ""
    if state in _TERRAFORM_BONUS_STATES:
        return True
    return _planet_class_key(body) == "earthlike body" and state != "Terraformed"


def star_k(star_type: str | None) -> float:
    """k for a journal StarType code (journal manual appendix lists every code).

    White dwarfs are the only codes starting with "D"; every other code (main sequence,
    TTS, AeBe, Wolf-Rayet W*, carbon C*, S, MS, giants, X, ...) uses the default k.
    """
    st = (star_type or "").strip()
    if st.lower() == "supermassiveblackhole":  # journal: "SupermassiveBlackHole"
        return STAR_K_SUPERMASSIVE_BLACK_HOLE
    if st in ("N", "H"):
        return STAR_K_NEUTRON_OR_BLACK_HOLE
    if st.startswith("D"):  # D, DA, DAB, DAO, DAZ, DAV, DB, DBZ, DBV, DO, DOV, DQ, DC, DCV, DX
        return STAR_K_WHITE_DWARF
    return STAR_K_DEFAULT


def planet_k(body: BodyFacts, terraform_fraction: float = 1.0) -> float:
    base_k, terraform_k = PLANET_K.get(_planet_class_key(body), _EVERYTHING_ELSE_K)
    if gets_terraform_bonus(body):
        return base_k + terraform_k * terraform_fraction
    return base_k


def _planet_mass(body: BodyFacts) -> float:
    mass = _positive(body.mass_em)
    if mass is not None:
        return mass
    key = _planet_class_key(body)
    if gets_terraform_bonus(body) and key in TYPICAL_TERRAFORMABLE_MASS_EM:
        return TYPICAL_TERRAFORMABLE_MASS_EM[key]
    return TYPICAL_PLANET_MASS_EM.get(key, DEFAULT_PLANET_MASS_EM)


def base_value(body: BodyFacts, terraform_fraction: float = 1.0) -> float:
    """Unmapped scan value before the 500 Cr floor and the first-discovery multiplier.

    ``terraform_fraction`` (0..1) scales the terraforming bonus; the game applies a hidden
    per-body fraction, estimates use 1.0 (maximum).
    """
    if _is_star(body):
        k = star_k(body.star_type)
        mass = _positive(body.stellar_mass) or DEFAULT_STELLAR_MASS
        return k + mass * k / STAR_MASS_DIVISOR
    k = planet_k(body, terraform_fraction)
    return k + k * PLANET_Q * _planet_mass(body) ** PLANET_MASS_EXPONENT


def scan_payout(
    body: BodyFacts,
    *,
    mapped: bool = False,
    efficient: bool = True,
    odyssey: bool = True,
    terraform_fraction: float = 1.0,
) -> float:
    """What Universal Cartographics pays for this body's own data, without its discovery share.

    Mirrors MattG's GetBodyValue. Stars cannot be mapped, so ``mapped`` is ignored for them.
    """
    first_discovery = is_first_discovery(body)
    value = base_value(body, terraform_fraction)
    if _is_star(body):
        return value * FIRST_DISCOVERY_MULTIPLIER if first_discovery else value

    if mapped:
        first_mapping = is_first_mapping(body)
        if first_discovery and first_mapping:
            multiplier = FIRST_DISCOVERED_AND_MAPPED_MULTIPLIER
        elif first_mapping:
            multiplier = FIRST_MAPPED_MULTIPLIER
        else:
            multiplier = MAPPED_MULTIPLIER
        # MattG: bubble bodies with no discoverer but a first mapper (WasDiscovered false,
        # WasMapped true) get the first-discovery bonus but no Odyssey mapping bonus.
        odyssey_bonus = odyssey and not (first_discovery and body.was_mapped is True)
        value *= multiplier
        if odyssey_bonus:
            value += max(value * ODYSSEY_MAPPING_BONUS, ODYSSEY_MAPPING_MIN_BONUS)
        if efficient:
            value *= EFFICIENCY_MULTIPLIER

    value = max(MIN_BODY_VALUE, value)
    return value * FIRST_DISCOVERY_MULTIPLIER if first_discovery else value


def discovery_share(body: BodyFacts, terraform_fraction: float = 1.0) -> float:
    """This body's contribution to the arrival star's payout (MattG's "honk bonus").

    Paid whenever the arrival star's data is sold, whether or not this body was scanned.
    Zero for the arrival star itself.
    """
    if is_arrival_star(body):
        return 0.0
    share = base_value(body, terraform_fraction) * DISCOVERY_SHARE_FRACTION
    if not _is_star(body):
        share = max(MIN_BODY_VALUE, share)
    return share * FIRST_DISCOVERY_MULTIPLIER if is_first_discovery(body) else share


def estimate_body_value(body: BodyFacts, odyssey: bool = True, efficient: bool = True) -> BodyValue:
    """Estimated payout for one body, including its discovery share; never raises.

    ``fss``: sold after an FSS / detailed scan. ``dss``: sold after surface mapping (equal to
    ``fss`` for stars); ``efficient`` says whether the probe target was met (x1.25), which
    is only known once the body has been mapped. Terraformable bodies assume the full
    terraforming bonus, so their estimates are upper bounds.
    """
    first_discovery = is_first_discovery(body)
    first_mapping = is_first_mapping(body)
    try:
        share = discovery_share(body)
        fss = scan_payout(body, mapped=False, odyssey=odyssey) + share
        if _is_star(body):
            dss = fss
        else:
            dss = scan_payout(body, mapped=True, efficient=efficient, odyssey=odyssey) + share
    except Exception:  # defensive: a value estimate must never break a view
        return BodyValue(fss=0, dss=0, first_discovery=first_discovery, first_mapping=first_mapping)
    return BodyValue(
        fss=round(fss),
        dss=round(dss),
        first_discovery=first_discovery,
        first_mapping=first_mapping,
    )

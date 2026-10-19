"""Exobiology catalog and species prediction.

Public API (used by the projector and views — keep signatures stable):

    get_species(symbol)  -> Species | None   # by codex species symbol
    get_genus(symbol)    -> GenusInfo | None # by codex genus symbol
    predict(body, system, genuses=None) -> list[Prediction]
    genus_ranges(predictions, genuses, skip) / range_total(ranges, slots)  # value estimates
    deduced_genera(predictions, signals, known) -> set[str]  # sure before DSS
    FIRST_FOOTFALL_MULTIPLIER

Modules: `catalog` (names, values, colony ranges), `rules` (where each species grows),
`engine` (rule matching), `regions` (codex regions and galactic arm groups).
Sources: SOURCES.md in this package.
"""

from __future__ import annotations

from collections.abc import Iterable

from app.exobio.catalog import (
    GENERA,
    LEGACY_GENERA,
    SPECIES,
    SPECIES_BY_CODE,
    SPECIES_BY_GENUS,
    GenusInfo,
    lookup_genus,
    lookup_species,
)
from app.exobio.engine import (
    BodyContext,
    Result,
    SpeciesRule,
    check_condition,
    check_species,
    widen,
)
from app.exobio.rules import RULES
from app.models import BodyFacts, Prediction, Species, SystemFacts

__all__ = [
    "FIRST_FOOTFALL_MULTIPLIER",
    "GENERA",
    "SPECIES",
    "GenusInfo",
    "deduced_genera",
    "genus_ranges",
    "get_genus",
    "get_species",
    "predict",
    "range_total",
]

# Total payout factor when the species is the first logged on a body nobody has set foot
# on before: Vista Genomics pays base x 5. In `SellOrganicData` this shows up as
# `Value` = base and `Bonus` = 4 x base. The bonus is not paid in populated systems.
FIRST_FOOTFALL_MULTIPLIER = 5

_ENTRIES: tuple[tuple[Species, SpeciesRule], ...] = tuple(
    (SPECIES_BY_CODE[code], rule) for code, rule in RULES.items()
)


def get_species(symbol: str) -> Species | None:
    """Catalog entry by codex species symbol (variant symbols resolve to their species)."""
    return lookup_species(symbol)


def get_genus(symbol: str) -> GenusInfo | None:
    return lookup_genus(symbol)


def genus_ranges(
    predictions: Iterable[Prediction],
    genuses: Iterable[str],
    skip: Iterable[str] = (),
) -> dict[str, tuple[int, int]]:
    """(min, max) base value per genus that may still be found on a body: the predicted
    species, plus confirmed genera none of whose species matched (their whole range).
    `skip`: genera already accounted for (e.g. sampled)."""
    skipped = set(skip)
    ranges: dict[str, tuple[int, int]] = {}
    for p in predictions:
        sp = p.species
        if sp.genus in skipped:
            continue
        lo, hi = ranges.get(sp.genus, (sp.base_value, sp.base_value))
        ranges[sp.genus] = (min(lo, sp.base_value), max(hi, sp.base_value))
    for genus in set(genuses) - skipped - ranges.keys():
        info = get_genus(genus)
        if info is not None:
            ranges[genus] = (info.min_value, info.max_value)
    return ranges


def deduced_genera(
    predictions: Iterable[Prediction], signals: int, known: Iterable[str] = ()
) -> set[str]:
    """Genera surely on a body before DSS: when the genera that can grow there are exactly as
    many as its biological signals, every one of them is there (one signal is one genus).
    `predictions`: made without DSS genera; `known`: genera sampled there already. Empty
    while there is a choice.

    Pre-Odyssey organisms are not predicted before DSS, so one of them can hide behind the
    conclusion. Measured on 6977 Spansh bodies with DSS genera from 12 parts of the galaxy
    (2026-10-19): the rule applied to 2250 of them and was wrong once (Crystalline Shards
    where a Bacterium was expected). Counting the pre-Odyssey genera too was never wrong but
    applied to 482 only: their rules are loose.
    """
    genera = {p.species.genus for p in predictions} | set(known)
    return genera if signals > 0 and len(genera) == signals else set()


def range_total(ranges: dict[str, tuple[int, int]], slots: int) -> tuple[int, int]:
    """Pessimistic and optimistic total for `slots` genera (one bio signal is one genus)."""
    mins = sorted(lo for lo, _ in ranges.values())[: max(slots, 0)]
    maxs = sorted((hi for _, hi in ranges.values()), reverse=True)[: max(slots, 0)]
    return sum(mins), sum(maxs)


def predict(
    body: BodyFacts, system: SystemFacts, genuses: set[str] | None = None
) -> list[Prediction]:
    """Species that may grow on `body`, most certain and most valuable first.

    `genuses`: codex genus symbols confirmed by DSS (SAASignalsFound). When given,
    only species of these genera are returned (an empty set means DSS found no life).
    If a confirmed genus matches none of its species' rules, its species are still
    returned as "possible", best matches first, since the genus is known to be there.

    Only landable planets with a thin atmosphere get Odyssey species. Legacy organisms
    (brain trees, anemones, ...) also grow on airless bodies; they are predicted only
    once DSS confirms their genus.
    """
    if body.kind != "planet" or not body.landable:
        return []
    genus_filter = _canonical_genera(genuses)
    if genus_filter is not None and not genus_filter:
        return []

    ctx = BodyContext.build(body, system)
    airless = ctx.atmosphere == ""
    predictions: list[Prediction] = []
    if ctx.atmosphere is not None:
        for species, rule in _ENTRIES:
            if genus_filter is not None and species.genus not in genus_filter:
                continue
            if rule.legacy and genus_filter is None:
                continue
            if airless and not rule.legacy:
                continue
            result = check_species(ctx, rule)
            if result != Result.FAIL:
                conf = "likely" if result == Result.PASS else "possible"
                predictions.append(Prediction(species=species, confidence=conf))

    if genus_filter:
        found = {p.species.genus for p in predictions}
        for genus in sorted(genus_filter - found):
            if airless and genus not in LEGACY_GENERA:
                continue
            predictions.extend(_fallback(ctx, genus))

    predictions.sort(key=_sort_key)
    return predictions


def _canonical_genera(genuses: set[str] | None) -> set[str] | None:
    if genuses is None:
        return None
    out = set()
    for symbol in genuses:
        info = lookup_genus(symbol)
        if info is not None:
            out.add(info.genus)
    return out


def _fallback(ctx: BodyContext, genus: str) -> list[Prediction]:
    """Species of a DSS-confirmed genus when none passed the rules, all "possible".

    Tries, in order: numeric ranges widened by 25% (ignoring star, region and SO2
    constraints); then any condition with the body's atmosphere type; then the whole
    genus.
    """
    members = [(sp, rule) for sp, rule in _ENTRIES if sp.genus == genus]
    relaxed = [
        sp
        for sp, rule in members
        if any(check_condition(ctx, widen(c, 0.25)) != Result.FAIL for c in rule.conditions)
    ]
    if not relaxed and ctx.atmosphere is not None:
        relaxed = [
            sp
            for sp, rule in members
            if any(
                c.atmospheres is None or ctx.atmosphere in c.atmospheres for c in rule.conditions
            )
        ]
    if not relaxed:
        relaxed = [sp for sp, _ in members] or list(SPECIES_BY_GENUS.get(genus, ()))
    return [Prediction(species=sp, confidence="possible") for sp in relaxed]


def _sort_key(p: Prediction) -> tuple[int, int, str]:
    return (0 if p.confidence == "likely" else 1, -p.species.base_value, p.species.species_name)

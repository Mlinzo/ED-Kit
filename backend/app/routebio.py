"""Exobiology value of bodies found by a Spansh body search (route planning).

Spansh knows a body's biological signal count from other commanders' FSS scans and, when
someone mapped it, the genera from DSS. The species are predicted here from the body's
physical facts, like for your own scans; the estimate is a (min, max) range of base values
(the first-footfall bonus is not assumed: nobody can tell whether someone landed there).

For codex routes the same predictions become codex entries (a species' colour variant, from
the parent star or the body's materials) with the chance of each being there: a genus
confirmed by DSS counts fully, one only predicted at half weight and shared among the
signals left; the candidate species of a genus share it equally, and so do the candidate
colours of a species.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app import enrich, exobio
from app.exobio import catalog
from app.exobio.variants import Variant, variants
from app.models import BodyFacts, G, Prediction, SystemFacts

ATM_PA = 101_325.0
UNCONFIRMED_GENUS = 0.5  # weight of a genus predicted but not confirmed by DSS


def _genus_keys() -> dict[str, str]:
    """Spansh genus name (lower case) -> codex genus symbol. Spansh writes the codex label
    ("Shrubs", "Cactoids", "Bark Mounds"); the symbols differ in places ("Cactoid", "Cone")."""
    keys: dict[str, str] = {}
    for symbol, info in catalog.GENERA.items():
        core = re.sub(r"^\$Codex_Ent_|(_Genus)?_Name;$", "", symbol).replace("_", " ").lower()
        name = info.genus_name.lower()
        for key in (core, core + "s", name, name + "s"):
            keys.setdefault(key, symbol)
    return keys


_GENUS_BY_NAME = _genus_keys()


def genus_symbol(name: str) -> str | None:
    return _GENUS_BY_NAME.get(name.strip().lower())


def _num(raw: dict[str, Any], key: str, scale: float = 1.0) -> float | None:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) * scale


def _gas(name: str) -> str:
    """'Sulphur dioxide' -> 'SulphurDioxide' (journal spelling, used by the rules)."""
    return "".join(word[:1].upper() + word[1:] for word in name.replace("-", " ").split())


_PARENT_KINDS = {"Star": "Star", "Planet": "Planet", "Null": "Null"}


def facts_from_search(raw: dict[str, Any]) -> tuple[BodyFacts, SystemFacts] | None:
    """A Spansh body search result as journal-like facts, with its parent stars as the
    system (enough for the prediction rules)."""
    try:
        address = int(raw["system_id64"])
        body_id = int(raw["id64"]) >> 55
    except (KeyError, TypeError, ValueError):
        return None
    system = SystemFacts(
        address=address,
        name=str(raw.get("system_name") or ""),
        region=raw.get("system_region"),
    )
    parents: list[tuple[str, int]] = []
    for parent in raw.get("parents") or []:
        if not isinstance(parent, dict) or parent.get("type") not in _PARENT_KINDS:
            continue
        try:
            parent_id = int(parent["id64"]) >> 55
        except (KeyError, TypeError, ValueError):
            continue
        parents.append((_PARENT_KINDS[parent["type"]], parent_id))
        if parent["type"] == "Star":
            star_type, subclass = enrich._star_type({"subType": parent.get("subtype")})
            system.bodies[parent_id] = BodyFacts(
                system_address=address,
                body_id=parent_id,
                name="",
                kind="star",
                source="spansh",
                star_type=star_type,
                star_subclass=subclass,
            )
    volcanism = raw.get("volcanism_type")
    body = BodyFacts(
        system_address=address,
        body_id=body_id,
        name=str(raw.get("name") or ""),
        kind="planet",
        source="spansh",
        distance_ls=_num(raw, "distance_to_arrival"),
        parents=parents,
        planet_class=enrich.PLANET_CLASSES.get(
            str(raw.get("subtype") or "").lower(), raw.get("subtype")
        ),
        atmosphere=enrich._atmosphere({"atmosphereType": raw.get("atmosphere")}),
        atmosphere_composition={
            _gas(str(c["name"])): float(c.get("share") or 0.0)
            for c in raw.get("atmosphere_composition") or []
            if isinstance(c, dict) and c.get("name")
        },
        # null: not reported (older records), unlike "No volcanism"
        volcanism=None if volcanism is None else enrich._volcanism({"volcanismType": volcanism}),
        surface_gravity=_num(raw, "gravity", G),
        surface_temperature=_num(raw, "surface_temperature"),
        surface_pressure=_num(raw, "surface_pressure", ATM_PA),
        landable=bool(raw.get("is_landable")),
        materials={
            str(m["name"]): float(m.get("share") or 0.0)
            for m in raw.get("materials") or []
            if isinstance(m, dict) and m.get("name")
        },
    )
    system.bodies[body_id] = body
    return body, system


def bio_signals(raw: dict[str, Any]) -> int:
    for signal in raw.get("signals") or []:
        if isinstance(signal, dict) and signal.get("name") == "Biological":
            return int(signal.get("count") or 0)
    return 0


@dataclass(slots=True, frozen=True)
class CodexChance:
    """A codex entry the body may give, and the chance it does (0..1)."""

    key: str  # a colour variant symbol, or the species symbol when the colour cannot be told
    species: str  # species symbol
    colour: str | None
    weight: float


@dataclass(slots=True, frozen=True)
class BioEstimate:
    signals: int
    low: int  # pessimistic total base value of the species on the body
    high: int  # optimistic
    genuses: tuple[str, ...]  # codex genus symbols confirmed by DSS (may be empty)
    entries: tuple[CodexChance, ...] = ()  # every codex entry predicted (logged or not)


def estimate(raw: dict[str, Any]) -> BioEstimate | None:
    """Value range of a body's biology; None without biological signals."""
    signals = bio_signals(raw)
    if signals <= 0:
        return None
    converted = facts_from_search(raw)
    if converted is None:
        return None
    body, system = converted
    genuses = {
        symbol
        for g in raw.get("genuses") or []
        if isinstance(g, dict) and (symbol := genus_symbol(str(g.get("name") or "")))
    }
    predictions = exobio.predict(body, system, genuses or None)
    ranges = exobio.genus_ranges(predictions, genuses)
    low, high = exobio.range_total(ranges, max(signals, len(genuses)))
    return BioEstimate(
        signals=signals,
        low=low,
        high=high,
        genuses=tuple(sorted(genuses)),
        entries=codex_chances(predictions, body, system, genuses, signals),
    )


def codex_chances(
    predictions: list[Prediction],
    body: BodyFacts,
    system: SystemFacts,
    genuses: set[str],
    signals: int,
) -> tuple[CodexChance, ...]:
    """The codex entries the predicted species stand for, with their chances."""
    by_genus: dict[str, list[Prediction]] = {}
    for p in predictions:
        by_genus.setdefault(p.species.genus, []).append(p)
    unconfirmed = [g for g in by_genus if g not in genuses]
    open_slots = max(max(signals, len(genuses)) - len(genuses), 0)
    share = min(1.0, open_slots / len(unconfirmed)) if unconfirmed else 0.0
    out: list[CodexChance] = []
    for genus, preds in by_genus.items():
        genus_weight = 1.0 if genus in genuses else UNCONFIRMED_GENUS * share
        for p in preds:
            symbol = p.species.species
            found = variants(symbol, body, system) or [Variant(symbol, None, 1.0)]
            for v in found:
                weight = genus_weight / len(preds) * v.weight
                if weight > 0:
                    out.append(CodexChance(v.symbol, symbol, v.colour, weight))
    return tuple(out)

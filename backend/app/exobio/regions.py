"""Galactic codex regions and the arm groupings used by regional species.

The journal names a region in `CodexEntry` events, either as a symbol
(`"Region": "$Codex_RegionName_18;"`) or a localised name (`"Inner Orion Spur"`).
Both forms are accepted by `region_key()`.

Arm groups are the sets of codex regions where arm-limited species have been logged,
taken from Canonn's per-species region observations (see SOURCES.md). They match the
community description of Odyssey regional species by galactic arm: a region that an
arm crosses belongs to that arm's group, so the core regions (Galactic Centre,
Odin's Hold, Inner Orion Spur, ...) appear in several groups.
"""

from __future__ import annotations

import re

# Codex region names; index + 1 is the number in "$Codex_RegionName_<n>;".
CODEX_REGIONS: tuple[str, ...] = (
    "Galactic Centre",  # 1
    "Empyrean Straits",
    "Ryker's Hope",
    "Odin's Hold",
    "Norma Arm",  # 5
    "Arcadian Stream",
    "Izanami",
    "Inner Orion-Perseus Conflux",
    "Inner Scutum-Centaurus Arm",
    "Norma Expanse",  # 10
    "Trojan Belt",
    "The Veils",
    "Newton's Vault",
    "The Conduit",
    "Outer Orion-Perseus Conflux",  # 15
    "Orion-Cygnus Arm",
    "Temple",
    "Inner Orion Spur",
    "Hawking's Gap",
    "Dryman's Point",  # 20
    "Sagittarius-Carina Arm",
    "Mare Somnia",
    "Acheron",
    "Formorian Frontier",
    "Hieronymus Delta",  # 25
    "Outer Scutum-Centaurus Arm",
    "Outer Arm",
    "Aquila's Halo",
    "Errant Marches",
    "Perseus Arm",  # 30
    "The Formidine Rift",
    "Vulcan Gate",
    "Elysian Shore",
    "Sanguineous Rim",
    "Outer Orion Spur",  # 35
    "Achilles's Altar",
    "Xibalba",
    "Lyra's Song",
    "Tenebrae",
    "The Abyss",  # 40
    "Kepler's Crest",
    "The Void",
)

_SYMBOL_RE = re.compile(r"^\$Codex_RegionName_(\d+);?$", re.IGNORECASE)


def region_key(name: str | None) -> str | None:
    """Normalised comparison key for a region name or `$Codex_RegionName_<n>;` symbol.

    Case, apostrophes, hyphens and a leading "The" are ignored, so "Achilles' Altar",
    "Achilles's Altar" and "achilles s altar" compare equal.
    """
    if not name:
        return None
    match = _SYMBOL_RE.match(name.strip())
    if match:
        index = int(match.group(1))
        if not 1 <= index <= len(CODEX_REGIONS):
            return None
        name = CODEX_REGIONS[index - 1]
    key = name.lower().replace("'s ", " ").replace("' ", " ").replace("'", "")
    key = re.sub(r"[^a-z0-9]+", " ", key).strip()
    if key.startswith("the "):
        key = key[4:]
    return key or None


def region_name(name_or_symbol: str | None) -> str | None:
    """Canonical English region name for a name or symbol, or None if unknown."""
    key = region_key(name_or_symbol)
    return _BY_KEY.get(key) if key else None


_BY_KEY: dict[str, str] = {region_key(n): n for n in CODEX_REGIONS}  # type: ignore[misc]


def regions(*names: str) -> frozenset[str]:
    """Build a set of region keys, failing loudly on a typo."""
    keys = set()
    for n in names:
        key = region_key(n)
        if key not in _BY_KEY:
            raise ValueError(f"unknown codex region: {n!r}")
        keys.add(key)
    return frozenset(keys)


ALL_REGIONS = regions(*CODEX_REGIONS)

ORION_CYGNUS = regions(
    "Galactic Centre",
    "Odin's Hold",
    "Izanami",
    "Inner Orion-Perseus Conflux",
    "Orion-Cygnus Arm",
    "Temple",
    "Inner Orion Spur",
    "Outer Orion Spur",
)
SAGITTARIUS_CARINA = regions(
    "Galactic Centre",
    "Odin's Hold",
    "Inner Scutum-Centaurus Arm",
    "Inner Orion Spur",
    "Hawking's Gap",
    "Dryman's Point",
    "Sagittarius-Carina Arm",
    "Mare Somnia",
    "Acheron",
    "The Abyss",
)
SCUTUM_CENTAURUS = regions(
    "Galactic Centre",
    "Odin's Hold",
    "Inner Scutum-Centaurus Arm",
    "Norma Expanse",
    "Trojan Belt",
    "The Veils",
    "Formorian Frontier",
    "Hieronymus Delta",
    "Outer Scutum-Centaurus Arm",
    "The Void",
    "Aquila's Halo",
)
OUTER = regions(
    "Galactic Centre",
    "Empyrean Straits",
    "Norma Arm",
    "Arcadian Stream",
    "Newton's Vault",
    "The Conduit",
    "Outer Arm",
    "Errant Marches",
    "The Formidine Rift",
    "Kepler's Crest",
    "Xibalba",
)
PERSEUS = regions(
    "Galactic Centre",
    "Ryker's Hope",
    "Izanami",
    "Outer Orion-Perseus Conflux",
    "Perseus Arm",
    "Vulcan Gate",
    "Elysian Shore",
    "Sanguineous Rim",
    "Achilles's Altar",
    "Lyra's Song",
    "Tenebrae",
)

# "Core" variants: an arm group without the shared central regions.
_CENTRE = regions("Galactic Centre", "Odin's Hold")
ORION_CYGNUS_CORE = ORION_CYGNUS - _CENTRE
SAGITTARIUS_CARINA_CORE = SAGITTARIUS_CARINA - _CENTRE
SCUTUM_CENTAURUS_CORE = SCUTUM_CENTAURUS - _CENTRE
PERSEUS_CORE = PERSEUS - regions("Galactic Centre")

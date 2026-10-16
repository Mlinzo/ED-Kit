"""Catalog lookups, values, colony ranges and the rule table's consistency."""

from __future__ import annotations

import pytest

from app.exobio import FIRST_FOOTFALL_MULTIPLIER, GenusInfo, get_genus, get_species
from app.exobio.catalog import GENERA, LEGACY_GENERA, SPECIES, SPECIES_BY_CODE, SPECIES_BY_GENUS
from app.exobio.engine import atmosphere_type, star_class
from app.exobio.regions import CODEX_REGIONS, region_key, region_name
from app.exobio.rules import RULES
from app.models import BodyFacts

ODYSSEY_GENERA = {
    "$Codex_Ent_Aleoids_Genus_Name;": ("Aleoida", 150, 5),
    "$Codex_Ent_Bacterial_Genus_Name;": ("Bacterium", 500, 13),
    "$Codex_Ent_Cactoid_Genus_Name;": ("Cactoida", 300, 5),
    "$Codex_Ent_Clypeus_Genus_Name;": ("Clypeus", 150, 3),
    "$Codex_Ent_Conchas_Genus_Name;": ("Concha", 150, 4),
    "$Codex_Ent_Electricae_Genus_Name;": ("Electricae", 1000, 2),
    "$Codex_Ent_Fonticulus_Genus_Name;": ("Fonticulua", 500, 6),
    "$Codex_Ent_Fumerolas_Genus_Name;": ("Fumerola", 100, 4),
    "$Codex_Ent_Fungoids_Genus_Name;": ("Fungoida", 300, 4),
    "$Codex_Ent_Osseus_Genus_Name;": ("Osseus", 800, 6),
    "$Codex_Ent_Recepta_Genus_Name;": ("Recepta", 150, 3),
    "$Codex_Ent_Shrubs_Genus_Name;": ("Frutexa", 150, 7),
    "$Codex_Ent_Stratum_Genus_Name;": ("Stratum", 500, 8),
    "$Codex_Ent_Tubus_Genus_Name;": ("Tubus", 800, 5),
    "$Codex_Ent_Tussocks_Genus_Name;": ("Tussock", 200, 15),
}


def test_species_by_symbol() -> None:
    sp = get_species("$Codex_Ent_Bacterial_01_Name;")
    assert sp is not None
    assert sp.species_name == "Bacterium Aurasus"
    assert sp.genus == "$Codex_Ent_Bacterial_Genus_Name;"
    assert sp.genus_name == "Bacterium"
    assert sp.base_value == 1_000_000  # matches SellOrganicData in the player's journal
    assert sp.colony_range_m == 500


def test_species_by_variant_symbol_and_case() -> None:
    assert get_species("$Codex_Ent_Bacterial_12_G_Name;").species_name == "Bacterium Cerbrus"
    assert get_species("$Codex_Ent_Aleoids_01_TTS_Name;").species_name == "Aleoida Arcus"
    assert get_species("$codex_ent_stratum_07_name;").species_name == "Stratum Tectonicas"


@pytest.mark.parametrize("symbol", ["", "$Codex_Ent_Nope_01_Name;", "Bacterium Aurasus"])
def test_unknown_species(symbol: str) -> None:
    assert get_species(symbol) is None


def test_genus_lookup() -> None:
    info = get_genus("$Codex_Ent_Shrubs_Genus_Name;")
    assert isinstance(info, GenusInfo)
    assert info.genus_name == "Frutexa"
    assert info.colony_range_m == 150
    assert (info.min_value, info.max_value) == (1_632_500, 10_326_000)
    bacterium = get_genus("$Codex_Ent_Bacterial_Genus_Name;")
    assert (bacterium.min_value, bacterium.max_value) == (1_000_000, 8_418_000)
    assert get_genus("$Codex_Ent_Nope_Genus_Name;") is None
    assert get_genus("") is None


@pytest.mark.parametrize(("symbol", "expected"), ODYSSEY_GENERA.items())
def test_odyssey_genera(symbol: str, expected: tuple[str, int, int]) -> None:
    name, colony, count = expected
    info = get_genus(symbol)
    assert info is not None, symbol
    assert (info.genus_name, info.colony_range_m) == (name, colony)
    assert len(SPECIES_BY_GENUS[symbol]) == count
    assert all(s.colony_range_m == colony for s in SPECIES_BY_GENUS[symbol])


def test_legacy_and_unique_genera() -> None:
    assert {GENERA[g].genus_name for g in LEGACY_GENERA} == {
        "Amphora Plant",
        "Anemone",
        "Bark Mound",
        "Brain Tree",
        "Crystalline Shards",
        "Sinuous Tubers",
    }
    assert all(GENERA[g].colony_range_m == 100 for g in LEGACY_GENERA)
    # Legacy genera reuse a species-like symbol: the genus and one species share it.
    assert get_genus("$Codex_Ent_Sphere_Name;").genus_name == "Anemone"
    assert get_species("$Codex_Ent_Sphere_Name;").species_name == "Luteolum Anemone"
    assert get_species("$Codex_Ent_Seed_Name;").genus == "$Codex_Ent_Brancae_Name;"
    radicoida = get_species("$Codex_Ent_Ingensradices_Unicus_Name;")
    assert radicoida.genus == "$Codex_Ent_Ingensradices_Genus_Name;"
    assert radicoida.base_value == 119_037


def test_catalog_size_and_values() -> None:
    assert len(GENERA) == 22
    assert len(SPECIES) == 118  # 90 Odyssey + Radicoida + 27 legacy
    assert sum(len(v) for v in SPECIES_BY_GENUS.values()) == len(SPECIES)
    assert all(s.base_value > 0 for s in SPECIES.values())
    top = max(SPECIES.values(), key=lambda s: s.base_value)
    assert (top.species_name, top.base_value) == ("Fonticulua Fluctus", 20_000_000)
    assert get_species("$Codex_Ent_Stratum_07_Name;").base_value == 19_010_800
    assert get_species("$Codex_Ent_Bacterial_12_Name;").base_value == 1_689_800


def test_every_species_has_rules() -> None:
    assert set(RULES) == set(SPECIES_BY_CODE)
    for code, rule in RULES.items():
        assert rule.conditions, code
        legacy = SPECIES_BY_CODE[code].genus in LEGACY_GENERA
        assert rule.legacy == legacy, code
        for cond in rule.conditions:
            for lo, hi in (cond.gravity_g, cond.temperature_k, cond.pressure_atm):
                assert lo is None or hi is None or lo < hi, code
            if not legacy:  # Odyssey species need an atmosphere
                assert cond.atmospheres, code
        if rule.rare_parent_stars is not None:  # "possible" classes only refine a star set
            assert rule.parent_stars is not None, code
            assert not rule.rare_parent_stars & rule.parent_stars, code


def test_first_footfall_multiplier() -> None:
    # SellOrganicData reports Value = base and Bonus = 4 x base when first logged.
    assert FIRST_FOOTFALL_MULTIPLIER == 5


@pytest.mark.parametrize(
    ("star_type", "cls"),
    [
        ("G", "G"),
        ("K_OrangeGiant", "K"),
        ("M_RedSuperGiant", "M"),
        ("DA", "D"),
        ("DQ", "D"),
        ("WNC", "W"),
        ("AeBe", "Ae"),
        ("TTS", "TTS"),
        ("N", "N"),
        ("H", "H"),
        ("SupermassiveBlackHole", "H"),
        ("CN", "CS"),
        ("MS", "CS"),
        (None, None),
    ],
)
def test_star_class(star_type: str | None, cls: str | None) -> None:
    assert star_class(star_type) == cls


@pytest.mark.parametrize(
    ("atype", "text", "expected"),
    [
        ("CarbonDioxide", "thin carbon dioxide atmosphere", "CarbonDioxide"),
        ("None", "", ""),
        ("", "", ""),
        (None, "thin sulfur dioxide atmosphere", "SulphurDioxide"),
        (None, "hot thin carbon dioxide rich atmosphere", "CarbonDioxideRich"),
        (None, "thin argon rich atmosphere", "ArgonRich"),
        (None, "", ""),
        (None, None, None),
    ],
)
def test_atmosphere_type(atype: str | None, text: str | None, expected: str | None) -> None:
    body = BodyFacts(1, 1, "X 1", "planet", atmosphere_type=atype, atmosphere=text)
    assert atmosphere_type(body) == expected


def test_region_keys() -> None:
    assert len(CODEX_REGIONS) == 42
    assert region_key("$Codex_RegionName_18;") == region_key("Inner Orion Spur")
    assert region_key("Achilles' Altar") == region_key("Achilles's Altar")
    assert region_key("Formidine Rift") == region_key("The Formidine Rift")
    assert region_name("$Codex_RegionName_42;") == "The Void"
    assert region_name("$Codex_RegionName_99;") is None
    assert region_key(None) is None

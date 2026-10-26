"""Chances of the candidate species of one genus, from Canonn's report counts."""

from __future__ import annotations

import pytest

from app import views
from app.exobio.odds import chances
from app.models import BodyFacts, G, SystemFacts

TELA = "$Codex_Ent_Bacterial_07_Name;"
CERBRUS = "$Codex_Ent_Bacterial_12_Name;"
VESICULA = "$Codex_Ent_Bacterial_05_Name;"
BACTERIUM = "$Codex_Ent_Bacterial_Genus_Name;"


def moon(
    atmosphere: str,
    planet_class: str,
    g: float,
    temp: float,
    pressure_atm: float,
    **materials: float,
) -> tuple[BodyFacts, SystemFacts]:
    """A moon of a gas giant around a K giant, like HIP 19036 3 a."""
    system = SystemFacts(address=1, name="S", region="$Codex_RegionName_18;")
    system.bodies[0] = BodyFacts(1, 0, "S", "star", star_type="K_OrangeGiant", distance_ls=0.0)
    system.bodies[28] = BodyFacts(1, 28, "S 3", "planet", parents=[("Star", 0)])
    body = BodyFacts(
        system_address=1,
        body_id=31,
        name="S 3 a",
        kind="planet",
        parents=[("Planet", 28), ("Star", 0)],
        distance_ls=1958.0,
        planet_class=planet_class,
        atmosphere_type=atmosphere,
        atmosphere_composition={atmosphere: 100.0},
        volcanism="",
        surface_gravity=g * G,
        surface_temperature=temp,
        surface_pressure=pressure_atm * 101_325,
        landable=True,
        materials=materials,
    )
    system.bodies[31] = body
    return body, system


def test_tela_or_cerbrus_in_thin_water_is_about_even() -> None:
    # HIP 19036 3 a gave Tela, its twins 3 b and 3 c Cerbrus; on Spansh 47 % / 53 % of 288 such
    # bodies with finds.
    body, _ = moon("Water", "Rocky body", 0.044, 421.2, 0.0666)
    found = chances([TELA, CERBRUS], body)
    assert found is not None
    assert sum(found.values()) == pytest.approx(1.0)
    assert 0.35 < found[TELA] < 0.5 < found[CERBRUS] < 0.65


def test_the_atmosphere_can_all_but_decide() -> None:
    # Thin argon: Canonn logged Vesicula there thousands of times, Tela far less.
    body, _ = moon("Argon", "Icy body", 0.1, 80.0, 0.01)
    found = chances([VESICULA, TELA], body)
    assert found is not None and found[VESICULA] > 0.8


def test_no_chances_without_reports() -> None:
    body, _ = moon("Water", "Rocky body", 0.044, 421.2, 0.0666)
    assert chances([TELA, "$Codex_Ent_Unknown_99_Name;"], body) is None


def test_the_species_list_gives_each_candidate_its_chance() -> None:
    body, system = moon("Water", "Rocky body", 0.044, 421.2, 0.0666, Tin=1.18, Tungsten=1.08)
    found, *_ = views._build_species(body, system, {BACTERIUM}, [], 7, {})
    by_name = {v.species: v.chance for v in found}
    assert set(by_name) == {"Bacterium Tela", "Bacterium Cerbrus"}
    assert sum(by_name.values()) == pytest.approx(1.0)  # type: ignore[arg-type]

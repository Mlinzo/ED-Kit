"""Rule matching on synthetic bodies: units, constraints, confidence and genus filter."""

from __future__ import annotations

from app.exobio import deduced_genera, predict
from app.models import BodyFacts, G, SystemFacts

STAR_ID = 1
ADDRESS = 42
IOS = "Inner Orion Spur"


def make(
    *,
    planet_class: str = "Rocky body",
    atmosphere: str | None = "CarbonDioxide",
    g: float | None = 0.1,
    temp: float | None = 185.0,
    pressure_atm: float | None = 0.03,
    volcanism: str | None = "",
    star: str | None = "F",
    region: str | None = IOS,
    landable: bool = True,
    composition: dict[str, float] | None = None,
    distance_ls: float | None = 500.0,
    system_name: str = "Test System",
    parents: list[tuple[str, int]] | None = None,
) -> tuple[BodyFacts, SystemFacts]:
    """A body in natural units (g, atm); stored in journal units (m/s^2, Pa)."""
    system = SystemFacts(address=ADDRESS, name=system_name, region=region)
    if star is not None:
        system.bodies[STAR_ID] = BodyFacts(
            ADDRESS, STAR_ID, f"{system_name} A", "star", star_type=star, distance_ls=0.0
        )
    body = BodyFacts(
        system_address=ADDRESS,
        body_id=5,
        name=f"{system_name} A 1",
        kind="planet",
        parents=parents if parents is not None else [("Star", STAR_ID)],
        distance_ls=distance_ls,
        planet_class=planet_class,
        atmosphere_type=atmosphere,
        atmosphere_composition=composition or ({atmosphere: 100.0} if atmosphere else {}),
        volcanism=volcanism,
        surface_gravity=None if g is None else g * G,
        surface_temperature=temp,
        surface_pressure=None if pressure_atm is None else pressure_atm * 101_325,
        landable=landable,
    )
    system.bodies[body.body_id] = body
    return body, system


def names(preds) -> dict[str, str]:
    return {p.species.species_name: p.confidence for p in preds}


def test_no_bio_without_landing_or_atmosphere() -> None:
    assert predict(*make(landable=False)) == []
    assert predict(*make(atmosphere="None")) == []
    assert predict(*make(atmosphere="")) == []
    body, system = make()
    star = system.bodies[STAR_ID]
    assert predict(star, system) == []


def test_bacterium_aurasus_journal_case() -> None:
    # Col 285 Sector TT-H c10-4 A 8: HMC, thin CO2, 0.457 g, 241.5 K, G9 star.
    preds = predict(
        *make(
            planet_class="High metal content body",
            g=0.457,
            temp=241.5,
            pressure_atm=0.0062,
            star="G",
        )
    )
    assert names(preds) == {"Bacterium Aurasus": "likely"}


def test_units_gravity_in_g_pressure_in_atm() -> None:
    # Aleoida Coronamus: CO2, 180-190 K, P >= 0.025 atm, <= 0.276 g.
    assert "Aleoida Coronamus" in names(predict(*make(g=0.25, pressure_atm=0.03)))
    # surface_gravity is stored in m/s^2; the rules compare g, so 2.5 g must fail.
    assert "Aleoida Coronamus" not in names(predict(*make(g=2.5, pressure_atm=0.03)))
    # 0.03 Pa is ~3e-7 atm: below the pressure floor.
    assert "Aleoida Coronamus" not in names(predict(*make(pressure_atm=0.03 / 101_325)))


def test_temperature_ladder() -> None:
    assert "Aleoida Arcus" in names(predict(*make(temp=177.0, pressure_atm=0.02)))
    assert "Aleoida Arcus" not in names(predict(*make(temp=185.0)))
    assert "Aleoida Gravis" in names(predict(*make(temp=195.0, pressure_atm=0.06)))


def test_parent_star_class_from_variants() -> None:
    # Aleoida has no colour variant (and does not grow) around G stars.
    assert names(predict(*make(star="K")))["Aleoida Coronamus"] == "likely"
    assert "Aleoida Coronamus" not in names(predict(*make(star="G")))
    # Star not scanned yet: cannot check, keep as possible.
    assert names(predict(*make(star=None)))["Aleoida Coronamus"] == "possible"
    # Black holes have no variants at all: cannot check either.
    assert names(predict(*make(star="H")))["Aleoida Coronamus"] == "possible"
    # Osseus has no M variant, but 0.17% of Fractus samples orbit M stars: kept as
    # possible. Stratum around G is noise-level (<= 0.07%): dropped.
    on_m = names(predict(*make(star="M")))
    assert on_m["Osseus Fractus"] == "possible" and on_m["Bacterium Aurasus"] == "likely"
    assert names(predict(*make(star="K")))["Osseus Fractus"] == "likely"
    assert "Stratum Paleas" not in names(predict(*make(star="G")))
    # Tussock has no neutron-star variant, yet ~1-2% of samples orbit one.
    assert names(predict(*make(temp=185.0, star="N")))["Tussock Caputus"] == "likely"


def test_volcanism_rare_but_logged_gives_possible() -> None:
    # Stratum Tectonicas: 0.5% of Canonn samples are on volcanic bodies.
    hmc = dict(planet_class="High metal content body", g=0.4, temp=200, star="M")
    assert names(predict(*make(**hmc)))["Stratum Tectonicas"] == "likely"
    volcanic = names(predict(*make(**hmc, volcanism="minor metallic magma volcanism")))
    assert volcanic["Stratum Tectonicas"] == "possible"
    # Aleoida Coronamus: no volcanic samples at all, so a volcanic body drops it.
    quiet = dict(g=0.1, temp=185.0, pressure_atm=0.03, star="K")
    assert "Aleoida Coronamus" in names(predict(*make(**quiet)))
    loud = names(predict(*make(**quiet, volcanism="minor rocky magma volcanism")))
    assert "Aleoida Coronamus" not in loud


def test_region_constraint() -> None:
    in_orion = names(predict(*make(region=IOS)))
    assert in_orion["Cactoida Cortexum"] == "likely"
    assert "Cactoida Pullulanta" not in in_orion
    in_perseus = names(predict(*make(region="Perseus Arm")))
    assert in_perseus["Cactoida Pullulanta"] == "likely"
    assert "Cactoida Cortexum" not in in_perseus
    unknown = names(predict(*make(region=None)))
    assert unknown["Cactoida Cortexum"] == unknown["Cactoida Pullulanta"] == "possible"
    assert unknown["Aleoida Coronamus"] == "likely"  # not regional
    by_symbol = names(predict(*make(region="$Codex_RegionName_18;")))
    assert by_symbol["Cactoida Cortexum"] == "likely"
    # A localised (non-English) region name cannot be matched: treated as unknown.
    localised = names(predict(*make(region="Внутренний рукав Ориона")))
    assert localised["Cactoida Cortexum"] == localised["Cactoida Pullulanta"] == "possible"


def test_volcanism_requirements() -> None:
    neon = dict(planet_class="Icy body", atmosphere="Neon", g=0.4, temp=40, pressure_atm=0.002)
    quiet = names(predict(*make(**neon, volcanism="")))
    assert "Bacterium Acies" in quiet and "Bacterium Omentum" not in quiet
    active = names(predict(*make(**neon, volcanism="minor nitrogen magma volcanism")))
    assert active["Bacterium Omentum"] == "likely"
    assert predict(*make(**neon, volcanism=None))  # unknown volcanism keeps candidates
    assert names(predict(*make(**neon, volcanism=None)))["Bacterium Omentum"] == "possible"


def test_recepta_needs_sulphur_dioxide() -> None:
    so2 = dict(atmosphere="SulphurDioxide", g=0.1, temp=200, pressure_atm=0.005, star="K")
    assert "Recepta Umbrux" in names(predict(*make(**so2)))
    co2_pure = names(predict(*make(temp=170, composition={"CarbonDioxide": 100.0}, star="K")))
    assert "Recepta Umbrux" not in co2_pure
    co2_mix = {"CarbonDioxide": 98.5, "SulphurDioxide": 1.5}
    assert "Recepta Umbrux" in names(predict(*make(temp=170, composition=co2_mix, star="K")))


def test_distance_constraint() -> None:
    base = dict(temp=195.0, pressure_atm=0.06, star="F")
    assert names(predict(*make(**base, distance_ls=3000)))["Clypeus Speculumi"] == "likely"
    assert "Clypeus Speculumi" not in names(predict(*make(**base, distance_ls=500)))
    assert names(predict(*make(**base, distance_ls=None)))["Clypeus Speculumi"] == "possible"


def test_unverifiable_and_primary_star() -> None:
    argon = dict(planet_class="Icy body", atmosphere="Argon", g=0.2, temp=100, pressure_atm=0.02)
    on_m = names(predict(*make(**argon, star="M")))
    assert on_m["Electricae Radialem"] == "possible"  # nebula proximity
    assert "Electricae Pluma" not in on_m  # main star must be A / B / N / D / Ae / H / O
    assert names(predict(*make(**argon, star="A")))["Electricae Pluma"] == "likely"
    # A black-hole main star cannot be colour-checked, but Pluma is logged there (8%).
    assert names(predict(*make(**argon, star="H")))["Electricae Pluma"] == "likely"


def test_radicoida_only_in_hip_87621() -> None:
    hot = dict(atmosphere="CarbonDioxide", g=0.2, temp=500, pressure_atm=0.02)
    assert "Radicoida Unica" in names(predict(*make(**hot, system_name="HIP 87621")))
    assert "Radicoida Unica" not in names(predict(*make(**hot)))
    body, _ = make(**hot, system_name="HIP 87621")
    assert "Radicoida Unica" in names(predict(body, SystemFacts(1, "")))  # body name prefix


def test_genus_filter() -> None:
    body, system = make()
    cactoid = predict(body, system, {"$Codex_Ent_Cactoid_Genus_Name;"})
    assert cactoid and {p.species.genus_name for p in cactoid} == {"Cactoida"}
    assert predict(body, system, set()) == []  # DSS found no life
    assert predict(body, system, {"$Codex_Ent_Unknown_Genus_Name;"}) == []


def test_confirmed_genus_without_matching_rule_falls_back() -> None:
    # CO2 at 100 K matches no Bacterium rule, but DSS says Bacterium is there.
    body, system = make(temp=100.0)
    assert not any(p.species.genus_name == "Bacterium" for p in predict(body, system))
    preds = predict(body, system, {"$Codex_Ent_Bacterial_Genus_Name;"})
    assert preds and all(p.confidence == "possible" for p in preds)
    assert "Bacterium Aurasus" in names(preds)


def test_legacy_only_with_confirmed_genus() -> None:
    airless = dict(
        atmosphere="None", g=0.1, temp=300, volcanism="major silicate vapour geysers volcanism"
    )
    body, system = make(**airless)
    assert predict(body, system) == []
    trees = predict(body, system, {"$Codex_Ent_Brancae_Name;"})
    assert trees and {p.species.genus_name for p in trees} == {"Brain Tree"}
    assert "Gypseeum Brain Tree" in names(trees)
    # An Odyssey genus cannot be on an airless body.
    assert predict(body, system, {"$Codex_Ent_Bacterial_Genus_Name;"}) == []


def test_genera_deduced_when_they_fill_every_signal() -> None:
    # Thin neon at 40 K: only a Bacterium can grow there.
    body, system = make(
        planet_class="Icy body", atmosphere="Neon", temp=40, g=0.3, pressure_atm=0.002
    )
    preds = predict(body, system)
    bacterium = "$Codex_Ent_Bacterial_Genus_Name;"
    assert {p.species.genus for p in preds} == {bacterium}
    assert deduced_genera(preds, 1) == {bacterium}
    assert deduced_genera(preds, 2) == set()  # the rules miss a genus: no conclusion
    assert deduced_genera(preds, 0) == set()
    # A genus sampled there fills a signal too.
    shrubs = "$Codex_Ent_Shrubs_Genus_Name;"
    assert deduced_genera(preds, 2, {shrubs}) == {bacterium, shrubs}
    # More genera possible than signals: a choice left.
    assert deduced_genera(predict(*make()), 1) == set()


def test_sorted_likely_first_then_value() -> None:
    preds = predict(*make(region=None))
    confidences = [p.confidence for p in preds]
    assert confidences == sorted(confidences, key=lambda c: c != "likely")
    likely = [p.species.base_value for p in preds if p.confidence == "likely"]
    assert likely == sorted(likely, reverse=True)


def test_atmosphere_from_text_when_type_missing() -> None:
    body, system = make(
        planet_class="High metal content body", g=0.42, temp=260, pressure_atm=0.0024
    )
    body.atmosphere_type = None
    body.atmosphere = "thin sulfur dioxide atmosphere"
    body.atmosphere_composition = {}
    assert "Bacterium Cerbrus" in names(predict(body, system))

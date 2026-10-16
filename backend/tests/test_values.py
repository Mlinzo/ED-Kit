"""Tests for app.values: reference values, edge cases and a replay of real sales.

The replay reconstructs every `MultiSellExplorationData` event in the player's journal
folder (bodies scanned in the sold systems since the previous sale, mapped bodies from
`SAAScanComplete`, unsold data lost on `Died`) and compares the predicted payout with what
Universal Cartographics actually paid. It is skipped when the journal folder is missing.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from app.config import default_journal_dir
from app.models import BodyFacts
from app.values import (
    base_value,
    discovery_share,
    estimate_body_value,
    gets_terraform_bonus,
    is_arrival_star,
    scan_payout,
)

FIXTURE = Path(__file__).parent / "fixtures" / "values" / "journal_sales_context.json"


def planet(
    planet_class: str | None,
    mass_em: float | None,
    *,
    terraform_state: str | None = "",
    was_discovered: bool | None = True,
    was_mapped: bool | None = True,
    distance_ls: float | None = 500.0,
    body_id: int = 5,
) -> BodyFacts:
    return BodyFacts(
        system_address=1,
        body_id=body_id,
        name=f"Test {body_id}",
        kind="planet",
        distance_ls=distance_ls,
        was_discovered=was_discovered,
        was_mapped=was_mapped,
        planet_class=planet_class,
        terraform_state=terraform_state,
        mass_em=mass_em,
    )


def star(
    star_type: str | None,
    stellar_mass: float | None,
    *,
    distance_ls: float | None = 0.0,
    was_discovered: bool | None = True,
    body_id: int = 0,
) -> BodyFacts:
    return BodyFacts(
        system_address=1,
        body_id=body_id,
        name=f"Star {body_id}",
        kind="star",
        distance_ls=distance_ls,
        was_discovered=was_discovered,
        was_mapped=False,
        star_type=star_type,
        stellar_mass=stellar_mass,
    )


# --- reference values ------------------------------------------------------------------

# MattG, "Exploration value formulae" (Frontier forums thread 232000, Sep 2022): payouts at
# the median mass of each class. Columns: FSS, FSS + first discovery, FSS + DSS (efficient),
# FSS + DSS + first mapped, FSS + DSS + first discovered + first mapped.
FORUM_TABLE = [
    ("Ammonia world", "", 0.43914, (143463, 373004, 777091, 1887305, 2242455)),
    ("Earthlike body", "", 0.498039, (270290, 702753, 1464068, 3555753, 4224870)),
    ("Water world", "", 0.780638, (99747, 259343, 540297, 1312209, 1559138)),
    ("Water world", "Terraformable", 0.453011, (268616, 698400, 1455001, 3533732, 4198704)),
    ("High metal content body", "", 0.344919, (14070, 36581, 76211, 185092, 219923)),
    (
        "High metal content body",
        "Terraformable",
        0.466929,
        (163948, 426264, 888051, 2156792, 2562654),
    ),
    ("Metal rich body", "", 0.323933, (31632, 82244, 171342, 416136, 494443)),
    ("Icy body", "", 0.01854, (500, 1300, 2262, 4953, 6330)),
    ("Rocky body", "", 0.003359, (500, 1300, 2170, 4661, 6064)),
    ("Rocky body", "Terraformable", 0.142312, (129504, 336711, 701482, 1703675, 2024270)),
    ("Rocky ice body", "", 0.180686, (500, 1300, 2446, 5533, 6861)),
    ("Sudarsky class I gas giant", "", 69.55164, (3845, 9997, 20828, 50584, 60103)),
    ("Sudarsky class II gas giant", "", 476.2409, (28405, 73853, 153861, 373679, 443997)),
    ("Sudarsky class III gas giant", "", 1148.922, (995, 2587, 5389, 13088, 15551)),
    ("Sudarsky class IV gas giant", "", 2615.635, (1119, 2910, 6062, 14723, 17494)),
    ("Sudarsky class V gas giant", "", 925.5758, (966, 2510, 5230, 12702, 15092)),
    ("Gas giant with ammonia based life", "", 170.4551, (774, 2014, 4195, 10188, 12105)),
    ("Gas giant with water based life", "", 477.0018, (883, 2295, 4782, 11615, 13800)),
    ("Helium rich gas giant", "", 550.1418, (900, 2339, 4874, 11837, 14064)),
    ("Water giant", "", 47.16377, (667, 1734, 3613, 8774, 10425)),
]


@pytest.mark.parametrize(("planet_class", "terraform_state", "mass", "expected"), FORUM_TABLE)
def test_scan_payout_matches_forum_reference_table(
    planet_class: str, terraform_state: str, mass: float, expected: tuple[int, ...]
) -> None:
    def body(discovered: bool, mapped: bool) -> BodyFacts:
        return planet(
            planet_class,
            mass,
            terraform_state=terraform_state,
            was_discovered=discovered,
            was_mapped=mapped,
        )

    got = (
        scan_payout(body(True, True)),
        scan_payout(body(False, True)),
        scan_payout(body(True, True), mapped=True),
        scan_payout(body(True, False), mapped=True),
        scan_payout(body(False, False), mapped=True),
    )
    assert tuple(round(v) for v in got) == expected


def test_typical_high_value_worlds() -> None:
    elw = estimate_body_value(planet("Earthlike body", 1.0))
    ww = estimate_body_value(planet("Water world", 1.0))
    aw = estimate_body_value(planet("Ammonia world", 1.0))
    # 1 Earth mass, already discovered and mapped by others: scan value + 1/3 discovery share
    assert elw.fss == round(181126 * (1 + 0.56591828) * (1 + 1 / 3))  # 378 171
    assert ww.fss == round(64831 * (1 + 0.56591828) * (1 + 1 / 3))  # 135 360
    assert aw.fss == round(96932 * (1 + 0.56591828) * (1 + 1 / 3))  # 202 383
    # mapped with the efficiency bonus (x 10/3, +30 % Odyssey, x 1.25) plus the share
    assert elw.dss == pytest.approx(181126 * 1.56591828 * (10 / 3 * 1.3 * 1.25 + 1 / 3), abs=1)
    assert 1_600_000 < elw.dss < 1_650_000
    assert 550_000 < ww.dss < 600_000
    assert 800_000 < aw.dss < 900_000


def test_estimate_is_scan_payout_plus_discovery_share() -> None:
    body = planet("High metal content body", 0.8, terraform_state="Terraformable")
    value = estimate_body_value(body)
    share = discovery_share(body)
    assert share == pytest.approx(scan_payout(body) / 3)
    assert value.fss == round(scan_payout(body) + share)
    assert value.dss == round(scan_payout(body, mapped=True, efficient=True) + share)


# --- stars -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("star_type", "mass", "k"),
    [
        ("M", 0.4, 1200),
        ("K_OrangeGiant", 0.7, 1200),
        ("TTS", 0.3, 1200),
        ("DA", 0.6, 14057),
        ("DQ", 1.351563, 14057),
        ("N", 1.4, 22628),
        ("H", 8.0, 22628),
        ("SupermassiveBlackHole", 4_000_000.0, 33.5678),
    ],
)
def test_star_values_by_type(star_type: str, mass: float, k: float) -> None:
    expected = k + mass * k / 66.25
    arrival = estimate_body_value(star(star_type, mass))
    assert arrival.fss == arrival.dss == round(expected)  # arrival star: no share, no DSS
    assert arrival.first_mapping is False

    secondary = estimate_body_value(star(star_type, mass, distance_ls=1500.0, body_id=2))
    assert secondary.fss == secondary.dss == round(expected * 4 / 3)

    undiscovered = estimate_body_value(star(star_type, mass, was_discovered=False))
    assert undiscovered.first_discovery is True
    assert undiscovered.fss == round(expected * 2.6)


# Every StarType code in the journal manual appendix (elite-journal.readthedocs.io).
WHITE_DWARF_CODES = [
    "D",
    "DA",
    "DAB",
    "DAO",
    "DAZ",
    "DAV",
    "DB",
    "DBZ",
    "DBV",
    "DO",
    "DOV",
    "DQ",
    "DC",
    "DCV",
    "DX",
]
DEFAULT_K_CODES = [
    "O",
    "B",
    "A",
    "F",
    "G",
    "K",
    "M",
    "L",
    "T",
    "Y",
    "TTS",
    "AeBe",
    "W",
    "WN",
    "WNC",
    "WC",
    "WO",
    "CS",
    "C",
    "CN",
    "CJ",
    "CH",
    "CHd",
    "MS",
    "S",
    "X",
    "A_BlueWhiteSuperGiant",
    "B_BlueWhiteSuperGiant",
    "F_WhiteSuperGiant",
    "M_RedSuperGiant",
    "M_RedGiant",
    "K_OrangeGiant",
    "RoguePlanet",
    "Nebula",
    "StellarRemnantNebula",
]


@pytest.mark.parametrize(
    ("star_type", "k"),
    [(c, 14057) for c in WHITE_DWARF_CODES]
    + [(c, 1200) for c in DEFAULT_K_CODES]
    + [("N", 22628), ("H", 22628)]
    + [("SupermassiveBlackHole", 33.5678), ("SuperMassiveBlackHole", 33.5678)]
    + [("", 1200), (None, 1200), ("Q_FutureType", 1200)],
)
def test_every_journal_star_type_gets_a_k(star_type: str | None, k: float) -> None:
    body = star(star_type, 1.0)
    assert base_value(body) == pytest.approx(k + k / 66.25)
    value = estimate_body_value(body)
    assert value.fss == value.dss == round(k + k / 66.25)
    assert value.first_mapping is False


def test_real_sale_white_dwarf() -> None:
    """LAWD 15 (DQ, 1.351563 solar masses), sold 2026-10-15 15:00 in an exact sale."""
    assert round(scan_payout(star("DQ", 1.351563))) == 14344


def test_real_sale_three_brown_dwarfs() -> None:
    """Tarnkappe, sold 2026-10-11 for 4 405 Cr (Statistics.Exploration.Highest_Payout)."""
    bodies = [
        star("L", 0.132813, distance_ls=0.0, body_id=2),
        star("T", 0.078125, distance_ls=1.3, body_id=3),
        star("T", 0.070313, distance_ls=1.3, body_id=4),
    ]
    # the game rounds each body's value and the arrival star's share sum separately
    paid = sum(round(scan_payout(b)) for b in bodies) + round(sum(map(discovery_share, bodies)))
    assert paid == 4405
    assert abs(sum(estimate_body_value(b).fss for b in bodies) - 4405) <= 1


def test_real_sale_share_of_unscanned_bodies() -> None:
    """Piscium Sector CM-L a8-2: arrival T dwarf + 2 of its 9 icy bodies scanned; sold 6 712 Cr.

    The 7 unscanned icy bodies still add their 500 Cr discovery share.
    """
    arrival = star("T", 0.074219)
    scanned = [planet("Icy body", 2.958299, body_id=3), planet("Icy body", 1.965109, body_id=2)]
    unscanned_masses = [2.564191, 0.939729, 1.570131, 0.087157, 0.731062, 1.141399, 1.017263]
    unscanned = [planet("Icy body", m, body_id=10 + i) for i, m in enumerate(unscanned_masses)]
    total = sum(estimate_body_value(b).fss for b in [arrival, *scanned])
    total += sum(discovery_share(b) for b in unscanned)
    assert round(total) == 6712


# --- planets: flags, multipliers, terraforming -----------------------------------------


def test_first_discovery_and_mapping_flags_and_multipliers() -> None:
    known = planet("High metal content body", 0.5)
    first_mapped = planet("High metal content body", 0.5, was_mapped=False)
    pristine = planet("High metal content body", 0.5, was_discovered=False, was_mapped=False)

    assert estimate_body_value(known).first_discovery is False
    assert estimate_body_value(known).first_mapping is False
    assert estimate_body_value(first_mapped).first_mapping is True
    v = estimate_body_value(pristine)
    assert v.first_discovery is True and v.first_mapping is True

    base = scan_payout(known)
    assert scan_payout(pristine) == pytest.approx(base * 2.6)
    assert scan_payout(first_mapped, mapped=True, efficient=False) == pytest.approx(
        base * 8.0956 * 1.3
    )
    assert scan_payout(pristine, mapped=True, efficient=False) == pytest.approx(
        base * 3.699622554 * 1.3 * 2.6
    )
    assert estimate_body_value(pristine).dss > estimate_body_value(first_mapped).dss
    assert estimate_body_value(first_mapped).dss > estimate_body_value(known).dss


def test_efficiency_and_odyssey_bonuses() -> None:
    body = planet("Water world", 0.7)
    base = scan_payout(body)
    efficient = scan_payout(body, mapped=True, efficient=True)
    inefficient = scan_payout(body, mapped=True, efficient=False)
    horizons = scan_payout(body, mapped=True, efficient=True, odyssey=False)
    assert efficient == pytest.approx(inefficient * 1.25)
    assert efficient == pytest.approx(base * 10 / 3 * 1.3 * 1.25, rel=1e-9)
    assert horizons == pytest.approx(base * 10 / 3 * 1.25, rel=1e-9)
    assert estimate_body_value(body, odyssey=False).dss < estimate_body_value(body).dss
    assert estimate_body_value(body, odyssey=False).fss == estimate_body_value(body).fss


def test_odyssey_minimum_mapping_bonus_for_small_bodies() -> None:
    body = planet("Icy body", 0.01854)  # base 376 Cr -> mapped 1 255 Cr, 30 % of it < 555
    base = base_value(body)
    assert base * 10 / 3 * 0.3 < 555
    assert scan_payout(body, mapped=True, efficient=False) == pytest.approx(base * 10 / 3 + 555)


def test_bubble_body_without_discoverer_but_mapped() -> None:
    """MattG: WasDiscovered false + WasMapped true -> first-discovery bonus, no Odyssey 30 %."""
    body = planet("Water world", 0.7, was_discovered=False, was_mapped=True)
    known = planet("Water world", 0.7)
    assert scan_payout(body) == pytest.approx(scan_payout(known) * 2.6)
    assert scan_payout(body, mapped=True) == pytest.approx(
        scan_payout(known, mapped=True, odyssey=False) * 2.6
    )


@pytest.mark.parametrize(
    ("planet_class", "state", "bonus"),
    [
        ("Earthlike body", "", True),
        ("Earthlike body", None, True),
        ("Earthlike body", "Terraformed", False),  # e.g. Fomalhaut "Conversion"
        ("Water world", "Terraformable", True),
        ("Water world", "Terraforming", True),
        ("Water world", "Terraformed", False),
        ("Water world", "", False),
        ("High metal content body", "Terraformable", True),
        ("Rocky body", "Terraformable", True),
    ],
)
def test_terraforming_bonus(planet_class: str, state: str | None, bonus: bool) -> None:
    body = planet(planet_class, 0.5, terraform_state=state)
    assert gets_terraform_bonus(body) is bonus
    plain = planet(planet_class, 0.5, terraform_state="Terraformed")
    if bonus:
        assert scan_payout(body) > 2 * scan_payout(plain)
    else:
        assert scan_payout(body) == pytest.approx(scan_payout(plain))


def test_terraform_fraction_scales_only_the_bonus() -> None:
    body = planet("Water world", 0.6, terraform_state="Terraformable")
    none = scan_payout(body, terraform_fraction=0.0)
    full = scan_payout(body, terraform_fraction=1.0)
    half = scan_payout(body, terraform_fraction=0.5)
    assert none == pytest.approx(scan_payout(planet("Water world", 0.6)))
    assert half == pytest.approx((none + full) / 2)


def test_discovery_share_rules() -> None:
    assert discovery_share(star("M", 0.4)) == 0  # the arrival star carries the shares
    assert is_arrival_star(star("M", 0.4))
    assert not is_arrival_star(star("M", 0.4, distance_ls=None))
    assert discovery_share(planet("Icy body", 0.01)) == 500  # floor
    assert discovery_share(planet("Icy body", 0.01, was_discovered=False)) == 1300
    hmc = planet("High metal content body", 0.5)
    assert discovery_share(hmc) == pytest.approx(scan_payout(hmc) / 3)


# --- fallbacks -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        planet(None, None),
        planet("", float("nan")),
        planet("Some future body class", -3.0),
        planet("Water world", None, terraform_state=None, was_discovered=None, was_mapped=None),
        planet("Sudarsky class II gas giant", 0.0),
        star(None, None),
        star("", float("inf"), distance_ls=None),
        BodyFacts(system_address=1, body_id=9, name="odd", kind="planet"),
        BodyFacts(system_address=1, body_id=9, name="odd", kind="belt"),  # type: ignore[arg-type]
    ],
)
def test_missing_or_bad_data_never_raises(body: BodyFacts) -> None:
    value = estimate_body_value(body)
    assert value.fss >= 400 and value.dss >= value.fss
    assert isinstance(value.fss, int) and isinstance(value.dss, int)


def test_missing_mass_uses_typical_mass_for_the_class() -> None:
    gg2 = estimate_body_value(planet("Sudarsky class II gas giant", None))
    assert gg2.fss == estimate_body_value(planet("Sudarsky class II gas giant", 476.2409)).fss
    tww = planet("Water world", None, terraform_state="Terraformable")
    assert round(scan_payout(tww)) == 268616  # forum median for terraformable water worlds
    unknown = scan_payout(planet("Some future body class", None))
    assert unknown == 500


# --- replay of real Universal Cartographics sales --------------------------------------

SCAN_TYPES = {"AutoScan", "Detailed", "Basic", "NavBeacon", "NavBeaconDetail"}
TOLERANCE = 25  # credits per sale: the game rounds per body, we round per body too


def body_from_scan(ev: dict[str, Any]) -> BodyFacts | None:
    """Minimal journal Scan -> BodyFacts (None for belt clusters, which pay nothing)."""
    if "StarType" in ev:
        kind = "star"
    elif "PlanetClass" in ev:
        kind = "planet"
    else:
        return None
    return BodyFacts(
        system_address=ev["SystemAddress"],
        body_id=ev["BodyID"],
        name=ev.get("BodyName", ""),
        kind=kind,
        distance_ls=ev.get("DistanceFromArrivalLS"),
        was_discovered=ev.get("WasDiscovered"),
        was_mapped=ev.get("WasMapped"),
        star_type=ev.get("StarType"),
        stellar_mass=ev.get("StellarMass"),
        planet_class=ev.get("PlanetClass"),
        terraform_state=ev.get("TerraformState"),
        mass_em=ev.get("MassEM"),
    )


@dataclass
class SoldSystem:
    name: str
    address: int | None
    scans: dict[int, dict[str, Any]] = field(default_factory=dict)  # BodyID -> latest Scan
    efficient: dict[int, bool] = field(default_factory=dict)  # mapped BodyID -> target met


@dataclass
class Sale:
    timestamp: str
    base_value: int
    bonus: int
    total: int
    reported: list[tuple[str, int]]  # (SystemName, NumBodies) from the event
    systems: list[SoldSystem]


def journal_events(journal_dir: Path):
    for path in sorted(journal_dir.glob("Journal.*.log")):
        with path.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def reconstruct_sales(journal_dir: Path) -> list[Sale]:
    """Replay journals: unsold scans per system, cleared by sales and by death."""
    pending: dict[int, SoldSystem] = {}
    address_by_name: dict[str, int] = {}
    sales: list[Sale] = []
    for ev in journal_events(journal_dir):
        event = ev.get("event")
        if event in ("FSDJump", "Location", "CarrierJump") and ev.get("StarSystem"):
            address_by_name[ev["StarSystem"]] = ev.get("SystemAddress")
        elif event == "Scan" and ev.get("ScanType") in SCAN_TYPES and "SystemAddress" in ev:
            address = ev["SystemAddress"]
            name = ev.get("StarSystem") or ""
            if name:
                address_by_name[name] = address
            system = pending.setdefault(address, SoldSystem(name, address))
            old = system.scans.get(ev["BodyID"])
            if old is not None:
                # A Scan written after mapping sometimes says WasMapped false although an
                # earlier Scan of the same body said true; "true" is the reliable answer.
                for flag in ("WasDiscovered", "WasMapped"):
                    if old.get(flag) is True:
                        ev = {**ev, flag: True}
            system.scans[ev["BodyID"]] = ev
        elif event == "SAAScanComplete" and "SystemAddress" in ev:
            system = pending.setdefault(ev["SystemAddress"], SoldSystem("", ev["SystemAddress"]))
            probes, target = ev.get("ProbesUsed"), ev.get("EfficiencyTarget")
            system.efficient[ev["BodyID"]] = probes is None or target is None or probes <= target
        elif event == "Died":
            pending.clear()  # unsold cartographic data is lost
        elif event == "MultiSellExplorationData":
            reported = [(d["SystemName"], d.get("NumBodies", 0)) for d in ev.get("Discovered", [])]
            systems = []
            for name, _ in reported:
                address = address_by_name.get(name)
                sold = pending.pop(address, None) if address is not None else None
                systems.append(sold or SoldSystem(name, address))
                systems[-1].name = name
            sales.append(
                Sale(
                    timestamp=ev.get("timestamp", ""),
                    base_value=ev.get("BaseValue", 0),
                    bonus=ev.get("Bonus", 0),
                    total=ev.get("TotalEarnings", ev.get("BaseValue", 0) + ev.get("Bonus", 0)),
                    reported=reported,
                    systems=systems,
                )
            )
    return sales


def load_unscanned(context: dict[str, Any]) -> dict[str, list[BodyFacts]]:
    out: dict[str, list[BodyFacts]] = {}
    for name, entry in context.get("systems", {}).items():
        bodies = []
        for body_id, kind, type_, mass, terraform_state in entry["unscanned"]:
            common = {"system_address": entry["system_address"], "body_id": body_id, "name": ""}
            if kind == "star":
                bodies.append(BodyFacts(**common, kind="star", star_type=type_, stellar_mass=mass))
            else:
                bodies.append(
                    BodyFacts(
                        **common,
                        kind="planet",
                        planet_class=type_,
                        mass_em=mass,
                        terraform_state=terraform_state,
                    )
                )
        out[name] = bodies
    return out


def predict_sale(
    sale: Sale,
    unscanned: dict[str, list[BodyFacts]],
    terraform_fraction: float = 1.0,
    *,
    first_discovery: bool = True,
) -> float:
    """Predicted TotalEarnings. ``first_discovery=False`` gives the part without FD bonuses."""
    total = 0.0
    for system in sale.systems:
        bodies = [b for b in map(body_from_scan, system.scans.values()) if b is not None]
        if not first_discovery:
            bodies = [dataclasses.replace(b, was_discovered=True) for b in bodies]
        for body in bodies:
            total += round(
                scan_payout(
                    body,
                    mapped=body.body_id in system.efficient,
                    efficient=system.efficient.get(body.body_id, True),
                    terraform_fraction=terraform_fraction,
                )
            )
        if any(is_arrival_star(b) for b in bodies):  # shares ride on the arrival star
            scanned_ids = {b.body_id for b in bodies}
            others = bodies + [
                b for b in unscanned.get(system.name, []) if b.body_id not in scanned_ids
            ]
            total += round(sum(discovery_share(b, terraform_fraction) for b in others))
    return total


def test_reconstruct_sales_handles_death_and_partial_sales(tmp_path: Path) -> None:
    def scan(system: str, address: int, body_id: int, mass: float) -> dict[str, Any]:
        return {
            "event": "Scan",
            "ScanType": "Detailed",
            "StarSystem": system,
            "SystemAddress": address,
            "BodyID": body_id,
            "BodyName": f"{system} {body_id}",
            "DistanceFromArrivalLS": 0.0 if body_id == 0 else 100.0,
            "WasDiscovered": True,
            "WasMapped": True,
            **({"StarType": "M", "StellarMass": mass} if body_id == 0 else {}),
            **({"PlanetClass": "Icy body", "MassEM": mass} if body_id else {}),
        }

    events = [
        scan("Alpha", 1, 0, 0.5),
        scan("Alpha", 1, 1, 0.1),
        {"event": "Died"},
        scan("Beta", 2, 0, 0.5),
        scan("Gamma", 3, 0, 0.5),
        {
            "event": "SAAScanComplete",
            "SystemAddress": 2,
            "BodyID": 4,
            "ProbesUsed": 9,
            "EfficiencyTarget": 6,
        },
        scan("Beta", 2, 4, 0.2),
        {
            "event": "MultiSellExplorationData",
            "BaseValue": 1,
            "Bonus": 0,
            "TotalEarnings": 1,
            "Discovered": [{"SystemName": "Beta", "NumBodies": 2}],
        },
        {
            "event": "MultiSellExplorationData",
            "BaseValue": 1,
            "Bonus": 0,
            "TotalEarnings": 1,
            "Discovered": [
                {"SystemName": "Gamma", "NumBodies": 1},
                {"SystemName": "Alpha", "NumBodies": 0},
            ],
        },
    ]
    (tmp_path / "Journal.2026-01-01T000000.01.log").write_text(
        "\n".join(json.dumps(e) for e in events), encoding="utf-8"
    )
    first, second = reconstruct_sales(tmp_path)
    assert sorted(first.systems[0].scans) == [0, 4]
    assert first.systems[0].efficient == {4: False}
    assert sorted(second.systems[0].scans) == [0]
    assert second.systems[1].scans == {}  # Alpha's data was lost on death


def test_values_against_real_sales() -> None:
    journal_dir = default_journal_dir()
    if not journal_dir.is_dir():
        pytest.skip(f"journal folder not found: {journal_dir}")
    sales = reconstruct_sales(journal_dir)
    if not sales:
        pytest.skip("no MultiSellExplorationData events in the journal folder")

    context = json.loads(FIXTURE.read_text(encoding="utf-8"))
    known = {(s["timestamp"], s["base_value"]) for s in context["sales"]}
    unscanned = load_unscanned(context)

    rows, failures = [], []
    for sale in sales:
        full = predict_sale(sale, unscanned, 1.0)
        low = predict_sale(sale, unscanned, 0.0)
        bonus = full - predict_sale(sale, unscanned, 1.0, first_discovery=False)
        error = full - sale.total
        n_bodies = sum(n for _, n in sale.reported)
        uncertain = full != low
        rows.append(
            f"{sale.timestamp} bodies={n_bodies:3d} actual={sale.base_value:>10,}+{sale.bonus:<6,}"
            f" predicted={full - bonus:>10,.0f}+{bonus:<6,.0f} error={error:>+10,.0f}"
            f" ({error / max(sale.total, 1):+7.2%})"
            + (f"  terraform range {low:,.0f}..{full:,.0f}" if uncertain else "")
        )
        if (sale.timestamp, sale.base_value) not in known:
            continue  # someone else's journals: report only
        counts = [len(s.scans) for s in sale.systems]
        if counts != [n for _, n in sale.reported]:
            failures.append(f"{sale.timestamp}: reconstructed {counts}, reported {sale.reported}")
        if not (low - TOLERANCE <= sale.total <= full + TOLERANCE):
            failures.append(f"{sale.timestamp}: actual {sale.total} outside {low:.0f}..{full:.0f}")
        if not uncertain and abs(error) > TOLERANCE:
            failures.append(f"{sale.timestamp}: error {error:+.0f} Cr without terraformables")

    print("\nUniversal Cartographics sales replay (predicted assumes full terraforming bonus):")
    print("\n".join(rows))
    exact = [r for r in rows if "terraform range" not in r]
    print(f"{len(rows)} sales, {len(exact)} without terraformable bodies")
    assert not failures, "\n".join(failures)

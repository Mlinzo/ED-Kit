"""Validates species prediction against real journals (read-only).

Ground truth per body: species from `ScanOrganic`, genera from `SAASignalsFound`, and
the biological signal count from `FSSBodySignals`. Body and system facts are built from
`Scan` events by a minimal helper in this module (the real projector lives elsewhere).

Two data sources:
- "fixture": events of the bio systems from the player's journals (2026-10-10..16),
  stored in tests/fixtures/exobio/bio_systems.jsonl, so the check always runs;
- "live": the whole journal folder; skipped when it is missing. Set ED_JOURNAL_DIR to
  use another folder.

Metrics (recall, predictions per body) are printed with `pytest -s`.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from app.exobio import deduced_genera, get_genus, get_species, predict
from app.models import BodyFacts, SystemFacts

FIXTURE = Path(__file__).parent / "fixtures" / "exobio" / "bio_systems.jsonl"
JOURNAL_DIR = Path(
    os.environ.get(
        "ED_JOURNAL_DIR",
        Path.home() / "Saved Games" / "Frontier Developments" / "Elite Dangerous",
    )
)


@dataclass
class Truth:
    species: set[str] = field(default_factory=set)
    genera: set[str] = field(default_factory=set)
    bio_signals: int = 0
    dss_done: bool = False


@dataclass
class JournalData:
    systems: dict[int, SystemFacts] = field(default_factory=dict)
    truth: dict[tuple[int, int], Truth] = field(default_factory=dict)
    sold: list[dict] = field(default_factory=list)


def _signals(event: dict, kind: str) -> int:
    return sum(s.get("Count", 0) for s in event.get("Signals", []) if s.get("Type") == kind)


def _body_from_scan(e: dict) -> BodyFacts:
    is_star = "StarType" in e
    parents = [(k, v) for p in e.get("Parents") or [] for k, v in p.items()]
    return BodyFacts(
        system_address=e["SystemAddress"],
        body_id=e["BodyID"],
        name=e["BodyName"],
        kind="star" if is_star else "planet",
        scan_type=e.get("ScanType"),
        distance_ls=e.get("DistanceFromArrivalLS"),
        parents=parents,
        was_discovered=e.get("WasDiscovered"),
        was_mapped=e.get("WasMapped"),
        was_footfalled=e.get("WasFootfalled"),
        star_type=e.get("StarType"),
        planet_class=e.get("PlanetClass"),
        terraform_state=e.get("TerraformState"),
        atmosphere=e.get("Atmosphere"),
        atmosphere_type=e.get("AtmosphereType"),
        atmosphere_composition={
            a["Name"]: a["Percent"] for a in e.get("AtmosphereComposition") or []
        },
        volcanism=e.get("Volcanism"),
        surface_gravity=e.get("SurfaceGravity"),
        surface_temperature=e.get("SurfaceTemperature"),
        surface_pressure=e.get("SurfacePressure"),
        landable=bool(e.get("Landable")),
    )


def load_journals(*paths: Path) -> JournalData:
    """Applies the events of journal files (JSON lines) in the given order."""
    data = JournalData()
    for path in paths:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                _apply(data, e)
    return data


def _system(data: JournalData, address: int, name: str = "") -> SystemFacts:
    system = data.systems.get(address)
    if system is None:
        system = data.systems[address] = SystemFacts(address=address, name=name)
    elif name and not system.name:
        system.name = name
    return system


def _apply(data: JournalData, e: dict) -> None:
    ev = e.get("event")
    if ev == "Scan" and "BodyID" in e and "SystemAddress" in e:
        system = _system(data, e["SystemAddress"], e.get("StarSystem", ""))
        system.bodies[e["BodyID"]] = _body_from_scan(e)
    elif ev in ("FSDJump", "Location", "CarrierJump") and "SystemAddress" in e:
        system = _system(data, e["SystemAddress"], e.get("StarSystem", ""))
        if e.get("StarPos"):
            system.star_pos = tuple(e["StarPos"])
    elif ev == "CodexEntry" and "SystemAddress" in e:
        system = _system(data, e["SystemAddress"], e.get("System", ""))
        # The symbol ("$Codex_RegionName_18;") does not depend on the client language.
        system.region = e.get("Region") or e.get("Region_Localised")
    elif ev == "FSSBodySignals":
        key = (e["SystemAddress"], e["BodyID"])
        data.truth.setdefault(key, Truth()).bio_signals = _signals(e, "$SAA_SignalType_Biological;")
    elif ev == "SAASignalsFound":
        truth = data.truth.setdefault((e["SystemAddress"], e["BodyID"]), Truth())
        truth.dss_done = True
        truth.bio_signals = max(truth.bio_signals, _signals(e, "$SAA_SignalType_Biological;"))
        truth.genera |= {g["Genus"] for g in e.get("Genuses") or []}
    elif ev == "ScanOrganic":
        truth = data.truth.setdefault((e["SystemAddress"], e["Body"]), Truth())
        truth.species.add(e["Species"])
        truth.genera.add(e["Genus"])
    elif ev == "SellOrganicData":
        data.sold.extend(e.get("BioData") or [])


@pytest.fixture(scope="module", params=["fixture", "live"])
def journals(request: pytest.FixtureRequest) -> JournalData:
    if request.param == "fixture":
        return load_journals(FIXTURE)
    files = sorted(JOURNAL_DIR.glob("Journal.*.log")) if JOURNAL_DIR.is_dir() else []
    if not files:
        pytest.skip(f"journal folder not found: {JOURNAL_DIR}")
    return load_journals(*files)


def _body(data: JournalData, key: tuple[int, int]) -> tuple[BodyFacts, SystemFacts] | None:
    system = data.systems.get(key[0])
    body = system.bodies.get(key[1]) if system else None
    return (body, system) if body else None


def test_observed_species_are_predicted(journals: JournalData) -> None:
    """Recall: every species sampled in the journals is predicted for its body."""
    observed = found = 0
    misses = []
    for key, truth in journals.truth.items():
        if not truth.species or (pair := _body(journals, key)) is None:
            continue
        body, system = pair
        predicted = {p.species.species for p in predict(body, system)}
        for species in truth.species:
            observed += 1
            if species in predicted:
                found += 1
            else:
                misses.append((body.name, species))
    if observed == 0:
        pytest.skip("no ScanOrganic events in the journals")
    print(f"\n[exobio] species recall: {found}/{observed} = {found / observed:.0%}")
    assert not misses, misses


def test_observed_genera_are_predicted(journals: JournalData) -> None:
    """Every DSS-confirmed genus has at least one predicted species without the hint,
    and passing the genera as a filter keeps only those genera."""
    observed = found = 0
    misses = []
    for key, truth in journals.truth.items():
        if not truth.genera or (pair := _body(journals, key)) is None:
            continue
        body, system = pair
        free = {p.species.genus for p in predict(body, system)}
        hinted = predict(body, system, truth.genera)
        assert hinted, body.name
        assert {p.species.genus for p in hinted} <= {get_genus(g).genus for g in truth.genera}
        for species in truth.species:
            assert species in {p.species.species for p in hinted}, (body.name, species)
        for genus in truth.genera:
            observed += 1
            if genus in free:
                found += 1
            else:
                misses.append((body.name, genus))
    if observed == 0:
        pytest.skip("no SAASignalsFound genera in the journals")
    print(f"\n[exobio] genus recall: {found}/{observed} = {found / observed:.0%}")
    assert not misses, misses


def test_deduced_genera_are_the_dss_genera(journals: JournalData) -> None:
    """When the genera that can grow on a body fill its signals, DSS finds those genera."""
    applied = 0
    wrong = []
    for key, truth in journals.truth.items():
        if not truth.dss_done or truth.bio_signals <= 0 or (pair := _body(journals, key)) is None:
            continue
        deduced = deduced_genera(predict(*pair), truth.bio_signals)
        if deduced:
            applied += 1
            if deduced != truth.genera:
                wrong.append((pair[0].name, sorted(deduced), sorted(truth.genera)))
    print(f"\n[exobio] genera deduced before DSS: {applied}, wrong: {len(wrong)}")
    assert not wrong, wrong


def test_bodies_with_bio_signals_get_predictions(journals: JournalData) -> None:
    """Precision proxy: average predictions per body with biological signals; every
    such body needs at least as many predicted genera as it has signals."""
    counts = []
    short = []
    for key, truth in journals.truth.items():
        if truth.bio_signals <= 0 or (pair := _body(journals, key)) is None:
            continue
        body, system = pair
        preds = predict(body, system)
        counts.append(len(preds))
        genera = {p.species.genus for p in preds}
        likely = sum(p.confidence == "likely" for p in preds)
        print(
            f"\n[exobio] {body.name}: signals={truth.bio_signals} predicted={len(preds)} "
            f"(likely {likely}) genera={len(genera)}"
        )
        if len(genera) < truth.bio_signals:
            short.append((body.name, truth.bio_signals, len(genera)))
    if not counts:
        pytest.skip("no bodies with biological signals in the journals")
    print(
        f"\n[exobio] bodies with bio signals: {len(counts)}, "
        f"avg predictions per body: {sum(counts) / len(counts):.1f}"
    )
    assert not short, short


def test_sold_species_values_match_catalog(journals: JournalData) -> None:
    """`SellOrganicData.Value` is the base value; it must equal the catalog value."""
    if not journals.sold:
        pytest.skip("no SellOrganicData events in the journals")
    for item in journals.sold:
        species = get_species(item["Species"])
        assert species is not None, item["Species"]
        assert species.base_value == item["Value"], item
        assert species.genus == item["Genus"], item

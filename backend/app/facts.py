"""Conversions between journal events, `BodyFacts` and their stored JSON form."""

from __future__ import annotations

import dataclasses
import json
import sqlite3
from typing import Any

from app.models import BodyFacts, SystemFacts

_FIELDS = {f.name for f in dataclasses.fields(BodyFacts)}


def _percent_map(items: Any) -> dict[str, float]:
    if not isinstance(items, list):
        return {}
    return {
        str(i["Name"]): float(i.get("Percent", 0.0))
        for i in items
        if isinstance(i, dict) and "Name" in i
    }


def body_facts_from_scan(ev: dict[str, Any]) -> BodyFacts | None:
    """Build facts from a journal `Scan` event. Returns None for belts/rings/old scans."""
    system_address = ev.get("SystemAddress")
    body_id = ev.get("BodyID")
    name = ev.get("BodyName")
    if system_address is None or body_id is None or not name:
        return None
    if "StarType" in ev:
        kind = "star"
    elif "PlanetClass" in ev:
        kind = "planet"
    else:
        return None

    parents: list[tuple[str, int]] = []
    for entry in ev.get("Parents") or []:
        if isinstance(entry, dict):
            parents.extend((str(k), int(v)) for k, v in entry.items())

    composition = ev.get("Composition")
    return BodyFacts(
        system_address=int(system_address),
        body_id=int(body_id),
        name=str(name),
        kind=kind,
        scan_type=ev.get("ScanType"),
        distance_ls=ev.get("DistanceFromArrivalLS"),
        parents=parents,
        was_discovered=ev.get("WasDiscovered"),
        was_mapped=ev.get("WasMapped"),
        was_footfalled=ev.get("WasFootfalled"),
        star_type=ev.get("StarType"),
        star_subclass=ev.get("Subclass"),
        luminosity=ev.get("Luminosity"),
        stellar_mass=ev.get("StellarMass"),
        absolute_magnitude=ev.get("AbsoluteMagnitude"),
        age_my=ev.get("Age_MY"),
        planet_class=ev.get("PlanetClass"),
        terraform_state=ev.get("TerraformState"),
        atmosphere=ev.get("Atmosphere"),
        atmosphere_type=ev.get("AtmosphereType"),
        atmosphere_composition=_percent_map(ev.get("AtmosphereComposition")),
        volcanism=ev.get("Volcanism"),
        mass_em=ev.get("MassEM"),
        radius_m=ev.get("Radius"),
        surface_gravity=ev.get("SurfaceGravity"),
        surface_temperature=ev.get("SurfaceTemperature"),
        surface_pressure=ev.get("SurfacePressure"),
        landable=bool(ev.get("Landable", False)),
        tidal_lock=ev.get("TidalLock"),
        materials=_percent_map(ev.get("Materials")),
        composition=(
            {str(k): float(v) for k, v in composition.items()}
            if isinstance(composition, dict)
            else {}
        ),
        has_rings=bool(ev.get("Rings")),
        rings=[
            {
                "name": r.get("Name"),
                "ring_class": r.get("RingClass"),
                "inner_m": r.get("InnerRad"),
                "outer_m": r.get("OuterRad"),
            }
            for r in ev.get("Rings") or []
            if isinstance(r, dict)
        ],
        epoch=ev.get("timestamp"),
        semi_major_axis_m=ev.get("SemiMajorAxis"),
        eccentricity=ev.get("Eccentricity"),
        orbital_inclination=ev.get("OrbitalInclination"),
        periapsis=ev.get("Periapsis"),
        ascending_node=ev.get("AscendingNode"),
        mean_anomaly=ev.get("MeanAnomaly"),
        orbital_period_s=ev.get("OrbitalPeriod"),
        rotation_period_s=ev.get("RotationPeriod"),
        axial_tilt=ev.get("AxialTilt"),
    )


def merge_facts(old: BodyFacts, new: BodyFacts) -> BodyFacts:
    """Newer scan wins, but never erase a value with a missing one."""
    merged = {}
    for name in _FIELDS:
        value = getattr(new, name)
        if value is None or value == {} or value == []:
            value = getattr(old, name)
        merged[name] = value
    return BodyFacts(**merged)


def facts_to_json(facts: BodyFacts) -> str:
    return json.dumps(dataclasses.asdict(facts), separators=(",", ":"))


def facts_from_json(text: str) -> BodyFacts:
    data = {k: v for k, v in json.loads(text).items() if k in _FIELDS}
    data["parents"] = [(str(k), int(v)) for k, v in data.get("parents") or []]
    return BodyFacts(**data)


def load_system(
    conn: sqlite3.Connection, address: int, *, community: bool = True
) -> SystemFacts | None:
    """System facts from your journal, completed with community (Spansh/EDSM) bodies
    you have not scanned yourself."""
    row = conn.execute(
        "SELECT address, name, x, y, z, region, population FROM systems WHERE address = ?",
        (address,),
    ).fetchone()
    if row is None:
        return None
    star_pos = (row["x"], row["y"], row["z"]) if row["x"] is not None else None
    system = SystemFacts(
        address=row["address"],
        name=row["name"],
        star_pos=star_pos,
        region=row["region"],
        populated=None if row["population"] is None else row["population"] > 0,
    )
    for body in conn.execute("SELECT facts FROM bodies WHERE system_address = ?", (address,)):
        facts = facts_from_json(body["facts"])
        system.bodies[facts.body_id] = facts
    if community:
        for body in conn.execute(
            "SELECT body_id, facts FROM ext_bodies WHERE system_address = ?", (address,)
        ):
            if body["body_id"] not in system.bodies:
                system.bodies[body["body_id"]] = facts_from_json(body["facts"])
    return system


def body_id64(system_address: int, body_id: int) -> int:
    return system_address | (body_id << 55)

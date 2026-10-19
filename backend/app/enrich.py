"""Community body data for the current system (Spansh, falling back to EDSM).

Other commanders' scans reach these databases through EDDN, so a system you have just
jumped into is often fully known there: bodies, orbits, bio signal counts and even the
genera found by DSS. That data fills the map and the predictions before you honk. A system
opened by address (the history, the galaxy map) is looked up the same way, so one you have
never been to is shown from this data alone, with the name and position the databases give.

Rules:
- The journal always wins: community bodies are stored apart (`ext_*` tables) and only
  shown for bodies you have not scanned yourself.
- Network calls run on a worker thread; results are written by the ingest thread.
- Requests reveal the systems you visit to the database operator; `--offline` disables them.
"""

from __future__ import annotations

import json
import logging
import queue
import re
import sqlite3
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app import __version__
from app.facts import facts_to_json
from app.models import BodyFacts, G

log = logging.getLogger(__name__)

SPANSH_DUMP = "https://spansh.co.uk/api/dump/{address}"
EDSM_BODIES = "https://www.edsm.net/api-system-v1/bodies?systemId64={address}"
USER_AGENT = f"EDExplorerKit/{__version__} (local explorer companion)"
TIMEOUT_S = 20
FRESH_FOR = timedelta(hours=24)
RETRY_FAILED_AFTER = timedelta(hours=1)

AU_M = 149_597_870_700.0
DAY_S = 86_400.0
SOLAR_RADIUS_M = 695_700_000.0
ATM_PA = 101_325.0

PLANET_CLASSES = {
    "metal-rich body": "Metal rich body",
    "metal rich body": "Metal rich body",
    "high metal content world": "High metal content body",
    "high metal content body": "High metal content body",
    "rocky body": "Rocky body",
    "icy body": "Icy body",
    "rocky ice world": "Rocky ice body",
    "rocky ice body": "Rocky ice body",
    "earth-like world": "Earthlike body",
    "earthlike body": "Earthlike body",
    "water world": "Water world",
    "ammonia world": "Ammonia world",
    "water giant": "Water giant",
    "water giant with life": "Water giant with life",
    "gas giant with water-based life": "Gas giant with water based life",
    "gas giant with ammonia-based life": "Gas giant with ammonia based life",
    "class i gas giant": "Sudarsky class I gas giant",
    "class ii gas giant": "Sudarsky class II gas giant",
    "class iii gas giant": "Sudarsky class III gas giant",
    "class iv gas giant": "Sudarsky class IV gas giant",
    "class v gas giant": "Sudarsky class V gas giant",
    "helium-rich gas giant": "Helium rich gas giant",
    "helium gas giant": "Helium gas giant",
}

# Star subtypes whose journal StarType cannot be read from `spectralClass`.
STAR_TYPES = {
    "neutron star": "N",
    "black hole": "H",
    "supermassive black hole": "SupermassiveBlackHole",
    "t tauri star": "TTS",
    "herbig ae/be star": "AeBe",
    "ms-type star": "MS",
    "s-type star": "S",
    "m (red giant) star": "M_RedGiant",
    "m (red super giant) star": "M_RedSuperGiant",
    "k (yellow-orange giant) star": "K_OrangeGiant",
    "a (blue-white super giant) star": "A_BlueWhiteSuperGiant",
    "b (blue-white super giant) star": "B_BlueWhiteSuperGiant",
    "f (white super giant) star": "F_WhiteSuperGiant",
    "g (white-yellow super giant) star": "G_WhiteSuperGiant",
}

TERRAFORM_STATES = {
    "candidate for terraforming": "Terraformable",
    "terraformable": "Terraformable",
    "terraforming": "Terraforming",
    "terraformed": "Terraformed",
}

SIGNAL_KINDS = {
    "$SAA_SignalType_Biological;": "bio",
    "$SAA_SignalType_Geological;": "geo",
    "$SAA_SignalType_Human;": "human",
}

RING_CLASSES = {
    "icy": "eRingClass_Icy",
    "rocky": "eRingClass_Rocky",
    "metallic": "eRingClass_Metalic",
    "metal rich": "eRingClass_MetalRich",
}


@dataclass(slots=True)
class ExternalBody:
    facts: BodyFacts
    signals: dict[str, int] = field(default_factory=dict)
    genuses: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ExternalSystem:
    address: int
    source: str | None  # None when no bodies were found
    body_count: int | None = None
    bodies: list[ExternalBody] = field(default_factory=list)
    barycentres: dict[int, dict[str, Any]] = field(default_factory=dict)
    # Known even without bodies (Spansh: both; EDSM: the name only).
    name: str | None = None
    star_pos: tuple[float, float, float] | None = None


# --------------------------------------------------------------------------- parsing


def _num(raw: dict[str, Any], key: str, scale: float = 1.0) -> float | None:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) * scale


def _parents(raw: dict[str, Any]) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for entry in raw.get("parents") or []:
        if isinstance(entry, dict):
            out.extend((str(k), int(v)) for k, v in entry.items())
    return out


def _orbit(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "epoch": raw.get("updateTime"),
        "semi_major_axis_m": _num(raw, "semiMajorAxis", AU_M),
        "eccentricity": _num(raw, "orbitalEccentricity"),
        "orbital_inclination": _num(raw, "orbitalInclination"),
        "periapsis": _num(raw, "argOfPeriapsis"),
        "ascending_node": _num(raw, "ascendingNode"),
        "mean_anomaly": _num(raw, "meanAnomaly"),
        "orbital_period_s": _num(raw, "orbitalPeriod", DAY_S),
    }


def _star_type(raw: dict[str, Any]) -> tuple[str | None, int | None]:
    sub = str(raw.get("subType") or "").strip()
    known = STAR_TYPES.get(sub.lower())
    if known:
        return known, None
    spectral = str(raw.get("spectralClass") or "")
    match = re.fullmatch(r"([A-Za-z]+?)(\d)?", spectral)
    if match:
        return match.group(1), int(match.group(2)) if match.group(2) else None
    match = re.search(r"\(([A-Z]{1,3})\)", sub)  # "White Dwarf (DA) Star"
    if match:
        return match.group(1), None
    if sub.lower().startswith("wolf-rayet"):
        parts = sub.split()
        return parts[1] if len(parts) > 2 else "W", None
    return (sub[:1].upper() or None), None


def _atmosphere(raw: dict[str, Any]) -> str:
    text = str(raw.get("atmosphereType") or "").strip()
    if not text or text.lower() in ("no atmosphere", "none"):
        return ""
    if text.lower() == "suitable for water-based life":
        return "earth-like atmosphere"
    return f"{text.lower()} atmosphere"  # parsed into a type by the exobio engine


def _volcanism(raw: dict[str, Any]) -> str | None:
    text = raw.get("volcanismType")
    if text is None:
        return None
    text = str(text).strip()
    return "" if text.lower() in ("", "no volcanism", "none") else f"{text.lower()} volcanism"


def _rings(raw: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for ring in (raw.get("rings") or []) + (raw.get("belts") or []):
        if not isinstance(ring, dict):
            continue
        out.append(
            {
                "name": ring.get("name"),
                "ring_class": RING_CLASSES.get(str(ring.get("type") or "").lower()),
                "inner_m": _num(ring, "innerRadius", 1000),
                "outer_m": _num(ring, "outerRadius", 1000),
            }
        )
    return out


def body_from_external(address: int, raw: dict[str, Any], source: str) -> BodyFacts | None:
    """Convert one Spansh/EDSM body (EDSM units: AU, days, km, g, atm) to journal facts."""
    body_type = str(raw.get("type") or "")
    body_id = raw.get("bodyId")
    name = raw.get("name")
    if body_id is None or not name or body_type not in ("Star", "Planet"):
        return None
    common: dict[str, Any] = {
        "system_address": address,
        "body_id": int(body_id),
        "name": str(name),
        "source": source,
        "scan_type": None,
        "distance_ls": _num(raw, "distanceToArrival"),
        "parents": _parents(raw),
        "was_discovered": True,  # it is in a public database, so someone found it first
        "surface_temperature": _num(raw, "surfaceTemperature"),
        "rotation_period_s": _num(raw, "rotationalPeriod", DAY_S),
        "axial_tilt": _num(raw, "axialTilt"),
        "tidal_lock": raw.get("rotationalPeriodTidallyLocked"),
        "rings": _rings(raw),
        "has_rings": bool(raw.get("rings")),
    }
    common.update(_orbit(raw))
    if body_type == "Star":
        star_type, subclass = _star_type(raw)
        return BodyFacts(
            kind="star",
            star_type=star_type,
            star_subclass=subclass,
            luminosity=raw.get("luminosity"),
            stellar_mass=_num(raw, "solarMasses"),
            absolute_magnitude=_num(raw, "absoluteMagnitude"),
            age_my=raw.get("age"),
            radius_m=_num(raw, "solarRadius", SOLAR_RADIUS_M),
            **common,
        )
    composition = raw.get("solidComposition")
    return BodyFacts(
        kind="planet",
        planet_class=PLANET_CLASSES.get(str(raw.get("subType") or "").lower(), raw.get("subType")),
        terraform_state=TERRAFORM_STATES.get(str(raw.get("terraformingState") or "").lower(), ""),
        atmosphere=_atmosphere(raw),
        atmosphere_composition={
            str(k): float(v) for k, v in (raw.get("atmosphereComposition") or {}).items()
        },
        volcanism=_volcanism(raw),
        mass_em=_num(raw, "earthMasses"),
        radius_m=_num(raw, "radius", 1000),
        surface_gravity=_num(raw, "gravity", G),
        surface_pressure=_num(raw, "surfacePressure", ATM_PA),
        landable=bool(raw.get("isLandable")),
        materials={str(k): float(v) for k, v in (raw.get("materials") or {}).items()},
        composition=(
            {str(k): float(v) / 100 for k, v in composition.items()}
            if isinstance(composition, dict)
            else {}
        ),
        **common,
    )


def _signals(raw: dict[str, Any]) -> tuple[dict[str, int], list[str]]:
    block = raw.get("signals")
    if not isinstance(block, dict):
        return {}, []
    counts: dict[str, int] = {}
    for kind_symbol, count in (block.get("signals") or {}).items():
        kind = SIGNAL_KINDS.get(str(kind_symbol), "other")
        counts[kind] = counts.get(kind, 0) + int(count or 0)
    genuses = [str(g) for g in block.get("genuses") or []]
    return counts, genuses


def parse_system(
    address: int, bodies: list[dict[str, Any]], source: str, body_count: int | None
) -> ExternalSystem:
    system = ExternalSystem(address=address, source=source, body_count=body_count)
    for raw in bodies:
        if not isinstance(raw, dict):
            continue
        if raw.get("type") == "Barycentre" and raw.get("bodyId") is not None:
            system.barycentres[int(raw["bodyId"])] = _orbit(raw)
            continue
        facts = body_from_external(address, raw, source)
        if facts is not None:
            counts, genuses = _signals(raw)
            system.bodies.append(ExternalBody(facts, counts, genuses))
    return system


# --------------------------------------------------------------------------- network


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def _coords(system: dict[str, Any]) -> tuple[float, float, float] | None:
    c = system.get("coords")
    if not isinstance(c, dict):
        return None
    xyz = (_num(c, "x"), _num(c, "y"), _num(c, "z"))
    return None if None in xyz else xyz  # type: ignore[return-value]


def fetch_system(address: int) -> ExternalSystem:
    """Spansh first (has bio signals and genera), then EDSM. Never raises."""
    name: str | None = None
    star_pos: tuple[float, float, float] | None = None
    found: ExternalSystem | None = None
    try:
        data = _get_json(SPANSH_DUMP.format(address=address))
        system = data.get("system") if isinstance(data, dict) else None
        if isinstance(system, dict):
            name, star_pos = (str(system["name"]) if system.get("name") else None), _coords(system)
            if system.get("bodies"):
                found = parse_system(address, system["bodies"], "spansh", system.get("bodyCount"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        log.info("spansh lookup failed for %s: %s", address, exc)
    if found is None:
        try:
            data = _get_json(EDSM_BODIES.format(address=address))
            if isinstance(data, dict):
                name = name or (str(data["name"]) if data.get("name") else None)
                if data.get("bodies"):
                    found = parse_system(address, data["bodies"], "edsm", data.get("bodyCount"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            log.info("edsm lookup failed for %s: %s", address, exc)
    found = found or ExternalSystem(address=address, source=None)
    found.name, found.star_pos = name, star_pos
    return found


class Enricher:
    """Fetches systems one at a time on a background thread."""

    def __init__(self) -> None:
        self._requests: queue.Queue[int] = queue.Queue()
        self.results: queue.Queue[ExternalSystem] = queue.Queue()
        self._pending: set[int] = set()
        self._thread = threading.Thread(target=self._run, name="enrich", daemon=True)
        self._thread.start()

    def request(self, address: int) -> None:
        if address not in self._pending:
            self._pending.add(address)
            self._requests.put(address)

    def _run(self) -> None:
        while True:
            address = self._requests.get()
            try:
                self.results.put(fetch_system(address))
            except Exception:  # noqa: BLE001 - never kill the worker
                log.exception("enrichment failed for %s", address)
                self.results.put(ExternalSystem(address=address, source=None))

    def drain(self) -> list[ExternalSystem]:
        out = []
        while True:
            try:
                system = self.results.get_nowait()
            except queue.Empty:
                return out
            self._pending.discard(system.address)
            out.append(system)


# --------------------------------------------------------------------------- storage


def needs_fetch(conn: sqlite3.Connection, address: int, now: datetime | None = None) -> bool:
    row = conn.execute(
        "SELECT fetched_at, ok FROM ext_systems WHERE address = ?", (address,)
    ).fetchone()
    if row is None:
        return True
    now = now or datetime.now(UTC)
    fetched = datetime.fromisoformat(row["fetched_at"])
    return now - fetched > (FRESH_FOR if row["ok"] else RETRY_FAILED_AFTER)


def store(conn: sqlite3.Connection, system: ExternalSystem) -> None:
    """Replace the cached community data of one system (caller owns the transaction)."""
    pos = system.star_pos or (None, None, None)
    conn.execute(
        "INSERT INTO ext_systems(address, source, fetched_at, ok, body_count, name, x, y, z) "
        "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET "
        "source = excluded.source, fetched_at = excluded.fetched_at, ok = excluded.ok, "
        "body_count = excluded.body_count, name = COALESCE(excluded.name, name), "
        "x = COALESCE(excluded.x, x), y = COALESCE(excluded.y, y), z = COALESCE(excluded.z, z)",
        (
            system.address,
            system.source,
            datetime.now(UTC).isoformat(timespec="seconds"),
            int(system.source is not None),
            system.body_count,
            system.name,
            *pos,
        ),
    )
    if system.source is None:
        return  # keep whatever older data we had
    conn.execute("DELETE FROM ext_bodies WHERE system_address = ?", (system.address,))
    conn.execute("DELETE FROM ext_barycentres WHERE system_address = ?", (system.address,))
    conn.executemany(
        "INSERT INTO ext_bodies(system_address, body_id, facts, signals, genuses) "
        "VALUES(?, ?, ?, ?, ?)",
        [
            (
                system.address,
                b.facts.body_id,
                facts_to_json(b.facts),
                json.dumps(b.signals),
                json.dumps(b.genuses),
            )
            for b in system.bodies
        ],
    )
    conn.executemany(
        "INSERT INTO ext_barycentres(system_address, body_id, orbit) VALUES(?, ?, ?)",
        [(system.address, k, json.dumps(v)) for k, v in system.barycentres.items()],
    )

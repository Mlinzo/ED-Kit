"""Domain facts shared by the projector, value calculator and exobiology predictor.

These are plain data containers built from journal events. They carry raw game units
(metres, m/s^2, Pascals, Kelvin) exactly as the journal reports them; convenience
properties convert where callers commonly need other units.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

G = 9.80665  # m/s^2 per g

BodyKind = Literal["star", "planet"]


@dataclass(slots=True)
class BodyFacts:
    """One body as known from journal `Scan` events (later scans overwrite earlier ones)."""

    system_address: int
    body_id: int
    name: str
    kind: BodyKind
    source: str = "journal"  # journal | spansh | edsm (community database, not scanned by you)

    # Scan metadata
    scan_type: str | None = None  # AutoScan | Detailed | Basic | NavBeacon | NavBeaconDetail
    distance_ls: float | None = None
    parents: list[tuple[str, int]] = field(default_factory=list)  # [("Planet", 3), ("Star", 0)]
    was_discovered: bool | None = None
    was_mapped: bool | None = None
    was_footfalled: bool | None = None  # absent in older journals

    # Star fields (kind == "star")
    star_type: str | None = None  # journal StarType: "M", "K", "DA", "N", "H", "TTS", ...
    star_subclass: int | None = None
    luminosity: str | None = None  # "V", "Va", "III", ...
    stellar_mass: float | None = None  # solar masses
    absolute_magnitude: float | None = None
    age_my: int | None = None

    # Planet fields (kind == "planet")
    planet_class: str | None = None  # "High metal content body", "Rocky body", "Icy body", ...
    terraform_state: str | None = None  # "" | "Terraformable" | "Terraforming" | "Terraformed"
    atmosphere: str | None = None  # descriptive, e.g. "thin oxygen atmosphere"; "" = none
    atmosphere_type: str | None = None  # e.g. "Oxygen", "CarbonDioxide"; "" = none
    atmosphere_composition: dict[str, float] = field(default_factory=dict)  # name -> percent
    volcanism: str | None = None  # descriptive, e.g. "minor silicate vapour geysers volcanism"
    mass_em: float | None = None  # Earth masses
    radius_m: float | None = None  # metres (stars too)
    surface_gravity: float | None = None  # m/s^2
    surface_temperature: float | None = None  # Kelvin (stars too)
    surface_pressure: float | None = None  # Pascals
    landable: bool = False
    tidal_lock: bool | None = None
    materials: dict[str, float] = field(default_factory=dict)  # name -> percent
    composition: dict[str, float] = field(default_factory=dict)  # Ice/Rock/Metal fractions
    has_rings: bool = False
    rings: list[dict[str, Any]] = field(default_factory=list)  # name, ring_class, inner_m, outer_m

    # Orbit and rotation (journal units: metres, degrees, seconds)
    epoch: str | None = None  # timestamp of the scan the orbital phase refers to
    semi_major_axis_m: float | None = None
    eccentricity: float | None = None
    orbital_inclination: float | None = None
    periapsis: float | None = None
    ascending_node: float | None = None
    mean_anomaly: float | None = None
    orbital_period_s: float | None = None
    rotation_period_s: float | None = None
    axial_tilt: float | None = None  # radians, as in the journal

    @property
    def gravity_g(self) -> float | None:
        return None if self.surface_gravity is None else self.surface_gravity / G

    @property
    def pressure_atm(self) -> float | None:
        return None if self.surface_pressure is None else self.surface_pressure / 101_325

    @property
    def terraformable(self) -> bool:
        return self.terraform_state in ("Terraformable", "Terraforming", "Terraformed")

    @property
    def has_atmosphere(self) -> bool:
        return bool(self.atmosphere_type) and self.atmosphere_type != "None"


@dataclass(slots=True)
class SystemFacts:
    """Everything known about one star system, used as context for predictions."""

    address: int
    name: str
    star_pos: tuple[float, float, float] | None = None
    bodies: dict[int, BodyFacts] = field(default_factory=dict)  # by BodyID
    region: str | None = None  # Codex region symbol or name if seen
    populated: bool | None = None  # Population > 0 (no first-footfall bonus there)

    def stars(self) -> list[BodyFacts]:
        return [b for b in self.bodies.values() if b.kind == "star"]

    def parent_star(self, body: BodyFacts) -> BodyFacts | None:
        """Nearest scanned star in the body's Parents chain; falls back to the main star."""
        for kind, body_id in body.parents:
            if kind == "Star" and body_id in self.bodies:
                return self.bodies[body_id]
        main = self.bodies.get(0)
        if main and main.kind == "star":
            return main
        stars = self.stars()
        return min(stars, key=lambda s: s.distance_ls or 0.0) if stars else None


@dataclass(slots=True, frozen=True)
class Species:
    """Static catalog entry for one exobiology species."""

    species: str  # codex symbol, e.g. "$Codex_Ent_Stratum_07_Name;"
    species_name: str  # English name, e.g. "Stratum Tectonicas"
    genus: str  # codex symbol, e.g. "$Codex_Ent_Stratum_Genus_Name;"
    genus_name: str  # English name, e.g. "Stratum"
    base_value: int  # Vista Genomics payout without first-footfall bonus
    colony_range_m: int  # minimum distance between samples


@dataclass(slots=True, frozen=True)
class Prediction:
    """A species that may grow on a body, given its scan data."""

    species: Species
    confidence: Literal["likely", "possible"]


@dataclass(slots=True, frozen=True)
class BodyValue:
    """Estimated Universal Cartographics payout for one body, in credits."""

    fss: int  # sold after detailed (FSS) scan only
    dss: int  # sold after surface mapping (DSS), assuming efficiency target met
    first_discovery: bool  # bonus applied because nobody discovered it before
    first_mapping: bool  # bonus applied because nobody mapped it before

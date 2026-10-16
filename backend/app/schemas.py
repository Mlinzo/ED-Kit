"""JSON view models served to the frontend. Field names are camelCase on the wire.

Mirrored by `frontend/src/api/types.ts` — keep both in sync.
All 64-bit ids (system address, body id64) are sent as strings: they exceed 2^53.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


SpeciesStatus = Literal["predicted", "sampling", "analysed"]
# new: never in your codex; new_region: in your codex, but not for this region; logged: known
CodexStatus = Literal["new", "new_region", "logged"]


class HighlightSettings(CamelModel):
    """Minimum values for a body to be highlighted (credits)."""

    dss_min: int  # estimated payout after DSS mapping
    bio_min: int  # estimated exobiology value on the body (optimistic, incl. bonus)


class SpeciesView(CamelModel):
    genus: str  # English genus name, e.g. "Stratum"
    species: str  # English species name, e.g. "Stratum Tectonicas"
    value: int  # base value, credits
    bonus_value: int  # value incl. first-footfall bonus when it applies, else == value
    colony_range_m: int
    status: SpeciesStatus
    samples: int  # 0..3
    certain: bool  # True once genus is confirmed by DSS or species was scanned
    codex: CodexStatus  # species level (colour variants are not predicted yet)


class SignalsView(CamelModel):
    bio: int = 0
    geo: int = 0
    human: int = 0
    other: int = 0


ParentKind = Literal["Star", "Planet", "Null", "Ring"]  # Null = barycentre


class ParentRef(CamelModel):
    kind: ParentKind
    body_id: int


class OrbitView(CamelModel):
    """Keplerian elements as reported by the journal (not to scale on the map)."""

    epoch: str | None  # ISO timestamp the mean anomaly refers to
    semi_major_axis_m: float | None
    eccentricity: float | None
    inclination_deg: float | None
    periapsis_deg: float | None
    ascending_node_deg: float | None
    mean_anomaly_deg: float | None
    period_s: float | None


class RingView(CamelModel):
    name: str | None
    ring_class: str | None  # eRingClass_Icy | _Rocky | _Metalic | _MetalRich
    inner_m: float | None
    outer_m: float | None


class BodyVisual(CamelModel):
    """Everything the 3D map needs to draw the body."""

    planet_class: str | None  # journal PlanetClass, e.g. "Water world"
    star_type: str | None  # journal StarType, e.g. "M", "DA", "N"
    star_subclass: int | None
    luminosity: str | None
    atmosphere_type: str | None  # "" = none
    terraform_state: str | None
    volcanism: str | None
    temperature_k: float | None
    surface_pressure_atm: float | None
    atmosphere_composition: dict[str, float]  # gas -> percent
    mass_em: float | None
    radius_m: float | None
    stellar_mass: float | None
    axial_tilt_rad: float | None
    rotation_period_s: float | None
    tidal_lock: bool | None
    composition: dict[str, float]  # Ice / Rock / Metal fractions
    rings: list[RingView]


Interest = Literal["high", "medium", "low"]
DataSource = Literal["journal", "spansh", "edsm"]


class BodyView(CamelModel):
    id64: str
    body_id: int
    name: str
    short_name: str  # name without the system prefix, e.g. "A 3 a"
    kind: Literal["star", "planet"]
    source: DataSource  # where the body data comes from; journal = scanned by you
    source_at: str | None  # ISO time of your scan, or of the database record
    source_url: str | None  # page of this body in the database (Spansh only)
    signals_source: DataSource | None  # where the signal counts come from (None: no data)
    genuses_source: DataSource | None  # where the DSS genera come from (None: no data)
    subtype: str  # e.g. "High metal content body", "M (Red dwarf) star"
    parent_id: int | None
    distance_ls: float | None
    landable: bool
    terraformable: bool
    atmosphere: str | None
    gravity_g: float | None
    temperature_k: float | None
    radius_km: float | None
    was_discovered: bool | None
    was_mapped: bool | None
    was_footfalled: bool | None
    mapped_by_me: bool
    footfall_by_me: bool  # you were the first to walk on it
    footfall_claimable: bool  # landable, nobody walked here yet, and not a populated system
    signals: SignalsView
    genuses: list[str]  # English genus names confirmed by DSS
    species: list[SpeciesView]
    fss_value: int
    dss_value: int
    worth_mapping: bool
    bio_value_min: int  # pessimistic estimate for all bio signals on the body (with bonus)
    bio_value_max: int  # optimistic estimate (with bonus)
    total_value: int  # best-case total (dss + bio max), used for sorting
    bio_done: int  # species analysed by the commander on this body
    codex_new: int  # confirmed or DSS-certain species new to your codex (here)
    codex_maybe: int  # uncertain predictions that would be new to your codex
    interest: Interest  # how much attention the body deserves (map brightness)
    reasons: list[str]  # interest codes: bio, map, elw, ww, aw, terraformable, rare_star, ...
    done: bool  # everything worth doing here is done (mapped if worth it, all bio analysed)
    parents: list[ParentRef]  # immediate parent first; [] for the root body
    orbit: OrbitView | None
    visual: BodyVisual


class SystemTotals(CamelModel):
    fss: int
    dss: int
    bio_min: int
    bio_max: int


class BarycentreView(CamelModel):
    body_id: int
    parents: list[ParentRef]  # derived from body parent chains
    orbit: OrbitView | None  # None until the barycentre itself is scanned


class SystemView(CamelModel):
    address: str | None
    name: str | None
    star_pos: tuple[float, float, float] | None
    body_count: int | None  # from FSS honk; None until honked
    scanned_count: int
    all_bodies_found: bool
    current_body_id: int | None  # body the commander is near/on
    bodies: list[BodyView]
    barycentres: list[BarycentreView]
    totals: SystemTotals


class SamplePoint(CamelModel):
    n: int  # sample number 1..3
    lat: float
    lon: float


class ActiveScanView(CamelModel):
    genus: str
    species: str
    value: int
    bonus_value: int
    colony_range_m: int
    codex: CodexStatus
    samples: int  # 1..3 (Log counts as the first sample)
    points: list[SamplePoint]  # positions of taken samples


class SurfaceView(CamelModel):
    body: BodyView | None
    active_scan: ActiveScanView | None


class SessionView(CamelModel):
    commander: str | None
    unsold_bio_count: int
    unsold_bio_value: int  # incl. first-footfall bonus where known
    unsold_carto_bodies: int
    unsold_carto_systems: int
    unsold_carto_value: int  # estimate
    at_risk_value: int  # unsold bio + carto
    jumps: int  # since last exploration data sale
    distance_ly: float  # since last exploration data sale
    last_sale_at: str | None  # ISO timestamp


class LiveStatus(CamelModel):
    """Decoded Status.json; pushed over SSE as it changes, never persisted."""

    timestamp: str | None = None
    flags: int = 0
    flags2: int = 0
    docked: bool = False
    landed: bool = False
    supercruise: bool = False
    in_ship: bool = False
    in_srv: bool = False
    on_foot: bool = False
    has_lat_long: bool = False
    lat: float | None = None
    lon: float | None = None
    heading: float | None = None
    altitude: float | None = None
    planet_radius_m: float | None = None
    body_name: str | None = None


class IngestState(CamelModel):
    backfill_done: bool
    files_total: int
    files_done: int
    events: int
    journal_dir: str
    journal_dir_found: bool


class StatCount(CamelModel):
    key: str  # stable code, labelled by the frontend (e.g. "elw", "neutron")
    count: int


class GenusProgress(CamelModel):
    genus: str  # English genus name
    found: int  # distinct species analysed
    total: int  # species in the catalog


class NamedValue(CamelModel):
    name: str
    detail: str | None  # e.g. body subtype or system name
    value: float
    at: str | None  # ISO timestamp


class DayStats(CamelModel):
    date: str  # YYYY-MM-DD (UTC)
    jumps: int
    distance_ly: float
    bodies_scanned: int
    species_analysed: int
    earnings: int
    earnings_carto: int
    earnings_bio: int


class KillerView(CamelModel):
    name: str | None
    ship: str | None  # journal ship/suit symbol, e.g. "federation_gunship"
    rank: str | None


class DeathView(CamelModel):
    at: str
    system: str | None
    body: str | None
    context: Literal["ship", "srv", "on_foot"]
    killers: list[KillerView]
    lost_bio_count: int
    lost_bio_value: int
    lost_carto_bodies: int
    lost_carto_value: int  # estimate
    rebuy_option: str | None  # rebuy | recover | rejoin | handin | free ...
    rebuy_cost: int | None


FirstState = Literal["sold", "pending", "lost"]  # the tag is yours once the data is sold


class FirstEntry(CamelModel):
    system: str | None
    body: str  # full body name
    short_name: str
    subtype: str
    at: str | None  # when you scanned it
    discovered: FirstState | None  # first discovery
    mapped: FirstState | None  # first to map
    footfall_at: str | None  # first footfall (on foot)


class StatsView(CamelModel):
    commander: str | None
    since: str | None  # first journal event of this commander
    days_active: int
    # travel
    jumps: int
    distance_ly: float
    systems_visited: int
    longest_jump: NamedValue | None
    farthest_from_sol: NamedValue | None  # value in ly
    # scanning
    systems_honked: int
    systems_fully_scanned: int
    bodies_scanned: int
    stars_scanned: int
    planets_scanned: int
    first_discoveries: int
    bodies_mapped: int
    first_mapped: int
    efficient_maps: int
    notable: list[StatCount]  # elw, ww, aw, terraformable, neutron, black_hole, ...
    most_valuable_bodies: list[NamedValue]  # top 5 by estimated value
    # exobiology
    species_analysed: int
    unique_species: int
    species_total: int
    genera_found: int
    genera_total: int
    first_footfalls: int
    codex_new_entries: int
    genus_progress: list[GenusProgress]
    most_valuable_species: list[NamedValue]  # top 5 analysed by value
    # money and losses
    earnings_carto: int
    earnings_bio: int
    biggest_sale: NamedValue | None
    deaths: int
    value_lost: int  # unsold data lost on death (estimate)
    death_history: list[DeathView]  # newest first
    first_discoveries_sold: int
    first_discoveries_pending: int
    first_discoveries_lost: int
    first_mapped_sold: int
    first_mapped_pending: int
    first_mapped_lost: int
    first_footfalls_total: int  # bodies where you were the first to walk
    firsts: list[FirstEntry]  # newest first, at most 500
    timeline: list[DayStats]


Topic = Literal["system", "surface", "session", "stats"]

"""JSON view models served to the frontend. Field names are camelCase on the wire.

Mirrored by `frontend/src/api/types.ts` — keep both in sync.
All 64-bit ids (system address, body id64) are sent as strings: they exceed 2^53.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
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


class SystemRef(CamelModel):
    address: str
    name: str


class SystemView(CamelModel):
    address: str | None
    name: str | None
    star_pos: tuple[float, float, float] | None
    body_count: int | None  # from FSS honk; None until honked
    scanned_count: int
    all_bodies_found: bool
    is_current: bool  # the commander is in this system now (else: a system from the history)
    current_system: SystemRef | None  # where the commander is now
    current_body_id: int | None  # body the commander is near/on (current system only)
    visits: int  # arrivals in this system
    first_visit_at: str | None
    last_visit_at: str | None
    # Neighbours in the history (systems ordered by their last visit), for stepping through it.
    prev_system: SystemRef | None
    next_system: SystemRef | None
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


class HistoryStar(CamelModel):
    """The arrival star of a system (journal StarType etc., for the colour dot)."""

    star_type: str | None
    star_subclass: int | None
    luminosity: str | None
    subtype: str  # e.g. "K5 Va · orange star"


class HistoryEntry(CamelModel):
    """One visited system and what you did there."""

    address: str
    name: str
    first_visit_at: str
    last_visit_at: str
    visits: int
    main_star: HistoryStar | None
    body_count: int | None  # from FSS honk (or community data); None when unknown
    all_bodies_found: bool
    bodies_scanned: int  # by you
    bodies_mapped: int  # by you
    bio_signals: int  # biological signals found on scanned bodies
    species_analysed: int  # by you
    first_discoveries: int
    first_mapped: int
    first_footfalls: int
    value: int  # estimated cartographic value of your scans + analysed species (incl. bonus)
    unsold_value: int  # part of `value` not sold yet
    lost_value: int  # data lost on death (not in `value`; mapping bonus already gone)
    notable: list[str]  # notable finds, most remarkable first: elw, ww, neutron, ...


class HistoryView(CamelModel):
    current_address: str | None
    systems: list[HistoryEntry]  # most recently visited first


RouteMode = Literal["riches", "line"]  # around a start point | along a straight line
# elw | terraformable water world | terraformable high metal content | water world |
# ammonia world | terraformable rocky body (app.routeplan.BODY_TYPES, priced by mapping) |
# bio: landable bodies with biological signals (priced by their predicted species)
BodyKind = Literal["elw", "tww", "thmc", "ww", "aw", "trocky", "bio"]


class RouteRequest(CamelModel):
    """POST /api/route: plan a new route (replaces the current one)."""

    mode: RouteMode
    source: str = ""  # empty: the current system
    destination: str | None = None  # line mode
    radius_ly: float = Field(200, ge=10, le=1000)  # riches mode
    deviation_ly: float = Field(25, ge=5, le=100)  # line mode: max distance from the line
    max_systems: int = Field(100, ge=1, le=1000)  # stops at most (line: the most valuable)
    body_types: list[BodyKind] = Field(
        default_factory=lambda: ["elw", "tww", "thmc", "bio"], min_length=1
    )
    min_value: int = Field(300_000, ge=0)  # estimated payout after mapping, per body
    min_system_value: int = Field(0, ge=0)  # still to earn in a system: mapping + biology
    bio_min_value: int = Field(5_000_000, ge=0)  # biology per body, optimistic estimate
    bio_require_genuses: bool = False  # only bodies whose genera are known (DSS)
    include_populated: bool = True
    skip_mapped: bool = True  # leave out systems where you have mapped every such body
    refresh: bool = False  # ignore the cached Spansh data


class RouteStopUpdate(CamelModel):
    """PUT /api/route/stops/{seq}: any of the fields."""

    skipped: bool | None = None
    position: int | None = Field(None, ge=1)  # move the stop to this place (1-based)


class RoutePoint(CamelModel):
    name: str
    x: float
    y: float
    z: float


class RouteBodyView(CamelModel):
    body_id: int
    name: str
    short_name: str
    kind: BodyKind  # a mapping kind, or "bio" when the body counts for its biology only
    distance_ls: float | None
    mapping_value: int  # Spansh estimate (no first-discovery bonuses)
    scanned: bool  # by you (journal)
    mapped: bool  # by you (journal)
    bio_signals: int  # > 0 when the body counts for its biology
    bio_min: int  # base values of the predicted species (no first-footfall bonus)
    bio_max: int
    bio_done: int  # species you analysed there (journal)
    genuses: list[str]  # English genus names confirmed by DSS (may be empty)
    done: bool  # mapped (when it counts for mapping) and every species analysed


class RouteStopView(CamelModel):
    seq: int  # 1-based position in the route
    address: str
    name: str
    x: float  # galactic coordinates, ly
    y: float
    z: float
    hop_ly: float  # from the previous stop (the start for the first)
    jumps: int | None  # estimated from your ship's jump range
    population: int | None  # None: not known (yet)
    bodies: list[RouteBodyView]
    value: int  # mapping payouts + optimistic biology estimate
    value_min: int  # with the pessimistic biology estimate
    visited: bool  # you have been in the system
    done: bool  # every body mapped
    skipped: bool
    here: bool  # you are in this system now


class RouteView(CamelModel):
    online: bool  # route building available (not --offline)
    building: bool
    error: str | None  # unknown_system | no_destination | spansh_unavailable | internal
    error_detail: str | None
    params: RouteRequest | None  # of the current route
    created_at: str | None
    data_at: str | None  # oldest Spansh data the route was built from
    truncated: bool  # more systems qualified than the route holds
    source: RoutePoint | None
    destination: RoutePoint | None
    stops: list[RouteStopView]
    next_seq: int | None  # the first stop neither done nor skipped
    current_system: str | None
    current_position: RoutePoint | None  # the current system, when its coordinates are known
    distance_to_next_ly: float | None  # from where you are
    jumps_to_next: int | None
    jump_range_ly: float | None
    total_value: int
    collected_value: int  # mapping value of the route bodies you mapped
    total_ly: float
    direct_ly: float | None  # line mode: straight distance from the start to the destination
    remaining_ly: float  # from the next stop on, along the route
    done_count: int
    skipped_count: int


Topic = Literal["system", "surface", "session", "stats", "history", "route"]

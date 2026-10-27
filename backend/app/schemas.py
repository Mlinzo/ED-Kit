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
# new: never in your codex; new_region: in your codex, but not for this region; new_colour:
# the species is in your codex for this region, this colour is not (a new entry all the same);
# logged: known
CodexStatus = Literal["new", "new_region", "new_colour", "logged"]
# What a bookmark marks, and its tag (app.bookmarks).
BookmarkKind = Literal["system", "body", "station", "place"]
BookmarkCategory = Literal["mining", "bio", "geo", "trade", "scenic", "other"]


class BookmarkView(CamelModel):
    """A bookmark of yours (app.bookmarks): a system, a body, a station or a place on a planet."""

    id: int
    kind: BookmarkKind
    system_address: str
    system_name: str | None
    body_id: int | None  # a body's; a place's body
    body_name: str | None
    lat: float | None  # a place
    lon: float | None
    title: str | None  # a station's name; a place's name (yours or the mark's)
    category: BookmarkCategory
    comment: str  # "" when none
    created_at: str
    updated_at: str
    distance_ly: float | None = None  # from your current system (the bookmarks list)


class HighlightSettings(CamelModel):
    """Minimum values for a body to be highlighted (credits)."""

    dss_min: int  # estimated payout after DSS mapping
    bio_min: int  # estimated exobiology value on the body (optimistic, incl. bonus)


class SpeciesView(CamelModel):
    genus: str  # English genus name, e.g. "Stratum"
    species: str  # English species name, e.g. "Stratum Tectonicas"
    value: int  # base value, credits
    bonus_value: int  # value incl. first-footfall bonus when it applies, else == value
    # The body would give the bonus, but the journal (WasLogged) says someone handed this
    # species in from it before you.
    bonus_ruled_out: bool = False
    colony_range_m: int
    status: SpeciesStatus
    samples: int  # 0..3
    certain: bool  # True once the genus is confirmed by DSS (or deduced) or species was scanned
    # Certain without DSS: the genera that can grow on the body fill every bio signal.
    deduced: bool = False
    # By colour variant (the parent star's class, or a material on the body); by species when
    # the colour cannot be told.
    codex: CodexStatus
    colour: str | None = None  # "Teal"; candidates joined with " / " when not certain
    # One of several species left of its genus: the chance it is the one here (0..1); None for a
    # lone species or without Canonn data.
    chance: float | None = None


class SignalsView(CamelModel):
    bio: int = 0
    geo: int = 0
    human: int = 0
    mining: int = 0  # Planetary Mining Location
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


class BodyMaterialView(CamelModel):
    """A raw element in a planet's crust (your scan or Spansh), as the game lists it."""

    symbol: str  # journal symbol, lower case ("iron")
    name: str  # "Iron"
    percent: float
    grade: int | None  # 1 (very common) .. 4 (rare); None: not in the catalog


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
    footfall_claimable: bool  # landable, nobody mapped or walked here, not a populated system
    # Why not, though the journal says nobody walked here (None: it does not, or it is yours).
    footfall_taken: Literal["populated", "mapped"] | None
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
    materials: list[BodyMaterialView] = []  # a planet's elements, the most first
    bookmark: BookmarkView | None = None  # yours, on the body (app.bookmarks)
    places: list[BookmarkView] = []  # your bookmarked places on its surface
    time_s: int = 0  # time you spent at it (a planet), every visit together (app.projector)
    earned_value: int = 0  # your scans of it and species analysed on it (lost data excluded)


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


# A system you have not been to, shown from Spansh / EDSM: pending (being asked), missing (they
# know no bodies), offline (--offline: not asked).
CommunityLookup = Literal["pending", "missing", "offline"]


class SystemView(CamelModel):
    address: str | None
    name: str | None
    star_pos: tuple[float, float, float] | None
    body_count: int | None  # from FSS honk; None until honked
    scanned_count: int
    all_bodies_found: bool
    # The game knew the system in advance (most populated ones): every body was known before the
    # honk and none gets a Scan in the journal, so their FSS data does not sell (app.views).
    known_in_advance: bool = False
    is_current: bool  # the commander is in this system now (else: a system from the history)
    current_system: SystemRef | None  # where the commander is now
    current_body_id: int | None  # body the commander is near/on (current system only)
    # The ship on the map (current system only): the body the game last put you at, and whether
    # you are still there (false once you flew off: the last known place).
    ship_body_id: int | None = None
    ship_near: bool = False
    visits: int  # arrivals in this system
    first_visit_at: str | None
    last_visit_at: str | None
    time_s: int = 0  # time you spent here, every visit together (app.projector)
    earned_value: int = 0  # your scans and species analysed here (lost data excluded)
    # The last journal event: the time spent is counted up to it (the current place counts on
    # while the game runs).
    time_as_of: str | None = None
    # Neighbours in the history (systems ordered by their last visit), for stepping through it.
    prev_system: SystemRef | None
    next_system: SystemRef | None
    bodies: list[BodyView]
    barycentres: list[BarycentreView]
    totals: SystemTotals
    lookup: CommunityLookup | None = None  # never visited: where its community data stands
    # Yours (app.bookmarks): on the system, and on its stations; bodies carry their own.
    bookmark: BookmarkView | None = None
    stations: list[BookmarkView] = []


class SamplePoint(CamelModel):
    n: int  # sample number 1..3
    lat: float
    lon: float


class ActiveScanView(CamelModel):
    genus: str
    species: str
    value: int
    bonus_value: int
    bonus_ruled_out: bool = False  # as in SpeciesView
    colony_range_m: int
    codex: CodexStatus
    samples: int  # 1..3 (Log counts as the first sample)
    points: list[SamplePoint]  # positions of taken samples
    colour: str | None = None  # "Teal": the journal names the variant


class GlobeMark(CamelModel):
    """A place on the planet globe. Where it comes from goes with the kind: sample = recorded by
    the app from Status.json when you took it; codex, landing, takeoff, settlement = your
    journal."""

    kind: Literal["sample", "codex", "landing", "takeoff", "settlement"]
    lat: float
    lon: float
    name: str  # species ("Stratum Tectonicas"), codex entry or settlement name
    colour: str | None = None  # sample: the variant colour ("Teal")
    n: int | None = None  # sample number 1..3
    status: str | None = None  # sample: sampling | abandoned (left before the third) | analysed
    # ISO time: the landing, take-off, codex entry, approach, or when sampling began
    at: str | None = None


class GlobeShip(CamelModel):
    """Your ship on this planet, from the journal (Touchdown / Liftoff)."""

    # landed: where it touched down (recalled: it landed by itself to pick you up);
    # dismissed: sent away while you stay on the surface.
    state: Literal["landed", "recalled", "dismissed"]
    lat: float | None
    lon: float | None
    at: str


class CommunityFinds(CamelModel):
    """Other players' finds on this planet (Canonn): one entry per find, its points."""

    name: str  # "Osseus Discus - Blue", as Canonn names it (English)
    category: str  # Canonn's hud_category: Biology, Geology, Guardian, Thargoid, ...
    points: list[tuple[float, float]]  # (lat, lon)
    yours: bool  # you sampled this species here (any colour)


class GlobeView(CamelModel):
    body_name: str
    radius_m: float
    marks: list[GlobeMark]
    ship: GlobeShip | None
    # Your path here, recorded by the app while it runs (app.track): stretches of (lat, lon).
    track: list[list[tuple[float, float]]] = []
    community_state: Literal["ok", "loading", "failed", "off"]  # app.canonn.State
    community_at: str | None  # when Canonn was asked (ISO)
    community: list[CommunityFinds]
    places: list[BookmarkView] = []  # your bookmarked places on this planet


class SurfaceView(CamelModel):
    body: BodyView | None
    active_scan: ActiveScanView | None
    globe: GlobeView | None = None  # a landable planet with a known radius


class SellStationView(CamelModel):
    name: str
    # starport | outpost | planetary | settlement | megaship | carrier | other
    kind: str
    dist_ls: int | None  # from the arrival star
    cartographics: bool  # Universal Cartographics: buys exploration data
    genomics: bool  # Vista Genomics: buys organic data
    seen_at: str | None  # a carrier: when it was last reported there (ISO)
    docked: bool  # you docked here
    access: str | None  # a carrier: all (open to everybody, per Spansh) | unknown
    permit: bool  # the system needs a permit
    bookmark: BookmarkView | None = None  # yours, on the station


class SellPlaceView(CamelModel):
    system_name: str
    system_address: str | None
    distance_ly: float  # from you
    jumps: int | None  # at the current ship's jump range (None: unknown)
    stations: list[SellStationView]  # one that buys both, else the best for each
    more: int  # other stations there that buy data
    # Jumps along the route plotted in the game to it (1: the next jump; None: off it).
    route_jump: int | None = None


class SellCarrierHint(CamelModel):
    """The nearest carrier, when carriers are hidden and it is nearer than every station."""

    name: str
    system_name: str
    distance_ly: float
    jumps: int | None


class SellView(CamelModel):
    # ready | pending (searching Spansh) | failed | offline (only where you docked)
    # | unknown_position
    state: str
    ship: str | None  # the current ship's name
    pad: str | None  # S | M | L: the landing pad it needs (None: unknown)
    places: list[SellPlaceView]  # nearest first
    # Unsold bodies of the system you are in: its exploration data sells only in another system
    here_carto_bodies: int
    carriers: bool  # fleet carriers listed (asked for)
    nearer_carrier: SellCarrierHint | None
    searched_at: str | None  # when Spansh was asked (ISO)


class ShopShipStats(CamelModel):
    """A ship as sold (EDSY): base price, stock performance and its slots."""

    pad: str | None  # S | M | L
    price: int | None  # base price, credits
    speed: int | None  # m/s
    boost: int | None
    shields: int | None  # base strength (MJ)
    armour: int | None  # base hull
    mass: float | None  # hull, t
    hardness: int | None
    masslock: int | None
    crew: int | None  # seats
    core: list[int]  # power plant, thrusters, FSD, life support, distributor, sensors, tank
    internal: list[int]  # optional internal sizes
    military: list[int]  # military slot sizes
    hardpoints: list[int]  # 1 small .. 4 huge
    utility: int  # utility mounts
    fighter_bay: bool = False  # a fighter hangar fits


class ShopRankNeed(CamelModel):
    navy: str  # empire | federation
    need: str  # the rank's game name


class ShopShipView(CamelModel):
    symbol: str  # journal symbol, lower case
    name: str
    stats: ShopShipStats | None = None
    rank: ShopRankNeed | None = None  # the navy rank needed to buy it
    unsold: bool = False  # no station sells it yet (a new ship, for ARX first)
    hangars: list[str] | None = None  # a ship-launched vessel: the modules that carry it


class ShopVariantView(CamelModel):
    symbol: str  # journal symbol, lower case: what the search asks for
    size: int  # the module class
    rating: str
    mount: str | None  # Fixed | Gimballed | Turreted
    guidance: str | None  # Dumbfire | Seeker
    price: int | None = None  # credits (EDSY)
    mass: float | None = None  # t
    power: float | None = None  # MW
    integrity: int | None = None
    stats: dict[str, float] = {}  # the figures of its kind, EDSY attribute -> value


class ShopModuleView(CamelModel):
    name: str
    category: str  # core | optional | hardpoint | utility
    type: str | None = None  # EDSY module type (cfsd, isg, hmc...): its icon
    unlock: str | None  # powerplay | techbroker: sold only to commanders who unlocked it
    variants: list[ShopVariantView]


class ShopCommodityView(CamelModel):
    symbol: str  # journal symbol, lower case
    name: str  # as markets name it
    category: str  # the market's: Metals, Minerals, Chemicals...
    rare: bool = False  # a rare commodity: one station sells it, a little at a time


class EngineeringKindView(CamelModel):
    """A kind of module engineers work on (EDSY's key, e.g. cfsd) and what they can do to it."""

    key: str
    name: str  # EDSY's, e.g. "Frame Shift Drives"
    blueprints: list[str]  # keys into EngineeringCatalogView.blueprints
    experimentals: list[str]


class EngineeringBlueprintView(CamelModel):
    name: str
    grades: list[dict[str, int]]  # per grade: material symbol -> how many one roll takes


class EngineeringExperimentalView(CamelModel):
    name: str
    materials: dict[str, int]


class EngineeringMaterialView(CamelModel):
    """A material the Shop's catalog lacks (new Thargoid ones), as EDSY has it."""

    name: str
    type: str  # raw | manufactured | encoded
    grade: int


class EngineeringCatalogView(CamelModel):
    modules: list[EngineeringKindView]
    blueprints: dict[str, EngineeringBlueprintView]
    experimentals: dict[str, EngineeringExperimentalView]
    extra_materials: dict[str, EngineeringMaterialView]


class EngineeringGoalView(CamelModel):
    id: int
    module: str  # an EngineeringKindView key
    blueprint: str
    grade_from: int  # the grade the module has now (0: none)
    grade_to: int
    experimental: str | None
    count: int  # how many such modules


class EngineeringGoalRequest(CamelModel):
    module: str
    blueprint: str
    grade_from: int = Field(0, ge=0, le=5)
    grade_to: int = Field(ge=0, le=5)
    experimental: str | None = None
    count: int = Field(1, ge=1, le=99)


class EngineeringNeedView(CamelModel):
    symbol: str  # material, journal symbol
    need: int  # what the goals take in all
    have: int


class EngineeringFittedView(CamelModel):
    """A module of your current ship engineers work on (a new goal starts from its grade)."""

    module: str  # an EngineeringKindView key
    blueprint: str | None  # None: not engineered, or a blueprint the catalog lacks
    grade: int  # 0 with no blueprint


class EngineeringView(CamelModel):
    """GET /api/view/engineering: your goals and what they take against your stock."""

    goals: list[EngineeringGoalView]
    needs: list[EngineeringNeedView]  # every material the goals take
    stock: dict[str, int]  # your materials by symbol (the journal's latest list and since)
    stock_at: str | None  # when the journal last listed them all (None: never)
    fitted: list[EngineeringFittedView]  # your current ship's modules engineers work on


class ShopMaterialView(CamelModel):
    symbol: str  # journal symbol, lower case
    name: str
    type: str  # raw | manufactured | encoded
    grade: int  # 1 (very common) .. 5 (very rare); raw ones go to 4
    group: str | None  # the group material traders go by (raw: "1".."7"); None: not traded
    sources: list[str] = []  # where it comes from (Elite Dangerous Wiki), English
    rich: float | None = None  # raw: the share (%) on a body that counts as much


class ShopCatalogView(CamelModel):
    ships: list[ShopShipView]
    modules: list[ShopModuleView]
    commodities: list[ShopCommodityView] = []
    materials: list[ShopMaterialView] = []
    engineering: EngineeringCatalogView | None = None


class ShopStationView(CamelModel):
    name: str
    kind: str  # as in SellStationView
    dist_ls: int | None
    price: int | None  # a commodity: what the market sells one tonne for
    offer_at: str | None  # when Spansh last had its shipyard / outfitting / market (ISO)
    access: str | None  # a carrier: all | unknown
    permit: bool  # the system needs a permit
    # Nothing chosen: how many ships / modules Spansh knows it sells (None: no shipyard /
    # outfitting; 0: has one, but no list)
    ship_count: int | None = None
    module_count: int | None = None
    stock: int | None = None  # a commodity: tonnes in stock when the market was reported
    bookmark: BookmarkView | None = None  # yours, on the station


class ShopPlaceView(CamelModel):
    system_name: str
    system_address: str | None
    distance_ly: float
    jumps: int | None
    stations: list[ShopStationView]  # the best first
    more: int  # other stations there selling it


class ShopBodyView(CamelModel):
    """A landable body with much of a raw material (Spansh's body search)."""

    name: str
    system_name: str
    system_address: str | None
    distance_ly: float
    jumps: int | None
    dist_ls: int | None
    share: float  # percent of the material
    gravity_g: float | None


class ShopRankView(CamelModel):
    navy: str  # empire | federation
    need: str  # the rank needed to buy the ship
    have: str | None  # yours, from the journal (None: unknown)
    ok: bool | None


class ShopView(CamelModel):
    # ready | unknown_item | offline | unknown_position | failed
    state: str
    item: str | None  # what is looked for, e.g. "Frame Shift Drive 5A"; None: the shops
    ship: str | None  # the current ship's name
    pad: str | None  # the landing pad it needs
    carriers: bool  # fleet carriers listed (asked for)
    places: list[ShopPlaceView]  # nearest first
    nearer_carrier: SellCarrierHint | None
    rank: ShopRankView | None
    unlock: str | None  # as in ShopModuleView
    searched_at: str | None  # when Spansh was asked (ISO)
    # A material: the nearest landable bodies with much of it (raw ones), and whether material
    # traders take it at all (Guardian and Thargoid materials: no; places then stay empty).
    bodies: list[ShopBodyView] = []
    traded: bool = True


class RiskPoint(CamelModel):
    """Unsold data when you left a system (the first point: right after the last sale)."""

    at: str  # ISO timestamp of the arrival
    system_name: str | None
    carto: int
    bio: int


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
    last_sale_station: str | None
    last_sale_system: str | None
    last_docked_at: str | None  # ISO timestamp
    last_docked_station: str | None
    last_docked_system: str | None
    growth: list[RiskPoint]  # unsold data system by system since the last sale


class SessionCodexEntry(CamelModel):
    """A first entry in your codex (the game's IsNewEntry)."""

    name: str  # as the game named it (Name_Localised)
    category: Literal["bio", "stellar", "other"]


class SessionEntry(CamelModel):
    """One game run (app.sessions): from loading the commander to quitting the game."""

    started_at: str  # ISO timestamp of the first LoadGame
    ended_at: str  # Shutdown, or the last event of the run (the game crashed, or still running)
    open: bool  # the latest run, with no Shutdown yet: still playing (or the game crashed)
    duration_s: int
    jumps: int
    distance_ly: float
    systems: int  # systems arrived in
    bodies_scanned: int
    bodies_mapped: int
    species_analysed: int
    first_discoveries: int
    first_mapped: int
    first_footfalls: int
    carto_value: int  # estimate for the bodies scanned and mapped then, sold or not
    bio_value: int  # the species analysed then, incl. bonus (the sale value once sold)
    value: int  # carto + bio
    lost_value: int  # gathered then and lost on a death since (not in `value`)
    deaths: int
    codex: list[SessionCodexEntry]  # new codex entries, in the order logged


class SessionsView(CamelModel):
    sessions: list[SessionEntry]  # newest first


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
    fuel_main: float | None = None  # t in the main tank (in the ship only)
    # What is targeted in the game (Destination): a system address (a string, like everywhere in
    # the API) and the BodyID there (a station or a signal has an id that is no body).
    destination_system: str | None = None
    destination_body: int | None = None


class IngestState(CamelModel):
    backfill_done: bool
    files_total: int
    files_done: int
    events: int
    journal_dir: str
    journal_dir_found: bool
    journal_files: int = 0  # journal files in the folder (0 before the game was ever run)
    journal_dir_fixed: bool = False  # set at launch (--journal-dir / EDEK_JOURNAL_DIR)
    journal_dir_default: str = ""  # the folder read unless another is chosen in the app
    game_running: bool | None = None  # process list, else the journal (None: unknown)
    # Where data.db is (app.datadir), and its size against the journals it copies.
    data_dir: str = ""
    data_dir_default: str = ""  # the standard folder (%LOCALAPPDATA%\EDExplorerKit)
    data_dir_fixed: bool = False  # set at launch (--data-dir / EDEK_DATA_DIR)
    data_dir_pending: str | None = None  # chosen in the app: the database moves at next start
    db_bytes: int = 0  # data.db and its write-ahead log
    journal_bytes: int = 0  # the journal files of the folder read
    free_bytes: int | None = None  # free space on the data folder's drive
    # The journal read waits (app.service): space = the database would not fit on its drive;
    # large = it would grow past large_db_bytes in the standard folder (until "keep it here").
    hold: Literal["space", "large"] | None = None
    hold_bytes: int = 0  # how much the database would grow by reading what waits
    big_data_ok: bool = False  # "keep it here" was chosen for a big database
    large_db_bytes: int = 500_000_000  # app.datadir.LARGE_DB_BYTES
    low_free_bytes: int = 1_000_000_000  # app.datadir.LOW_FREE_BYTES


class JournalDirRequest(CamelModel):
    path: str | None = None  # None or empty: the standard folder


class DataDirRequest(CamelModel):
    path: str | None = None  # None or empty: back to the standard folder


class NetworkInfo(CamelModel):
    """Where a phone opens the page."""

    lan: bool  # other devices may connect (off with --local)
    urls: list[str]  # the page on this PC's network addresses, the likeliest first
    this_pc: bool  # the request comes from the PC the app runs on


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
    bookmark: BookmarkView | None = None  # yours, on the system
    inner_bookmarks: int = 0  # your bookmarks there besides the system's: bodies, places, stations
    time_s: int = 0  # time you spent there, every visit together (app.projector)


class HistoryView(CamelModel):
    current_address: str | None
    systems: list[HistoryEntry]  # most recently visited first
    time_as_of: str | None = None  # as SystemView.time_as_of


# What the community databases know: its arrival star scanned | some bodies | only the system
# (seen in somebody's plotted route) | nothing | not asked yet.
DiscoveryState = Literal["scanned", "bodies", "seen", "unknown", "pending"]


class DiscoveryChanceView(CamelModel):
    probability: float | None  # that nobody has discovered it yet; None until checked
    state: DiscoveryState
    # visited | scanned | bodies_known | seen_in_routes | not_in_databases | busy_area |
    # inner_area
    reasons: list[str]


RouteMode = Literal["riches", "line"]  # around a start point | along a straight line
# credits: mapping and biology payouts | codex: new codex entries (biology only)
# | transit: just get to the destination (Spansh neutron route, its waypoints are the stops)
# | firsts: systems nobody has likely discovered yet (app.routefirsts)
RouteGoal = Literal["credits", "codex", "transit", "firsts"]
# elw | terraformable water world | terraformable high metal content | water world |
# ammonia world | terraformable rocky body (app.routeplan.BODY_TYPES, priced by mapping) |
# bio: landable bodies with biological signals (priced by their predicted species)
BodyKind = Literal["elw", "tww", "thmc", "ww", "aw", "trocky", "bio"]


class RouteRequest(CamelModel):
    """POST /api/route: plan a new route (replaces the current one)."""

    mode: RouteMode
    goal: RouteGoal = "credits"
    source: str = ""  # empty: the current system
    destination: str | None = None  # line mode, transit
    radius_ly: float = Field(200, ge=10, le=1000)  # riches mode
    deviation_ly: float = Field(25, ge=5, le=100)  # line mode: max distance from the line
    max_systems: int = Field(100, ge=1, le=1000)  # stops at most (line: the most valuable)
    body_types: list[BodyKind] = Field(
        default_factory=lambda: ["elw", "tww", "thmc", "bio"], min_length=1
    )
    min_value: int = Field(300_000, ge=0)  # estimated payout after mapping, per body
    min_system_value: int = Field(0, ge=0)  # still to earn in a system: mapping + biology
    bio_min_value: int = Field(5_000_000, ge=0)  # biology per body, optimistic estimate
    # A species that may grow on the body is worth at least this (base value; 0: any)
    bio_min_species_value: int = Field(0, ge=0)
    bio_require_genuses: bool = False  # only bodies whose genera are known (DSS)
    include_populated: bool = True
    skip_mapped: bool = True  # leave out systems you have finished or sampled species in
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


class RouteCodexView(CamelModel):
    """A species that may give a new codex entry on a route body."""

    species: str  # English name, e.g. "Aleoida Arcus"
    colour: str | None  # "Teal"; None when it cannot be told
    chance: float  # 0..1, after the stops before it in the route


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
    codex: list[RouteCodexView] = []  # codex routes: entries still new here, likeliest first


class RouteStopView(CamelModel):
    seq: int  # 1-based position in the route
    address: str
    name: str
    x: float  # galactic coordinates, ly
    y: float
    z: float
    hop_ly: float  # from the previous stop (the start for the first)
    jumps: int | None  # estimated from your ship's jump range (transit: Spansh's count)
    population: int | None  # None: not known (yet)
    bodies: list[RouteBodyView]
    value: int  # mapping payouts + optimistic biology estimate
    value_min: int  # with the pessimistic biology estimate
    visited: bool  # you have been in the system
    done: bool  # every body mapped (transit: arrived here or further on)
    skipped: bool
    # Left unfinished on the way: you arrived at a later stop since the route was made (not transit)
    passed: bool = False
    here: bool  # you are in this system now
    codex_new: float = 0.0  # codex routes: new entries expected here (none counted twice)
    neutron: bool = False  # transit routes: supercharge the FSD at this stop's neutron star
    # Firsts routes: how likely nobody has discovered it yet (from what Spansh knew when the
    # route was made), how far it may be from x, y, z on each axis (0: exact; a missing number
    # in its boxel is placed at the boxel's centre), and your scan of its arrival star: your
    # first discovery (or not; None without a scan).
    discovery: DiscoveryChanceView | None = None
    spread_ly: float = 0.0
    first: bool | None = None


class NeutronWaypointView(CamelModel):
    name: str
    address: str
    x: float
    y: float
    z: float
    jumps: int  # from the previous waypoint
    neutron: bool  # supercharge here
    left_ly: float  # to the destination
    visited: bool  # you have been here since the plan was made


class NeutronPlanView(CamelModel):
    """Spansh's neutron route from where you were to the next stop (POST /api/route/neutron)."""

    building: bool
    error: str | None  # unknown_system | spansh_unavailable | no_route | internal
    created_at: str | None
    source: str | None
    destination: str | None
    stale: bool  # made for another stop than the next one
    efficiency: int | None
    range_ly: float | None
    multiplier: int | None  # supercharge: 4, or 6 for the SCO mk II
    total_jumps: int | None
    direct_jumps: int | None  # without supercharges, from your jump range
    waypoints: list[NeutronWaypointView]  # the start first
    next_index: int | None  # the waypoint to plot to next


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
    jumps_to_next: int | None  # with the range now
    jump_range_ly: float | None  # MaxJumpRange: empty hold, fuel for one jump (the game's max)
    jump_range_now_ly: float | None  # with the fuel and cargo aboard
    jump_range_full_ly: float | None  # with a full tank: the hops between stops, Spansh routes
    total_value: int
    collected_value: int  # mapping value of the route bodies you mapped
    total_ly: float
    direct_ly: float | None  # line mode: straight distance from the start to the destination
    remaining_ly: float  # from the next stop on, along the route
    done_count: int
    skipped_count: int
    neutron: NeutronPlanView | None  # Spansh neutron route to the next stop, once asked for
    codex_left: float = 0.0  # codex routes: new entries expected at the stops left
    # The next stop is beyond the range now but one jump away with at most this much fuel (t).
    one_jump_fuel_t: float | None = None
    firsts_found: int = 0  # firsts routes: stops where your scan of the arrival star was a first
    firsts_left: float = 0.0  # firsts routes: first discoveries expected at the stops left


class NeutronRequest(CamelModel):
    """POST /api/route/neutron: plan a neutron route from here to the route's next stop."""

    efficiency: int = Field(60, ge=1, le=100)


# Arrival star of a system on the plotted route: fuel scoop, supercharge, danger.
StarKind = Literal["scoopable", "neutron", "white_dwarf", "black_hole", "other"]


class NavHopView(CamelModel):
    index: int  # 0: the system the route was plotted from
    address: str
    name: str
    star_class: str  # journal StarClass, e.g. "K", "DA", "N", "M_RedGiant"
    star_kind: StarKind
    x: float
    y: float
    z: float
    distance_ly: float  # from the previous system (0 for the first)
    status: Literal["passed", "here", "ahead"]
    fuel_used: float | None  # estimated for the jump into it (ahead)
    fuel_after: float | None  # left in the main tank on arrival, before scooping (ahead)
    refuel: bool  # the forecast scoops the tank full here
    short: bool  # the fuel runs out on the jump into it
    discovery: DiscoveryChanceView | None  # ahead
    discovered_by_you: bool | None  # your scan of its arrival star: first discovery (or not)
    bookmark: BookmarkView | None = None  # yours, on the system


class FuelForecastView(CamelModel):
    level: float | None  # main tank now, t
    capacity: float | None
    has_scoop: bool
    learnt_from: int  # unboosted jumps of this drive behind the estimate (0: no estimate yet)
    needed: float | None  # for every jump left, without refuelling, t
    enough: bool | None  # the forecast reaches the destination (scooping on the way)
    short_at: int | None  # index of the hop where the fuel runs out
    jumps_to_scoop: int | None  # to the next scoopable arrival star ahead (None: none)
    fuel_at_scoop: float | None  # left on arrival there, t
    longest_dry: int  # most jumps ahead from one scoopable star to the next (or the end)
    longest_dry_fuel: float | None  # what those jumps need from a full tank, t


class NavRouteView(CamelModel):
    """The route plotted in the game (NavRoute.json) and what lies ahead on it."""

    online: bool  # discovery lookups available (not --offline)
    checking: bool  # discovery lookups in progress
    plotted_at: str | None
    hops: list[NavHopView]  # [] when no route is plotted
    here_index: int | None  # you are at this hop; None: not on the route
    jumps_left: int
    ly_left: float
    fuel: FuelForecastView
    next_neutron: int | None  # jumps to the next neutron star ahead
    next_white_dwarf: int | None
    neutrons_ahead: int
    white_dwarfs_ahead: int
    undiscovered_expected: float  # sum of the chances ahead: first discoveries to expect
    # fuel_short | refuel_here | fuel_tight | dry_stretch | neutron_next | white_dwarf_next |
    # off_route
    warnings: list[str]


class GalaxySystemView(CamelModel):
    """A visited system on the galaxy map."""

    address: str
    name: str
    x: float  # galactic coordinates, ly
    y: float
    z: float
    visits: int
    first_visit_at: str
    last_visit_at: str
    value: int  # your scans and analysed species there, earned or pending (estimate)
    unsold_value: int
    firsts: int  # first discoveries + first maps + first footfalls
    species: int  # analysed
    star_type: str | None  # journal StarType of its arrival star (colour)
    notable: list[str]  # as in the history: elw, neutron, ...
    region: int | None  # codex region number (1..42, app.regionmap); None off the map


class GalaxyBookmarkView(CamelModel):
    """A system holding bookmarks of yours (its own, or its bodies', places', stations'), visited
    or not."""

    address: str
    name: str | None
    x: float
    y: float
    z: float
    bookmark: BookmarkView | None  # the system's own
    inner: int  # the others there


class BookmarkRequest(CamelModel):
    """POST /api/bookmarks: bookmark a system, a body, a station (by its name) or a place (body,
    latitude, longitude). The names and position help show a place you have not been to."""

    kind: BookmarkKind
    system_address: str
    body_id: int | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    title: str | None = Field(default=None, max_length=400)
    category: BookmarkCategory | None = None
    comment: str = Field(default="", max_length=4000)
    system_name: str | None = None
    body_name: str | None = None
    x: float | None = None
    y: float | None = None
    z: float | None = None


class BookmarkHereRequest(CamelModel):
    """POST /api/bookmarks/here: bookmark where you are now: the system, the body you are at,
    your spot on its surface, the station you are docked at."""

    what: Literal["system", "body", "place", "station"]
    category: BookmarkCategory | None = None
    comment: str = Field(default="", max_length=4000)


class BookmarkPatch(CamelModel):
    """PUT /api/bookmarks/{id}: a new title, tag or comment (left out: unchanged)."""

    title: str | None = Field(default=None, max_length=400)
    category: BookmarkCategory | None = None
    comment: str | None = Field(default=None, max_length=4000)


class BookmarkHere(CamelModel):
    """Where you are, as far as the journal says: what "bookmark it" can mark right now (the
    browser adds the live state: on the ground, docked)."""

    system_address: str | None
    system_name: str | None
    body_id: int | None  # the body you are at (approached, landed on)
    body_name: str | None
    station: str | None  # the station you last docked at, in this system


class BookmarksView(CamelModel):
    """Every bookmark of yours, the latest first, with how far each system is from you."""

    items: list[BookmarkView]
    here: BookmarkHere


class GalaxyRegionView(CamelModel):
    """A codex region you have been to (or logged codex entries in)."""

    id: int  # 1..42, "$Codex_RegionName_<id>;"
    name: str  # English game name
    systems: int  # visited systems there
    first_visit_at: str | None
    value: int  # earned there (estimate), as GalaxySystemView.value
    codex: int  # distinct codex entries you logged there
    species: int  # of them, distinct exobiology species


class GalaxyEngineerView(CamelModel):
    """An engineer's workshop (app.engineers) and how far you are with them (the journal)."""

    name: str
    system: str
    address: str  # SystemAddress
    base: str
    kind: Literal["ship", "suit"]  # ship modules, or suits and weapons on foot
    x: float
    y: float
    z: float
    progress: Literal["known", "invited", "acquainted", "unlocked"] | None  # None: not met
    rank: int | None  # 1..5 once unlocked (ship engineers)


class GalaxyDeathView(CamelModel):
    at: str
    system: int | None  # index into GalaxyView.systems
    name: str | None
    lost_value: int  # unsold data lost (estimate)
    killers: list[str]


class GalaxyView(CamelModel):
    commander: str | None
    systems: list[GalaxySystemView]  # every visited system with known coordinates
    # Your travels: runs of indices into `systems` in arrival order, broken where you did not
    # fly (a respawn, a login somewhere else).
    path: list[list[int]]
    current: int | None  # index of the system you are in
    deaths: list[GalaxyDeathView]
    route: list[RoutePoint]  # stops of the planned route still to do, the next first
    plotted: list[RoutePoint]  # the route plotted in the game, from where you are
    distance_ly: float  # jumped, all time
    farthest_from_sol: NamedValue | None  # value in ly
    region: int | None  # the region you are in
    regions: list[GalaxyRegionView]  # in the order you first came
    engineers: list[GalaxyEngineerView]
    online: bool  # Spansh/EDSM are asked: any system opens on the System tab (else: only yours)
    bookmarks: list[GalaxyBookmarkView] = []  # systems holding bookmarks, position known


class LiveSystemView(CamelModel):
    """A system with someone in it lately (EDDN, app.eddn): how we know, never who."""

    address: str
    name: str
    x: float
    y: float
    z: float
    age_s: int  # since the latest sign
    players: int  # distinct uploaders in the window
    arrived: int  # FSDJump / Location / CarrierJump
    scans: int  # FSS, bodies, signals, nav beacons
    codex: list[str]  # codex entries logged (English names, newest first, up to 3)
    docked: int  # docked, or approached a settlement
    carriers: int  # fleet carriers among the signals scanned there


class LiveView(CamelModel):
    available: bool  # false with --offline
    state: Literal["off", "connecting", "live"]
    since: str | None  # listening since (ISO)
    window_min: int
    span_s: int  # how far back the signs shown go (less than the window just after connecting)
    players: int  # distinct uploaders in the window, all systems
    systems: list[LiveSystemView]  # the latest first


Topic = Literal[
    "system", "surface", "session", "stats", "history", "route", "navroute", "galaxy", "live"
]

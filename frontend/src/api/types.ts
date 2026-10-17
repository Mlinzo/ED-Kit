// Mirrors backend/app/schemas.py — keep both in sync.
// 64-bit ids (system address, body id64) are strings: they exceed 2^53.

/** GET/PUT /api/settings — minimum values (credits) for a body to be highlighted. */
export interface HighlightSettings {
  /** estimated payout after DSS mapping */
  dssMin: number
  /** estimated exobiology value on the body (optimistic, incl. first-footfall bonus) */
  bioMin: number
}

export type SpeciesStatus = 'predicted' | 'sampling' | 'analysed'

/** new: never in your codex; new_region: in your codex but not for this region; logged: known.
 *  Species level for now (colour variants are not predicted yet). */
export type CodexStatus = 'new' | 'new_region' | 'logged'

export interface SpeciesView {
  genus: string
  species: string
  value: number
  bonusValue: number
  colonyRangeM: number
  status: SpeciesStatus
  samples: number
  certain: boolean
  codex: CodexStatus
}

export interface SignalsView {
  bio: number
  geo: number
  human: number
  other: number
}

export type ParentKind = 'Star' | 'Planet' | 'Null' | 'Ring' // Null = barycentre

export interface ParentRef {
  kind: ParentKind
  bodyId: number
}

/** Keplerian elements as reported by the journal (the map is not to scale). */
export interface OrbitView {
  epoch: string | null
  semiMajorAxisM: number | null
  eccentricity: number | null
  inclinationDeg: number | null
  periapsisDeg: number | null
  ascendingNodeDeg: number | null
  meanAnomalyDeg: number | null
  periodS: number | null
}

export interface RingView {
  name: string | null
  /** eRingClass_Icy | eRingClass_Rocky | eRingClass_Metalic | eRingClass_MetalRich */
  ringClass: string | null
  innerM: number | null
  outerM: number | null
}

/** Everything the 3D map needs to draw a body. */
export interface BodyVisual {
  planetClass: string | null
  starType: string | null
  starSubclass: number | null
  luminosity: string | null
  /** '' = no atmosphere */
  atmosphereType: string | null
  terraformState: string | null
  volcanism: string | null
  temperatureK: number | null
  surfacePressureAtm: number | null
  /** gas -> percent */
  atmosphereComposition: Record<string, number>
  massEm: number | null
  radiusM: number | null
  stellarMass: number | null
  axialTiltRad: number | null
  rotationPeriodS: number | null
  tidalLock: boolean | null
  composition: Record<string, number>
  rings: RingView[]
}

export type Interest = 'high' | 'medium' | 'low'

/** journal = scanned by the commander; spansh / edsm = community database (other players' scans). */
export type DataSource = 'journal' | 'spansh' | 'edsm'

/**
 * Interest reason codes: bio, map, elw, ww, aw, terraformable, rare_star, first_discovery,
 * landable_atmo, geo, rings.
 */
export type InterestReason = string

export interface BodyView {
  id64: string
  bodyId: number
  name: string
  shortName: string
  kind: 'star' | 'planet'
  /** Where the body data comes from. */
  source: DataSource
  /** ISO time of the commander's scan, or of the database record. */
  sourceAt: string | null
  /** Page of this body in the database (Spansh only). */
  sourceUrl: string | null
  /** Where the signal counts come from (null: no signal data). */
  signalsSource: DataSource | null
  /** Where the DSS genera come from (null: none known). */
  genusesSource: DataSource | null
  subtype: string
  parentId: number | null
  distanceLs: number | null
  landable: boolean
  terraformable: boolean
  atmosphere: string | null
  gravityG: number | null
  temperatureK: number | null
  radiusKm: number | null
  wasDiscovered: boolean | null
  wasMapped: boolean | null
  wasFootfalled: boolean | null
  mappedByMe: boolean
  /** The commander was the first to walk on it. */
  footfallByMe: boolean
  /** Landable, nobody walked here yet, and not in a populated system (where it never counts). */
  footfallClaimable: boolean
  signals: SignalsView
  genuses: string[]
  species: SpeciesView[]
  fssValue: number
  dssValue: number
  worthMapping: boolean
  bioValueMin: number
  bioValueMax: number
  totalValue: number
  /** Species analysed by the commander on this body. */
  bioDone: number
  /** Confirmed or DSS-certain species that would be new codex entries here. */
  codexNew: number
  /** Uncertain predictions that would be new codex entries. */
  codexMaybe: number
  /** How much attention the body deserves: drives brightness on the map. */
  interest: Interest
  reasons: InterestReason[]
  /** Everything worth doing here is done (mapped if worth it, all bio analysed). */
  done: boolean
  /** Immediate parent first; [] for the root body. */
  parents: ParentRef[]
  orbit: OrbitView | null
  visual: BodyVisual
}

export interface BarycentreView {
  bodyId: number
  /** Derived from body parent chains. */
  parents: ParentRef[]
  /** null until the barycentre itself is scanned */
  orbit: OrbitView | null
}

export interface SystemTotals {
  fss: number
  dss: number
  bioMin: number
  bioMax: number
}

export interface SystemRef {
  address: string
  name: string
}

/** GET /api/view/system — the current system; ?address=<SystemAddress> — any visited one. */
export interface SystemView {
  address: string | null
  name: string | null
  starPos: [number, number, number] | null
  bodyCount: number | null
  scannedCount: number
  allBodiesFound: boolean
  /** The commander is in this system now (false: a system from the history). */
  isCurrent: boolean
  /** Where the commander is now. */
  currentSystem: SystemRef | null
  /** Body the commander is near/on (current system only). */
  currentBodyId: number | null
  visits: number
  firstVisitAt: string | null
  lastVisitAt: string | null
  /** Neighbours in the history (systems ordered by their last visit). */
  prevSystem: SystemRef | null
  nextSystem: SystemRef | null
  bodies: BodyView[]
  barycentres: BarycentreView[]
  totals: SystemTotals
}

export interface SamplePoint {
  /** Sample number 1..3 */
  n: number
  lat: number
  lon: number
}

export interface ActiveScanView {
  genus: string
  species: string
  value: number
  bonusValue: number
  colonyRangeM: number
  codex: CodexStatus
  samples: number
  points: SamplePoint[]
}

export interface SurfaceView {
  body: BodyView | null
  activeScan: ActiveScanView | null
}

export interface SessionView {
  commander: string | null
  unsoldBioCount: number
  unsoldBioValue: number
  unsoldCartoBodies: number
  unsoldCartoSystems: number
  unsoldCartoValue: number
  atRiskValue: number
  jumps: number
  distanceLy: number
  lastSaleAt: string | null
}

export interface LiveStatus {
  timestamp: string | null
  flags: number
  flags2: number
  docked: boolean
  landed: boolean
  supercruise: boolean
  inShip: boolean
  inSrv: boolean
  onFoot: boolean
  hasLatLong: boolean
  lat: number | null
  lon: number | null
  heading: number | null
  altitude: number | null
  planetRadiusM: number | null
  bodyName: string | null
  /** Tons in the main tank (in the ship only). */
  fuelMain: number | null
}

export interface IngestState {
  backfillDone: boolean
  filesTotal: number
  filesDone: number
  events: number
  journalDir: string
  journalDirFound: boolean
  /** The game is running (process list, else the journal); null: unknown. */
  gameRunning: boolean | null
}

export interface StatCount {
  /** Stable code labelled by the UI: elw, ww, aw, terraformable, gg_water_life, gg_ammonia_life,
   *  neutron, black_hole, white_dwarf, wolf_rayet, carbon, giant, blue_star, ringed, landable_atmo */
  key: string
  count: number
}

export interface GenusProgress {
  genus: string
  found: number
  total: number
}

export interface NamedValue {
  name: string
  detail: string | null
  value: number
  at: string | null
}

export interface DayStats {
  /** YYYY-MM-DD (UTC) */
  date: string
  jumps: number
  distanceLy: number
  bodiesScanned: number
  speciesAnalysed: number
  earnings: number
  earningsCarto: number
  earningsBio: number
}

export interface KillerView {
  name: string | null
  /** journal ship/suit symbol, e.g. "federation_gunship", "python_nx" */
  ship: string | null
  rank: string | null
}

export interface DeathView {
  at: string
  system: string | null
  body: string | null
  context: 'ship' | 'srv' | 'on_foot'
  killers: KillerView[]
  lostBioCount: number
  lostBioValue: number
  lostCartoBodies: number
  /** estimate */
  lostCartoValue: number
  /** rebuy | recover | rejoin | handin | free ... */
  rebuyOption: string | null
  rebuyCost: number | null
}

/** sold: the tag is yours; pending: data not sold yet; lost: data lost on death. */
export type FirstState = 'sold' | 'pending' | 'lost'

export interface FirstEntry {
  system: string | null
  body: string
  shortName: string
  subtype: string
  at: string | null
  discovered: FirstState | null
  mapped: FirstState | null
  footfallAt: string | null
}

export interface StatsView {
  commander: string | null
  since: string | null
  daysActive: number
  jumps: number
  distanceLy: number
  systemsVisited: number
  longestJump: NamedValue | null
  /** value in ly */
  farthestFromSol: NamedValue | null
  systemsHonked: number
  systemsFullyScanned: number
  bodiesScanned: number
  starsScanned: number
  planetsScanned: number
  firstDiscoveries: number
  bodiesMapped: number
  firstMapped: number
  efficientMaps: number
  notable: StatCount[]
  mostValuableBodies: NamedValue[]
  speciesAnalysed: number
  uniqueSpecies: number
  speciesTotal: number
  generaFound: number
  generaTotal: number
  firstFootfalls: number
  codexNewEntries: number
  genusProgress: GenusProgress[]
  mostValuableSpecies: NamedValue[]
  earningsCarto: number
  earningsBio: number
  /** name: 'carto' | 'bio' */
  biggestSale: NamedValue | null
  deaths: number
  valueLost: number
  /** newest first */
  deathHistory: DeathView[]
  firstDiscoveriesSold: number
  firstDiscoveriesPending: number
  firstDiscoveriesLost: number
  firstMappedSold: number
  firstMappedPending: number
  firstMappedLost: number
  firstFootfallsTotal: number
  /** newest first, at most 500 */
  firsts: FirstEntry[]
  timeline: DayStats[]
}

/** The arrival star of a system (for the colour dot). */
export interface HistoryStar {
  starType: string | null
  starSubclass: number | null
  luminosity: string | null
  /** e.g. "K5 Va · yellow-orange star" */
  subtype: string
}

/** One visited system and what you did there. */
export interface HistoryEntry {
  address: string
  name: string
  firstVisitAt: string
  lastVisitAt: string
  visits: number
  mainStar: HistoryStar | null
  /** From the FSS honk (or community data); null when unknown. */
  bodyCount: number | null
  allBodiesFound: boolean
  bodiesScanned: number
  bodiesMapped: number
  bioSignals: number
  speciesAnalysed: number
  firstDiscoveries: number
  firstMapped: number
  firstFootfalls: number
  /** Estimated cartographic value of your scans + analysed species (incl. bonus); lost data excluded. */
  value: number
  /** Part of `value` not sold yet. */
  unsoldValue: number
  /** Data lost on death (not in `value`). */
  lostValue: number
  /** Notable finds, most remarkable first: elw, black_hole, neutron, ww, ... */
  notable: string[]
}

/** GET /api/view/history */
export interface HistoryView {
  currentAddress: string | null
  /** Most recently visited first. */
  systems: HistoryEntry[]
}

/** riches: around a start point; line: along a straight line between two systems. */
export type RouteMode = 'riches' | 'line'
/** Earth-like · terraformable water world · terraformable high metal content · water world ·
 *  ammonia world · terraformable rocky body (priced by mapping) · bio: landable bodies with
 *  biological signals (priced by their predicted species). */
export type BodyKind = 'elw' | 'tww' | 'thmc' | 'ww' | 'aw' | 'trocky' | 'bio'

/** POST /api/route — plan a new route (replaces the current one). */
export interface RouteRequest {
  mode: RouteMode
  /** Empty: the current system. */
  source: string
  destination: string | null
  radiusLy: number
  deviationLy: number
  maxSystems: number
  bodyTypes: BodyKind[]
  /** Estimated payout after mapping, per body (credits). */
  minValue: number
  /** Still to earn in a system: mapping + biology (credits). */
  minSystemValue: number
  /** Biology per body, optimistic estimate (credits). */
  bioMinValue: number
  /** Only bodies whose genera are known (DSS). */
  bioRequireGenuses: boolean
  includePopulated: boolean
  /** Leave out systems where you have mapped every such body. */
  skipMapped: boolean
  /** Ignore the cached Spansh data. */
  refresh: boolean
}

export interface RoutePoint {
  name: string
  x: number
  y: number
  z: number
}

export interface RouteBodyView {
  bodyId: number
  name: string
  shortName: string
  /** A mapping kind, or 'bio' when the body counts for its biology only. */
  kind: BodyKind
  distanceLs: number | null
  /** Spansh estimate (no first-discovery bonuses). */
  mappingValue: number
  scanned: boolean
  mapped: boolean
  /** > 0 when the body counts for its biology. */
  bioSignals: number
  /** Base values of the predicted species (no first-footfall bonus). */
  bioMin: number
  bioMax: number
  /** Species you analysed there. */
  bioDone: number
  /** English genus names confirmed by DSS (may be empty). */
  genuses: string[]
  /** Mapped (when it counts for mapping) and every species analysed. */
  done: boolean
}

export interface RouteStopView {
  /** 1-based position in the route. */
  seq: number
  address: string
  name: string
  /** Galactic coordinates, ly. */
  x: number
  y: number
  z: number
  /** From the previous stop (the start for the first). */
  hopLy: number
  /** Estimated from your ship's jump range. */
  jumps: number | null
  /** null: not known (yet). */
  population: number | null
  bodies: RouteBodyView[]
  /** Mapping payouts + optimistic biology estimate. */
  value: number
  /** With the pessimistic biology estimate. */
  valueMin: number
  visited: boolean
  /** Every body mapped. */
  done: boolean
  skipped: boolean
  /** You are in this system now. */
  here: boolean
}

/** unknown_system | no_destination | spansh_unavailable | internal */
export type RouteError = string

/** GET /api/view/route */
export interface RouteView {
  /** Route building available (not --offline). */
  online: boolean
  building: boolean
  error: RouteError | null
  errorDetail: string | null
  params: RouteRequest | null
  createdAt: string | null
  /** Oldest Spansh data the route was built from. */
  dataAt: string | null
  truncated: boolean
  source: RoutePoint | null
  destination: RoutePoint | null
  stops: RouteStopView[]
  /** The first stop neither done nor skipped. */
  nextSeq: number | null
  currentSystem: string | null
  /** The current system, when its coordinates are known. */
  currentPosition: RoutePoint | null
  distanceToNextLy: number | null
  jumpsToNext: number | null
  jumpRangeLy: number | null
  totalValue: number
  collectedValue: number
  totalLy: number
  /** Line mode: straight distance from the start to the destination. */
  directLy: number | null
  remainingLy: number
  doneCount: number
  skippedCount: number
  /** Spansh neutron route to the next stop, once asked for. */
  neutron: NeutronPlanView | null
}

export interface NeutronWaypointView {
  name: string
  address: string
  x: number
  y: number
  z: number
  /** From the previous waypoint. */
  jumps: number
  /** Supercharge here. */
  neutron: boolean
  /** To the destination. */
  leftLy: number
  /** You have been here since the plan was made (the start always). */
  visited: boolean
}

/** unknown_system | spansh_unavailable | no_route | internal */
export type NeutronError = string

/** Spansh's neutron route from where you were to the next stop (POST /api/route/neutron). */
export interface NeutronPlanView {
  building: boolean
  error: NeutronError | null
  createdAt: string | null
  source: string | null
  destination: string | null
  /** Made for another stop than the next one. */
  stale: boolean
  efficiency: number | null
  rangeLy: number | null
  /** Supercharge: 4, or 6 for the SCO mk II. */
  multiplier: number | null
  totalJumps: number | null
  /** Without supercharges, from your jump range. */
  directJumps: number | null
  /** The start first. */
  waypoints: NeutronWaypointView[]
  /** The waypoint to plot to next. */
  nextIndex: number | null
}

/** Arrival star of a system on the plotted route: fuel scoop, supercharge, danger. */
export type StarKind = 'scoopable' | 'neutron' | 'white_dwarf' | 'black_hole' | 'other'
/**
 * What the community databases know: its arrival star scanned | some bodies | only the system
 * (seen in somebody's plotted route) | nothing | not asked yet.
 */
export type DiscoveryState = 'scanned' | 'bodies' | 'seen' | 'unknown' | 'pending'
/** visited | scanned | bodies_known | seen_in_routes | not_in_databases | busy_area | popular_star */
export type DiscoveryReason = string

export interface DiscoveryChanceView {
  /** That nobody has discovered it yet; null until checked. */
  probability: number | null
  state: DiscoveryState
  reasons: DiscoveryReason[]
}

export interface NavHopView {
  /** 0: the system the route was plotted from. */
  index: number
  address: string
  name: string
  /** Journal StarClass, e.g. "K", "DA", "N", "M_RedGiant". */
  starClass: string
  starKind: StarKind
  x: number
  y: number
  z: number
  /** From the previous system (0 for the first). */
  distanceLy: number
  status: 'passed' | 'here' | 'ahead'
  /** Estimated for the jump into it (ahead). */
  fuelUsed: number | null
  /** Left in the main tank on arrival, before scooping (ahead). */
  fuelAfter: number | null
  /** The forecast scoops the tank full here. */
  refuel: boolean
  /** The fuel runs out on the jump into it. */
  short: boolean
  discovery: DiscoveryChanceView | null
  /** Your scan of its arrival star: first discovery (or not); null without a scan. */
  discoveredByYou: boolean | null
}

export interface FuelForecastView {
  /** Main tank now, t. */
  level: number | null
  capacity: number | null
  hasScoop: boolean
  /** Unboosted jumps of this drive behind the estimate (0: no estimate yet). */
  learntFrom: number
  /** For every jump left, without refuelling, t. */
  needed: number | null
  /** The forecast reaches the destination (scooping on the way). */
  enough: boolean | null
  /** Index of the hop where the fuel runs out. */
  shortAt: number | null
  /** To the next scoopable arrival star ahead (null: none). */
  jumpsToScoop: number | null
  /** Left on arrival there, t. */
  fuelAtScoop: number | null
  /** Most jumps ahead from one scoopable star to the next (or the end). */
  longestDry: number
  /** What those jumps need from a full tank, t. */
  longestDryFuel: number | null
}

/** fuel_short | refuel_here | fuel_tight | dry_stretch | neutron_next | white_dwarf_next | off_route */
export type NavWarning = string

/** The route plotted in the game (NavRoute.json) and what lies ahead on it. */
export interface NavRouteView {
  /** Discovery lookups available (not --offline). */
  online: boolean
  /** Discovery lookups in progress. */
  checking: boolean
  plottedAt: string | null
  /** [] when no route is plotted. */
  hops: NavHopView[]
  /** You are at this hop; null: not on the route. */
  hereIndex: number | null
  jumpsLeft: number
  lyLeft: number
  fuel: FuelForecastView
  nextNeutron: number | null
  nextWhiteDwarf: number | null
  neutronsAhead: number
  whiteDwarfsAhead: number
  /** Sum of the chances ahead: first discoveries to expect. */
  undiscoveredExpected: number
  warnings: NavWarning[]
}

/** A visited system on the galaxy map. */
export interface GalaxySystemView {
  address: string
  name: string
  /** Galactic coordinates, ly. */
  x: number
  y: number
  z: number
  visits: number
  firstVisitAt: string
  lastVisitAt: string
  /** Your scans and analysed species there, earned or pending (estimate). */
  value: number
  unsoldValue: number
  /** First discoveries + first maps + first footfalls. */
  firsts: number
  /** Analysed. */
  species: number
  /** Journal StarType of its arrival star (colour). */
  starType: string | null
  notable: string[]
}

export interface GalaxyDeathView {
  at: string
  /** Index into GalaxyView.systems. */
  system: number | null
  name: string | null
  /** Unsold data lost (estimate). */
  lostValue: number
  killers: string[]
}

export interface GalaxyView {
  commander: string | null
  /** Every visited system with known coordinates, oldest first. */
  systems: GalaxySystemView[]
  /**
   * Your travels: runs of indices into `systems` in arrival order, broken where you did not fly
   * (a respawn, a login somewhere else).
   */
  path: number[][]
  /** Index of the system you are in. */
  current: number | null
  deaths: GalaxyDeathView[]
  /** Stops of the planned route still to do, the next first. */
  route: RoutePoint[]
  /** The route plotted in the game, from where you are. */
  plotted: RoutePoint[]
  /** Jumped, all time. */
  distanceLy: number
  /** Value in ly. */
  farthestFromSol: NamedValue | null
}

export type Topic = 'system' | 'surface' | 'session' | 'stats' | 'history' | 'route' | 'navroute' | 'galaxy'

// Server-Sent Events on GET /api/stream:
//   event: hello      data: { seq: number }
//   event: invalidate data: { seq: number, topics: Topic[] }   -> refetch those views
//   event: status     data: LiveStatus                         -> live position/flags
//   event: ingest     data: IngestState                        -> backfill progress
//   event: ping       data: {}                                 -> keepalive every 15 s
export type StreamEvent =
  | { type: 'hello'; data: { seq: number } }
  | { type: 'invalidate'; data: { seq: number; topics: Topic[] } }
  | { type: 'status'; data: LiveStatus }
  | { type: 'ingest'; data: IngestState }
  | { type: 'ping'; data: Record<string, never> }

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

export interface SystemView {
  address: string | null
  name: string | null
  starPos: [number, number, number] | null
  bodyCount: number | null
  scannedCount: number
  allBodiesFound: boolean
  currentBodyId: number | null
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
}

export interface IngestState {
  backfillDone: boolean
  filesTotal: number
  filesDone: number
  events: number
  journalDir: string
  journalDirFound: boolean
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

export type Topic = 'system' | 'surface' | 'session' | 'stats'

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

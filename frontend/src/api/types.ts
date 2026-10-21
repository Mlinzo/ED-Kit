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

/** new: never in your codex; new_region: in your codex but not for this region; new_colour: the
 *  species is in your codex for this region, this colour is not (a new entry all the same);
 *  logged: known. */
export type CodexStatus = 'new' | 'new_region' | 'new_colour' | 'logged'

export interface SpeciesView {
  genus: string
  species: string
  value: number
  bonusValue: number
  /** The body would give the bonus, but the journal (WasLogged) says someone handed this
   *  species in from it before you. */
  bonusRuledOut: boolean
  colonyRangeM: number
  status: SpeciesStatus
  samples: number
  certain: boolean
  /** Certain without DSS: the genera that can grow on the body fill every bio signal. */
  deduced: boolean
  codex: CodexStatus
  /** "Teal"; candidates joined with " / " when not certain. */
  colour: string | null
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
  /** Your note (null: none). */
  note: string | null
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
  /** A system you have not been to (shown from Spansh / EDSM): its data is being asked for,
   * they know no bodies, or the app runs offline. null: you have been there, or the data is in. */
  lookup: 'pending' | 'missing' | 'offline' | null
  /** Your note on the system (bodies carry their own). */
  note: string | null
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
  /** As in SpeciesView. */
  bonusRuledOut: boolean
  colonyRangeM: number
  codex: CodexStatus
  samples: number
  points: SamplePoint[]
  /** "Teal": the journal names the variant. */
  colour: string | null
}

export interface SurfaceView {
  body: BodyView | null
  activeScan: ActiveScanView | null
}

/** A first entry in your codex (the game's IsNewEntry). */
export interface SessionCodexEntry {
  /** As the game named it. */
  name: string
  category: 'bio' | 'stellar' | 'other'
}

/** One game run: from loading the commander to quitting the game. */
export interface SessionEntry {
  /** The first LoadGame. */
  startedAt: string
  /** Shutdown, or the last event of the run (the game crashed, or is still running). */
  endedAt: string
  /** The latest run with no Shutdown yet: still playing, unless the game crashed. */
  open: boolean
  durationS: number
  jumps: number
  distanceLy: number
  /** Systems arrived in. */
  systems: number
  bodiesScanned: number
  bodiesMapped: number
  speciesAnalysed: number
  firstDiscoveries: number
  firstMapped: number
  firstFootfalls: number
  /** Estimate for the bodies scanned and mapped then, sold or not. */
  cartoValue: number
  /** The species analysed then, incl. bonus (the sale value once sold). */
  bioValue: number
  /** cartoValue + bioValue */
  value: number
  /** Gathered then and lost on a death since (not in value). */
  lostValue: number
  deaths: number
  /** New codex entries, in the order logged. */
  codex: SessionCodexEntry[]
}

export interface SessionsView {
  /** Newest first. */
  sessions: SessionEntry[]
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
  lastSaleStation: string | null
  lastSaleSystem: string | null
  lastDockedAt: string | null
  lastDockedStation: string | null
  lastDockedSystem: string | null
  /** Unsold data when you left each system since the last sale (the first point: right after it). */
  growth: RiskPoint[]
}

export interface RiskPoint {
  at: string
  systemName: string | null
  carto: number
  bio: number
}

export type SellStationKind = 'starport' | 'outpost' | 'planetary' | 'settlement' | 'megaship' | 'carrier' | 'other'

export interface SellStationView {
  name: string
  kind: SellStationKind
  /** From the arrival star. */
  distLs: number | null
  /** Universal Cartographics: buys exploration data. */
  cartographics: boolean
  /** Vista Genomics: buys organic data. */
  genomics: boolean
  /** A carrier: when it was last reported there. */
  seenAt: string | null
  /** You docked here. */
  docked: boolean
  /** A carrier: open to all (per Spansh), or not known. Closed ones are never listed. */
  access: 'all' | 'unknown' | null
}

export interface SellPlaceView {
  systemName: string
  systemAddress: string | null
  distanceLy: number
  /** At the current ship's jump range (null: unknown). */
  jumps: number | null
  /** One that buys both kinds of data, else the best for each. */
  stations: SellStationView[]
  /** Other stations there that buy data. */
  more: number
}

/** The nearest carrier, when carriers are hidden and it is nearer than every station. */
export interface SellCarrierHint {
  name: string
  systemName: string
  distanceLy: number
  jumps: number | null
}

/** GET /api/view/sell[?carriers=true]: where to sell data near you. */
export interface SellView {
  /** pending: asking Spansh; offline: only stations you docked at. */
  state: 'ready' | 'pending' | 'failed' | 'offline' | 'unknown_position'
  ship: string | null
  /** The landing pad the current ship needs. */
  pad: 'S' | 'M' | 'L' | null
  /** Nearest first. */
  places: SellPlaceView[]
  /** Unsold bodies of the system you are in: its exploration data sells only in another system. */
  hereCartoBodies: number
  /** Fleet carriers listed (asked for with ?carriers=true). */
  carriers: boolean
  nearerCarrier: SellCarrierHint | null
  searchedAt: string | null
}

/** A ship as sold (EDSY): base price, stock performance and its slots. */
export interface ShopShipStats {
  pad: 'S' | 'M' | 'L' | null
  /** Base price, credits. */
  price: number | null
  /** m/s */
  speed: number | null
  boost: number | null
  shields: number | null
  armour: number | null
  /** Hull mass, t. */
  mass: number | null
  hardness: number | null
  masslock: number | null
  /** Crew seats. */
  crew: number | null
  /** Power plant, thrusters, FSD, life support, distributor, sensors, fuel tank. */
  core: number[]
  internal: number[]
  military: number[]
  /** A fighter hangar fits. */
  fighterBay: boolean
  /** 1 small .. 4 huge. */
  hardpoints: number[]
  utility: number
}

/** GET /api/shop/catalog: what the Shop tab can look for (game names, in English). */
export interface ShopShipView {
  /** Journal symbol, lower case. */
  symbol: string
  name: string
  stats: ShopShipStats | null
  /** The navy rank needed to buy it. */
  rank: { navy: 'empire' | 'federation'; need: string } | null
  /** No station sells it yet (a new ship comes out for ARX first). */
  unsold?: boolean
}

export interface ShopVariantView {
  /** Journal symbol, lower case: what the search asks for. */
  symbol: string
  /** The module class. */
  size: number
  rating: string
  mount: 'Fixed' | 'Gimballed' | 'Turreted' | null
  guidance: 'Dumbfire' | 'Seeker' | null
  /** Credits (EDSY). */
  price: number | null
  /** t */
  mass: number | null
  /** MW */
  power: number | null
  integrity: number | null
  /** The figures of its kind: EDSY attribute -> value. */
  stats: Record<string, number>
}

export type ShopCategory = 'core' | 'optional' | 'hardpoint' | 'utility'
export type ShopUnlock = 'powerplay' | 'techbroker'

export interface ShopModuleView {
  name: string
  category: ShopCategory
  /** EDSY module type (cfsd, isg, hmc...): its icon. */
  type: string | null
  /** Sold only to commanders who unlocked it. */
  unlock: ShopUnlock | null
  variants: ShopVariantView[]
}

export interface ShopCatalogView {
  ships: ShopShipView[]
  modules: ShopModuleView[]
}

export interface ShopStationView {
  name: string
  kind: SellStationView['kind']
  distLs: number | null
  price: number | null
  /** When Spansh last had its shipyard / outfitting (ISO). */
  offerAt: string | null
  /** A carrier: open to all, or access unknown. */
  access: 'all' | 'unknown' | null
  /** The system needs a permit. */
  permit: boolean
  /** Nothing chosen: ships / modules Spansh knows it sells (null: no shipyard / outfitting; 0: no list). */
  shipCount: number | null
  moduleCount: number | null
}

export interface ShopPlaceView {
  systemName: string
  systemAddress: string | null
  distanceLy: number
  jumps: number | null
  /** The best first. */
  stations: ShopStationView[]
  /** Other stations there selling it. */
  more: number
}

export interface ShopRankView {
  navy: 'empire' | 'federation'
  /** The rank the ship needs (game name). */
  need: string
  /** Yours, from the journal. */
  have: string | null
  ok: boolean | null
}

export interface ShopView {
  state: 'ready' | 'unknown_item' | 'offline' | 'unknown_position' | 'failed'
  /** What is looked for, e.g. "Frame Shift Drive 5A"; null: the nearest shipyards and outfitting. */
  item: string | null
  ship: string | null
  pad: 'S' | 'M' | 'L' | null
  carriers: boolean
  places: ShopPlaceView[]
  nearerCarrier: SellCarrierHint | null
  rank: ShopRankView | null
  unlock: ShopUnlock | null
  searchedAt: string | null
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
  /** Journal files in the folder (0 before the game was ever run there). */
  journalFiles: number
  /** Set at launch (--journal-dir / EDEK_JOURNAL_DIR): the app cannot change it. */
  journalDirFixed: boolean
  /** The folder read unless another one is chosen in the settings. */
  journalDirDefault: string
  /** The game is running (process list, else the journal); null: unknown. */
  gameRunning: boolean | null
}

/** GET /api/network: where a phone opens the page. */
export interface NetworkInfo {
  /** Other devices may connect (off when the app was started with --local). */
  lan: boolean
  /** The page on this PC's network addresses, the likeliest first. */
  urls: string[]
  /** The page is open on the PC the app runs on. */
  thisPc: boolean
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
  /** Your note on the system; bodies there with a note of yours. */
  note: string | null
  bodyNotes: number
}

/** GET /api/view/history */
export interface HistoryView {
  currentAddress: string | null
  /** Most recently visited first. */
  systems: HistoryEntry[]
}

/** riches: around a start point; line: along a straight line between two systems. */
export type RouteMode = 'riches' | 'line'
/** credits: mapping and biology payouts; codex: new codex entries (biology only). */
/** credits · codex · transit: just get there (a Spansh neutron route, its waypoints are the stops). */
export type RouteGoal = 'credits' | 'codex' | 'transit'
/** Earth-like · terraformable water world · terraformable high metal content · water world ·
 *  ammonia world · terraformable rocky body (priced by mapping) · bio: landable bodies with
 *  biological signals (priced by their predicted species). */
export type BodyKind = 'elw' | 'tww' | 'thmc' | 'ww' | 'aw' | 'trocky' | 'bio'

/** POST /api/route — plan a new route (replaces the current one). */
export interface RouteRequest {
  mode: RouteMode
  goal: RouteGoal
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
  /** Codex routes: entries still new here, likeliest first. */
  codex: RouteCodexView[]
}

/** A species that may give a new codex entry on a route body. */
export interface RouteCodexView {
  species: string
  colour: string | null
  /** 0..1, after the stops before it in the route. */
  chance: number
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
  /** Codex routes: new entries expected here (none counted twice). */
  codexNew: number
  /** Transit routes: supercharge the FSD at this stop's neutron star. */
  neutron: boolean
}

/** unknown_system | no_destination | spansh_unavailable | no_route | no_jump_range | internal */
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
  /** With the range now. */
  jumpsToNext: number | null
  /** MaxJumpRange: empty hold, fuel for one jump (the game's maximum). */
  jumpRangeLy: number | null
  /** With the fuel and cargo aboard. */
  jumpRangeNowLy: number | null
  /** With a full tank: the hops between stops, Spansh routes. */
  jumpRangeFullLy: number | null
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
  /** Codex routes: new entries expected at the stops left. */
  codexLeft: number
  /** The next stop is beyond the range now but one jump away with at most this much fuel (t). */
  oneJumpFuelT: number | null
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
/** visited | scanned | bodies_known | seen_in_routes | not_in_databases | busy_area | inner_area */
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
  /** Your note on the system. */
  note: string | null
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
  /** Codex region number (1..42); null off the map. */
  region: number | null
}

/** A codex region you have been to (or logged codex entries in). */
export interface GalaxyRegionView {
  /** 1..42, "$Codex_RegionName_<id>;". */
  id: number
  /** English game name. */
  name: string
  /** Visited systems there. */
  systems: number
  firstVisitAt: string | null
  /** Earned there (estimate), as GalaxySystemView.value. */
  value: number
  /** Distinct codex entries you logged there. */
  codex: number
  /** Of them, distinct exobiology species. */
  species: number
}

/** An engineer's workshop and how far you are with them (the journal). */
export interface GalaxyEngineerView {
  name: string
  system: string
  /** SystemAddress. */
  address: string
  base: string
  /** Ship modules, or suits and weapons on foot. */
  kind: 'ship' | 'suit'
  x: number
  y: number
  z: number
  /** null: not met yet. */
  progress: 'known' | 'invited' | 'acquainted' | 'unlocked' | null
  /** 1..5 once unlocked (ship engineers). */
  rank: number | null
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
  /** The region you are in. */
  region: number | null
  /** In the order you first came. */
  regions: GalaxyRegionView[]
  engineers: GalaxyEngineerView[]
  /** Spansh / EDSM are asked: any system opens on the System tab (else only yours). */
  online: boolean
  /** Systems with a note of yours and a known position, visited or not. */
  notes: GalaxyNoteView[]
}

export interface GalaxyNoteView {
  address: string
  name: string | null
  x: number
  y: number
  z: number
  text: string
}

/** PUT /api/notes: your note on a system (bodyId null) or a body; empty text deletes it. */
export interface NoteRequest {
  systemAddress: string
  bodyId: number | null
  text: string
  systemName?: string | null
  bodyName?: string | null
  x?: number
  y?: number
  z?: number
}

/** A system with someone in it lately (EDDN): how we know, never who. */
export interface LiveSystemView {
  address: string
  name: string
  x: number
  y: number
  z: number
  /** Seconds since the latest sign. */
  ageS: number
  /** Distinct uploaders in the window. */
  players: number
  /** FSDJump / Location / CarrierJump. */
  arrived: number
  /** FSS, bodies, signals, nav beacons. */
  scans: number
  /** Codex entries logged (English names, newest first, up to 3). */
  codex: string[]
  /** Docked, or approached a settlement. */
  docked: number
  /** Fleet carriers among the signals scanned there. */
  carriers: number
}

export interface LiveView {
  /** False with --offline. */
  available: boolean
  state: 'off' | 'connecting' | 'live'
  /** Listening since (ISO). */
  since: string | null
  windowMin: number
  /** How far back the signs shown go: less than the window just after connecting. */
  spanS: number
  /** Distinct uploaders in the window, all systems. */
  players: number
  /** The latest first. */
  systems: LiveSystemView[]
}

export type Topic =
  | 'system'
  | 'surface'
  | 'session'
  | 'sessions'
  | 'sell'
  | 'shop'
  | 'stats'
  | 'history'
  | 'route'
  | 'navroute'
  | 'galaxy'
  | 'live'

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

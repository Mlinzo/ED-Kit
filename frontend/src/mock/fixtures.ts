// Demo data for ?mock=1. Loaded lazily, never part of the main bundle.
// The system is invented but physically plausible: a wide F + M binary (barycentre 0) with
// planets around each star, a planet–planet binary around B, a circumbinary giant and a far
// companion star that has not been scanned yet. Orbits follow Kepler's third law.
// Species values/ranges are typical Vista Genomics figures
// (Bacterium Aurasus 1 000 000 and Bacterium Cerbrus 1 689 800 match real SellOrganicData).

import { offsetLatLon, type LatLon } from '../lib/geo'
import type {
  CodexStatus,
  BarycentreView,
  BodyView,
  BodyVisual,
  GlobeMark,
  GlobeView,
  Interest,
  OrbitView,
  ParentRef,
  RiskPoint,
  SellView,
  SessionView,
  SpeciesStatus,
  SpeciesView,
  SurfaceView,
  SystemView,
} from '../api/types'

export const SYSTEM_NAME = 'Oochoss Brou KD-K d8-61'
const ADDRESS = 2870514376571n
const FIRST_FOOTFALL_MULTIPLIER = 5

/** The body with the active scan (A 3): radius and sample sites. */
export const SURFACE_BODY_ID = 5
export const SURFACE_BODY_NAME = `${SYSTEM_NAME} A 3`
export const PLANET_RADIUS_M = 1_650_000
export const SITE_ORIGIN: LatLon = { lat: -23.4172, lon: 117.0841 }
export const SAMPLE_OFFSETS: ReadonlyArray<{ east: number; north: number }> = [
  { east: -260, north: -120 },
  { east: 310, north: 140 },
]

/* ---------------------------------------------------------------------------------------- */
/* Orbits                                                                                   */
/* ---------------------------------------------------------------------------------------- */

const G = 6.674e-11
const M_SUN = 1.989e30
const M_EARTH = 5.972e24
const LS = 299_792_458
const EPOCH = '2026-10-15T20:00:00Z'

const M_A = 1.28 // solar masses
const M_B = 0.36
const AB_SEPARATION = 9_200 * LS

function period(smaM: number, massKg: number): number {
  return 2 * Math.PI * Math.sqrt(smaM ** 3 / (G * massKg))
}

function orbit(smaM: number, periodS: number, meanAnomalyDeg: number, extra: Partial<OrbitView> = {}): OrbitView {
  return {
    epoch: EPOCH,
    semiMajorAxisM: smaM,
    eccentricity: 0.012,
    inclinationDeg: 0.6,
    periapsisDeg: 25,
    ascendingNodeDeg: 0,
    meanAnomalyDeg,
    periodS,
    ...extra,
  }
}

/** Orbit of a body of negligible mass around `massKg`. */
const around = (massKg: number, smaM: number, meanAnomalyDeg: number, extra: Partial<OrbitView> = {}) =>
  orbit(smaM, period(smaM, massKg), meanAnomalyDeg, extra)

/** Both halves of a binary: same period, sizes split by mass, opposite periapses. */
function pair(separationM: number, m1Kg: number, m2Kg: number, meanAnomalyDeg: number): [OrbitView, OrbitView] {
  const p = period(separationM, m1Kg + m2Kg)
  const a1 = (separationM * m2Kg) / (m1Kg + m2Kg)
  return [
    orbit(a1, p, meanAnomalyDeg, { periapsisDeg: 40 }),
    orbit(separationM - a1, p, meanAnomalyDeg, { periapsisDeg: 220 }),
  ]
}

const [ORBIT_A, ORBIT_B] = pair(AB_SEPARATION, M_A * M_SUN, M_B * M_SUN, 52)
const [ORBIT_B1, ORBIT_B2] = pair(1.2e8, 0.08 * M_EARTH, 0.05 * M_EARTH, 140)

/* ---------------------------------------------------------------------------------------- */
/* Bodies                                                                                   */
/* ---------------------------------------------------------------------------------------- */

function sp(
  genus: string,
  species: string,
  value: number,
  colonyRangeM: number,
  status: SpeciesStatus,
  opts: {
    samples?: number
    certain?: boolean
    deduced?: boolean
    bonus?: boolean
    codex?: CodexStatus
    chance?: number
  } = {},
): SpeciesView {
  const bonus = opts.bonus ?? true
  return {
    genus,
    species,
    colour: null,
    value,
    bonusValue: bonus ? value * FIRST_FOOTFALL_MULTIPLIER : value,
    bonusRuledOut: false,
    colonyRangeM,
    status,
    samples: opts.samples ?? (status === 'analysed' ? 3 : 0),
    certain: opts.certain ?? (opts.deduced || status !== 'predicted'),
    deduced: opts.deduced ?? false,
    codex: opts.codex ?? (status === 'analysed' ? 'logged' : 'new'),
    chance: opts.chance ?? null,
  }
}

type BodyInput = Partial<Omit<BodyView, 'visual'>> &
  Pick<BodyView, 'bodyId' | 'shortName' | 'kind' | 'subtype'> & { vis?: Partial<BodyVisual> }

const MAP_GAIN_THRESHOLD = 300_000
/** The commander's FSS sweep of the system: each body's scan follows a few seconds apart. */
const SCANNED_FROM = Date.parse('2026-10-16T19:41:05Z')

function isRareStar(b: { kind: string; visual: BodyVisual }): boolean {
  const code = b.visual.starType ?? ''
  return b.kind === 'star' && (['N', 'H', 'O', 'X'].includes(code) || /^(D|W|C)/.test(code) || code.includes('Giant'))
}
const SPECIAL_CLASSES: Record<string, string> = {
  'Earthlike body': 'elw',
  'Water world': 'ww',
  'Ammonia world': 'aw',
}

/** Same rules as the backend (views._interest): reasons, brightness on the map, done. */
function deriveInterest(b: Omit<BodyView, 'interest' | 'reasons' | 'done'>): {
  interest: Interest
  reasons: string[]
  done: boolean
} {
  const reasons: string[] = []
  const tasks: boolean[] = []
  if (b.signals.bio > 0) {
    reasons.push('bio')
    tasks.push(b.bioDone >= b.signals.bio)
  }
  if (b.worthMapping) reasons.push('map')
  const special = SPECIAL_CLASSES[b.visual.planetClass ?? '']
  if (special) reasons.push(special)
  else if (b.terraformable) reasons.push('terraformable')
  if (b.kind === 'planet' && (special || b.dssValue - b.fssValue >= MAP_GAIN_THRESHOLD || b.terraformable)) {
    tasks.push(b.mappedByMe)
  }
  const rare = isRareStar(b)
  if (rare) reasons.push('rare_star')
  if (b.wasDiscovered === false) reasons.push('first_discovery')
  if (b.landable && b.atmosphere) reasons.push('landable_atmo')
  if (b.signals.geo > 0) reasons.push('geo')
  if (b.signals.mining > 0) reasons.push('mining')
  if (b.visual.rings.length > 0) reasons.push('rings')
  const done = tasks.length > 0 && tasks.every(Boolean)
  const notable = reasons.some((r) => r === 'first_discovery' || r === 'landable_atmo')
  const interest: Interest =
    (tasks.length > 0 && !done) || rare ? 'high' : done || notable || b.kind === 'star' ? 'medium' : 'low'
  return { interest, reasons, done }
}

/** Fills defaults and derives bio range / total / interest the way the backend does (roughly). */
function body(input: BodyInput): BodyView {
  const { vis, ...rest } = input
  const signals = { bio: 0, geo: 0, human: 0, mining: 0, other: 0, ...input.signals }
  const species = input.species ?? []
  const fixed = species.filter((s) => s.status !== 'predicted').map((s) => s.bonusValue)
  const open = Math.max(0, signals.bio - fixed.length)
  const predicted = species
    .filter((s) => s.status === 'predicted')
    .map((s) => s.bonusValue)
    .sort((a, b) => a - b)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const bioValueMin = sum(fixed) + sum(predicted.slice(0, open))
  const bioValueMax = sum(fixed) + sum(predicted.slice(Math.max(0, predicted.length - open)))
  const fssValue = input.fssValue ?? 0
  const dssValue = input.dssValue ?? 0
  const mappedByMe = input.mappedByMe ?? false
  const parents: ParentRef[] = input.parents ?? []

  const visual: BodyVisual = {
    planetClass: input.kind === 'planet' ? input.subtype : null,
    starType: input.kind === 'star' ? input.subtype.charAt(0) : null,
    starSubclass: null,
    luminosity: null,
    atmosphereType: '',
    terraformState: input.terraformable ? 'Terraformable' : '',
    volcanism: '',
    temperatureK: input.temperatureK ?? null,
    surfacePressureAtm: null,
    atmosphereComposition: {},
    massEm: null,
    radiusM: input.radiusKm != null ? input.radiusKm * 1_000 : null,
    stellarMass: null,
    axialTiltRad: null,
    rotationPeriodS: null,
    tidalLock: null,
    composition: {},
    rings: [],
    ...vis,
  }

  const id64 = (ADDRESS | (BigInt(input.bodyId) << 55n)).toString()
  // Community bodies (other players' scans, not yet yours) are in a public database, so someone
  // discovered them; Spansh does not say whether they were mapped or walked on.
  const source = input.source ?? 'journal'
  const community = source !== 'journal'

  const base = {
    id64,
    name: `${SYSTEM_NAME} ${input.shortName}`,
    parentId: parents.find((p) => p.kind !== 'Null')?.bodyId ?? null,
    distanceLs: 0,
    landable: false,
    terraformable: false,
    atmosphere: null,
    gravityG: null,
    temperatureK: null,
    radiusKm: null,
    wasDiscovered: true,
    wasMapped: input.kind === 'planet' && !community ? false : null,
    wasFootfalled: input.kind === 'planet' && !community ? false : null,
    genuses: [],
    orbit: null,
    source,
    sourceAt: community ? null : new Date(SCANNED_FROM + input.bodyId * 23_000).toISOString(),
    sourceUrl: source === 'spansh' ? `https://spansh.co.uk/body/${id64}` : null,
    signalsSource: input.signals ? source : null,
    genusesSource: input.genuses?.length ? source : null,
    ...rest,
    mappedByMe,
    footfallByMe: input.footfallByMe ?? false,
    footfallClaimable:
      input.footfallClaimable ?? (Boolean(input.landable) && input.kind === 'planet' && !community),
    worthMapping: input.kind === 'planet' && !mappedByMe && dssValue - fssValue >= MAP_GAIN_THRESHOLD,
    signals,
    species,
    fssValue,
    dssValue,
    bioValueMin,
    bioValueMax,
    totalValue: Math.max(fssValue, dssValue) + bioValueMax,
    bioDone: input.bioDone ?? species.filter((s) => s.status === 'analysed').length,
    codexNew: species.filter((s) => s.codex !== 'logged' && s.certain).length,
    codexMaybe: species.filter((s) => s.codex !== 'logged' && !s.certain).length,
    parents,
    visual,
    bookmark: input.bookmark ?? null,
    places: input.places ?? [],
  }
  return { ...base, ...deriveInterest(base) }
}

const DAY = 86_400
const ICY = { Ice: 0.68, Rock: 0.22, Metal: 0.1 }
const ROCKY = { Rock: 0.7, Metal: 0.3 }
const METAL = { Rock: 0.62, Metal: 0.38 }

const OF_A = (extra: ParentRef[] = []): ParentRef[] => [...extra, { kind: 'Star', bodyId: 1 }, { kind: 'Null', bodyId: 0 }]
const OF_B = (extra: ParentRef[] = []): ParentRef[] => [...extra, { kind: 'Star', bodyId: 2 }, { kind: 'Null', bodyId: 0 }]
const GM_A = M_A * M_SUN
const GM_B = M_B * M_SUN

function buildBodies(): BodyView[] {
  return [
    // ── Star A and its planets ─────────────────────────────────────────────────────────────
    body({
      bodyId: 1,
      shortName: 'A',
      kind: 'star',
      subtype: 'F5 Va · white star',
      parents: [{ kind: 'Null', bodyId: 0 }],
      orbit: ORBIT_A,
      distanceLs: 0,
      radiusKm: 838_400,
      temperatureK: 6_650,
      fssValue: 3_410,
      vis: { starSubclass: 5, luminosity: 'Va', stellarMass: M_A, rotationPeriodS: 2.1 * DAY, axialTiltRad: 0.12 },
    }),
    body({
      bodyId: 3,
      shortName: 'A 1',
      kind: 'planet',
      subtype: 'High metal content body',
      parents: OF_A(),
      orbit: around(GM_A, 410 * LS, 118),
      distanceLs: 410.2,
      terraformable: true,
      atmosphere: 'thick carbon dioxide atmosphere',
      gravityG: 0.94,
      temperatureK: 312,
      radiusKm: 5_820,
      mappedByMe: true,
      wasMapped: false,
      fssValue: 412_960,
      dssValue: 1_684_330,
      vis: {
        atmosphereType: 'CarbonDioxide',
        massEm: 1.9,
        composition: METAL,
        rotationPeriodS: 1.3 * DAY,
        axialTiltRad: 0.31,
        tidalLock: false,
        volcanism: 'minor silicate vapour geysers volcanism',
      },
    }),
    body({
      bodyId: 4,
      shortName: 'A 2',
      kind: 'planet',
      subtype: 'Water world',
      parents: OF_A(),
      orbit: around(GM_A, 868 * LS, 255),
      distanceLs: 868.4,
      atmosphere: 'thick nitrogen atmosphere',
      gravityG: 1.12,
      temperatureK: 291,
      radiusKm: 6_420,
      wasDiscovered: false,
      fssValue: 283_410,
      dssValue: 1_190_870,
      vis: { atmosphereType: 'Nitrogen', massEm: 1.6, composition: { Rock: 0.67, Metal: 0.33 }, rotationPeriodS: 0.9 * DAY, axialTiltRad: 0.4 },
    }),
    body({
      bodyId: SURFACE_BODY_ID,
      shortName: 'A 3',
      kind: 'planet',
      subtype: 'High metal content body',
      parents: OF_A(),
      orbit: around(GM_A, 1_021 * LS, 12),
      distanceLs: 1_021.5,
      landable: true,
      atmosphere: 'thin carbon dioxide atmosphere',
      gravityG: 0.21,
      temperatureK: 175,
      radiusKm: PLANET_RADIUS_M / 1_000,
      mappedByMe: true,
      wasMapped: false,
      signals: { bio: 3, geo: 0, human: 0, mining: 0, other: 0 },
      genuses: ['Bacterium', 'Concha', 'Stratum'],
      // Codex: Tectonicas is new to you, Renibus only new for this region, Labiata a new colour.
      species: [
        sp('Stratum', 'Stratum Tectonicas', 19_010_800, 500, 'sampling', { samples: 2 }),
        sp('Bacterium', 'Bacterium Aurasus', 1_000_000, 500, 'analysed'),
        sp('Concha', 'Concha Renibus', 4_572_400, 150, 'predicted', { certain: true, codex: 'new_region', chance: 0.61 }),
        sp('Concha', 'Concha Labiata', 2_352_400, 150, 'predicted', { certain: true, codex: 'new_colour', chance: 0.39 }),
      ],
      fssValue: 23_410,
      dssValue: 112_640,
      vis: { atmosphereType: 'CarbonDioxide', massEm: 0.12, composition: METAL, rotationPeriodS: 3.4 * DAY, tidalLock: false },
    }),
    body({
      bodyId: 6,
      shortName: 'A 3 a',
      kind: 'planet',
      subtype: 'Rocky body',
      // Not scanned yet: known from Spansh (another commander's scan).
      source: 'spansh',
      sourceAt: '2026-10-11T14:22:31Z',
      parents: OF_A([{ kind: 'Planet', bodyId: SURFACE_BODY_ID }]),
      orbit: around(0.12 * M_EARTH, 9e7, 300),
      distanceLs: 1_021.9,
      landable: true,
      gravityG: 0.06,
      temperatureK: 142,
      radiusKm: 480,
      signals: { bio: 0, geo: 2, human: 0, mining: 0, other: 0 },
      fssValue: 1_240,
      dssValue: 5_890,
      vis: { massEm: 0.004, composition: ROCKY, tidalLock: true },
    }),
    body({
      bodyId: 7,
      shortName: 'A 4',
      kind: 'planet',
      subtype: 'Icy body',
      parents: OF_A(),
      orbit: around(GM_A, 1_610 * LS, 190),
      distanceLs: 1_610,
      landable: true,
      gravityG: 0.11,
      temperatureK: 52,
      radiusKm: 1_210,
      fssValue: 8_920,
      dssValue: 38_120,
      vis: { massEm: 0.02, composition: ICY },
    }),
    body({
      bodyId: 8,
      shortName: 'A 5',
      kind: 'planet',
      subtype: 'Sudarsky class II gas giant',
      parents: OF_A(),
      orbit: around(GM_A, 2_250 * LS, 330),
      distanceLs: 2_250.4,
      gravityG: 2.1,
      temperatureK: 152,
      radiusKm: 58_000,
      fssValue: 22_840,
      dssValue: 95_700,
      vis: {
        massEm: 310,
        rotationPeriodS: 0.45 * DAY,
        axialTiltRad: 0.47,
        rings: [{ name: `${SYSTEM_NAME} A 5 A Ring`, ringClass: 'eRingClass_Icy', innerM: 8.1e7, outerM: 1.45e8 }],
      },
    }),
    body({
      bodyId: 9,
      shortName: 'A 5 a',
      kind: 'planet',
      subtype: 'Rocky ice body',
      parents: OF_A([{ kind: 'Planet', bodyId: 8 }]),
      orbit: around(310 * M_EARTH, 4.2e8, 75),
      distanceLs: 2_251.1,
      landable: true,
      atmosphere: 'thin argon atmosphere',
      gravityG: 0.08,
      temperatureK: 88,
      radiusKm: 690,
      // Your auto-scan on approach has no signal counts: they come from Spansh.
      signals: { bio: 1, geo: 3, human: 0, mining: 12, other: 0 },
      signalsSource: 'spansh',
      species: [
        // No DSS yet, but only a Bacterium can grow here and there is one signal: the genus is
        // deduced, one of its species would be new (codexNew 1).
        sp('Bacterium', 'Bacterium Tela', 1_949_000, 500, 'predicted', { deduced: true, codex: 'new', chance: 0.09 }),
        sp('Bacterium', 'Bacterium Bullaris', 1_152_500, 500, 'predicted', { deduced: true, codex: 'logged', chance: 0.91 }),
      ],
      fssValue: 2_140,
      dssValue: 9_870,
      vis: { atmosphereType: 'Argon', massEm: 0.006, composition: { Ice: 0.4, Rock: 0.45, Metal: 0.15 }, tidalLock: true },
    }),
    body({
      bodyId: 10,
      shortName: 'A 5 b',
      kind: 'planet',
      subtype: 'Rocky ice body',
      parents: OF_A([{ kind: 'Planet', bodyId: 8 }]),
      orbit: around(310 * M_EARTH, 9.6e8, 200),
      distanceLs: 2_252.3,
      landable: true,
      atmosphere: 'thin nitrogen atmosphere',
      gravityG: 0.09,
      temperatureK: 71,
      radiusKm: 1_380,
      signals: { bio: 1, geo: 0, human: 0, mining: 0, other: 0 },
      species: [
        // No DSS yet, two genera possible for one signal: uncertain, one would be new (codexMaybe 1).
        sp('Bacterium', 'Bacterium Informem', 8_418_000, 500, 'predicted', { codex: 'new' }),
        sp('Osseus', 'Osseus Pumice', 3_156_300, 800, 'predicted', { codex: 'logged' }),
      ],
      fssValue: 1_870,
      dssValue: 8_040,
      vis: { atmosphereType: 'Nitrogen', massEm: 0.02, composition: ICY, tidalLock: true },
    }),
    body({
      bodyId: 11,
      shortName: 'A 5 b a',
      kind: 'planet',
      subtype: 'Icy body',
      parents: OF_A([
        { kind: 'Planet', bodyId: 10 },
        { kind: 'Planet', bodyId: 8 },
      ]),
      orbit: around(0.02 * M_EARTH, 3.5e7, 20),
      distanceLs: 2_252.4,
      landable: true,
      gravityG: 0.02,
      temperatureK: 64,
      radiusKm: 310,
      fssValue: 640,
      dssValue: 2_750,
      vis: { massEm: 0.0008, composition: ICY, tidalLock: true },
    }),
    body({
      bodyId: 12,
      shortName: 'A 6',
      kind: 'planet',
      subtype: 'Rocky body',
      parents: OF_A(),
      orbit: around(GM_A, 2_900 * LS, 95),
      distanceLs: 2_900,
      landable: true,
      gravityG: 0.18,
      temperatureK: 61,
      radiusKm: 1_480,
      wasMapped: true,
      wasFootfalled: true,
      fssValue: 1_020,
      dssValue: 4_310,
      vis: { massEm: 0.03, composition: ROCKY },
    }),

    // ── Star B: a planet–planet binary (barycentre 13), a bio world, a giant ─────────────────
    body({
      bodyId: 2,
      shortName: 'B',
      kind: 'star',
      subtype: 'M3 V · red dwarf',
      parents: [{ kind: 'Null', bodyId: 0 }],
      orbit: ORBIT_B,
      distanceLs: 9_204.6,
      radiusKm: 312_100,
      temperatureK: 3_150,
      fssValue: 6_540,
      vis: { starSubclass: 3, luminosity: 'V', stellarMass: M_B, rotationPeriodS: 1.4 * DAY },
    }),
    body({
      bodyId: 14,
      shortName: 'B 1',
      kind: 'planet',
      subtype: 'Rocky body',
      parents: OF_B([{ kind: 'Null', bodyId: 13 }]),
      orbit: ORBIT_B1,
      distanceLs: 9_318.2,
      landable: true,
      atmosphere: 'thin carbon dioxide atmosphere',
      gravityG: 0.19,
      temperatureK: 196,
      radiusKm: 2_100,
      mappedByMe: true,
      signals: { bio: 2, geo: 0, human: 0, mining: 0, other: 0 },
      genuses: ['Bacterium', 'Stratum'],
      species: [
        sp('Stratum', 'Stratum Paleas', 1_362_000, 500, 'analysed'),
        sp('Bacterium', 'Bacterium Alcyoneum', 1_658_500, 500, 'analysed'),
      ],
      fssValue: 1_510,
      dssValue: 6_480,
      vis: { atmosphereType: 'CarbonDioxide', massEm: 0.08, composition: ROCKY, tidalLock: true },
    }),
    body({
      bodyId: 15,
      shortName: 'B 2',
      kind: 'planet',
      subtype: 'Rocky ice body',
      parents: OF_B([{ kind: 'Null', bodyId: 13 }]),
      orbit: ORBIT_B2,
      distanceLs: 9_318.6,
      landable: true,
      atmosphere: 'thin ammonia atmosphere',
      gravityG: 0.13,
      temperatureK: 171,
      radiusKm: 1_800,
      mappedByMe: true,
      signals: { bio: 1, geo: 0, human: 0, mining: 0, other: 0 },
      genuses: ['Bacterium'],
      species: [sp('Bacterium', 'Bacterium Cerbrus', 1_689_800, 500, 'analysed')],
      fssValue: 1_330,
      dssValue: 5_760,
      vis: { atmosphereType: 'Ammonia', massEm: 0.05, composition: { Ice: 0.3, Rock: 0.55, Metal: 0.15 }, tidalLock: true },
    }),
    body({
      bodyId: 16,
      shortName: 'B 3',
      kind: 'planet',
      subtype: 'Icy body',
      parents: OF_B(),
      orbit: around(GM_B, 262 * LS, 280),
      distanceLs: 9_466.9,
      landable: true,
      atmosphere: 'thin neon-rich atmosphere',
      gravityG: 0.11,
      temperatureK: 52,
      radiusKm: 1_210,
      // Known from Spansh: the body, its bio signals and the genera another commander's DSS found.
      source: 'spansh',
      sourceAt: '2026-10-11T16:05:48Z',
      signals: { bio: 2, geo: 0, human: 0, mining: 0, other: 0 },
      genuses: ['Electricae', 'Fonticulua'],
      species: [
        sp('Electricae', 'Electricae Pluma', 6_284_600, 1_000, 'predicted', { certain: true, codex: 'new' }),
        sp('Fonticulua', 'Fonticulua Lapida', 3_111_000, 500, 'predicted', { certain: true, codex: 'new_region', chance: 0.7 }),
        sp('Fonticulua', 'Fonticulua Campestris', 1_000_000, 500, 'predicted', { certain: true, codex: 'logged', chance: 0.3 }),
      ],
      fssValue: 8_920,
      dssValue: 38_120,
      vis: { atmosphereType: 'NeonRich', massEm: 0.02, composition: ICY },
    }),
    body({
      bodyId: 17,
      shortName: 'B 4',
      kind: 'planet',
      subtype: 'Gas giant with water based life',
      parents: OF_B(),
      orbit: around(GM_B, 610 * LS, 35),
      distanceLs: 9_812.9,
      gravityG: 2.6,
      temperatureK: 168,
      radiusKm: 61_000,
      fssValue: 46_210,
      dssValue: 189_320,
      vis: { massEm: 390, rotationPeriodS: 0.6 * DAY, axialTiltRad: 0.2 },
    }),

    // ── Around the A+B pair, and beyond ─────────────────────────────────────────────────────
    body({
      bodyId: 18,
      shortName: 'AB 1',
      kind: 'planet',
      subtype: 'Sudarsky class I gas giant',
      parents: [{ kind: 'Null', bodyId: 0 }],
      orbit: around((M_A + M_B) * M_SUN, 30_500 * LS, 160),
      distanceLs: 30_640,
      gravityG: 1.4,
      temperatureK: 41,
      radiusKm: 64_000,
      source: 'spansh',
      sourceAt: '2026-09-28T21:47:02Z',
      fssValue: 13_920,
      dssValue: 58_300,
      vis: { massEm: 220, rotationPeriodS: 0.4 * DAY, axialTiltRad: 0.05 },
    }),
    // Its star (C, body 20) has not been scanned yet: the map shows a "?" placeholder.
    body({
      bodyId: 19,
      shortName: 'C 1',
      kind: 'planet',
      subtype: 'Icy body',
      parents: [
        { kind: 'Star', bodyId: 20 },
        { kind: 'Null', bodyId: 0 },
      ],
      orbit: around(0.2 * M_SUN, 40 * LS, 240),
      distanceLs: 91_870,
      landable: true,
      gravityG: 0.07,
      temperatureK: 24,
      radiusKm: 980,
      fssValue: 520,
      dssValue: 2_210,
      vis: { massEm: 0.01, composition: ICY },
    }),
  ]
}

function buildBarycentres(): BarycentreView[] {
  return [
    { bodyId: 0, parents: [], orbit: null },
    {
      bodyId: 13,
      parents: [
        { kind: 'Star', bodyId: 2 },
        { kind: 'Null', bodyId: 0 },
      ],
      orbit: around(GM_B, 114 * LS, 140),
    },
  ]
}

export function buildSystem(): SystemView {
  const bodies = buildBodies()
  const sum = (pick: (b: BodyView) => number) => bodies.reduce((acc, b) => acc + pick(b), 0)
  return {
    address: ADDRESS.toString(),
    name: SYSTEM_NAME,
    starPos: [-1532.4, 48.9, 3721.2],
    bodyCount: bodies.length + 3,
    // As the backend counts: only your own scans are "found".
    scannedCount: bodies.filter((b) => b.source === 'journal').length,
    allBodiesFound: false,
    isCurrent: true,
    currentSystem: { address: ADDRESS.toString(), name: SYSTEM_NAME },
    currentBodyId: SURFACE_BODY_ID,
    shipBodyId: SURFACE_BODY_ID,
    shipNear: true,
    visits: 1,
    firstVisitAt: '2026-10-16T19:40:12Z',
    lastVisitAt: '2026-10-16T19:40:12Z',
    prevSystem: null,
    nextSystem: null,
    bodies,
    barycentres: buildBarycentres(),
    totals: {
      fss: sum((b) => b.fssValue),
      dss: sum((b) => b.dssValue),
      bioMin: sum((b) => b.bioValueMin),
      bioMax: sum((b) => b.bioValueMax),
    },
    lookup: null,
    bookmark: null,
    stations: [],
  }
}

/** Off the sample site by whole degrees (Canonn finds far away, an older landing). */
const away = (dLat: number, dLon: number): LatLon => ({ lat: SITE_ORIGIN.lat + dLat, lon: SITE_ORIGIN.lon + dLon })
const near = (east: number, north: number): LatLon => offsetLatLon(SITE_ORIGIN, east, north, PLANET_RADIUS_M)

function buildGlobe(): GlobeView {
  const sample = (name: string, colour: string, n: number, status: GlobeMark['status'], at: string, p: LatLon): GlobeMark => ({
    kind: 'sample',
    ...p,
    name,
    colour,
    n,
    status,
    at,
  })
  const marks: GlobeMark[] = [
    ...SAMPLE_OFFSETS.map((o, i) => sample('Stratum Tectonicas', 'Teal', i + 1, 'sampling', '2026-10-16T20:05:31Z', near(o.east, o.north))),
    sample('Bacterium Aurasus', 'Teal', 1, 'analysed', '2026-10-16T19:51:02Z', near(-1_400, 900)),
    sample('Bacterium Aurasus', 'Teal', 2, 'analysed', '2026-10-16T19:51:02Z', near(-1_950, 1_380)),
    sample('Bacterium Aurasus', 'Teal', 3, 'analysed', '2026-10-16T19:51:02Z', near(-2_300, 640)),
    { kind: 'codex', ...away(-2.1, 3.4), name: 'Carbon Dioxide Fumarole', colour: null, n: null, status: null, at: '2026-10-16T19:43:10Z' },
    { kind: 'landing', ...away(-2.05, 3.3), name: '', colour: null, n: null, status: null, at: '2026-10-16T19:42:18Z' },
    { kind: 'landing', ...near(-160, -90), name: '', colour: null, n: null, status: null, at: '2026-10-16T19:48:40Z' },
  ]
  const spread = (centre: LatLon, n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [centre.lat + Math.sin(i * 2.4) * 0.35, centre.lon + Math.cos(i * 2.4) * 0.5])
  return {
    bodyName: SURFACE_BODY_NAME,
    radiusM: PLANET_RADIUS_M,
    marks,
    ship: { state: 'landed', ...near(-160, -90), at: '2026-10-16T19:48:40Z' },
    track: [], // the transport draws the drive in (mock/index.ts)
    communityState: 'ok',
    communityAt: '2026-10-16T19:40:30Z',
    places: [], // your bookmarks: mock/bookmarks.ts
    community: [
      { name: 'Concha Renibus - Red', category: 'Biology', points: spread(away(5.6, -8.2), 9), yours: false },
      { name: 'Stratum Tectonicas - Teal', category: 'Biology', points: spread(away(0.3, 0.6), 6), yours: true },
      { name: 'Bacterium Aurasus - Teal', category: 'Biology', points: spread(away(-11.5, 21), 4), yours: true },
      { name: 'Concha Labiata - Green', category: 'Biology', points: spread(away(-31, 64), 3), yours: false },
      { name: 'Carbon Dioxide Fumarole', category: 'Geology', points: spread(away(-2.3, 3.1), 2), yours: false },
    ],
  }
}

export function buildSurface(system: SystemView): SurfaceView {
  const surfaceBody = system.bodies.find((b) => b.bodyId === SURFACE_BODY_ID) ?? null
  return {
    body: surfaceBody,
    globe: buildGlobe(),
    activeScan: {
      genus: 'Stratum',
      species: 'Stratum Tectonicas',
      value: 19_010_800,
      bonusValue: 19_010_800 * FIRST_FOOTFALL_MULTIPLIER,
      bonusRuledOut: false,
      colonyRangeM: 500,
      codex: 'new',
      colour: 'Teal',
      samples: 2,
      points: SAMPLE_OFFSETS.map((o, i) => ({
        n: i + 1,
        ...offsetLatLon(SITE_ORIGIN, o.east, o.north, PLANET_RADIUS_M),
      })),
    },
  }
}

/** Bio sold per system on the way (index into the 23 systems since the sale). */
const BIO_AT: ReadonlyArray<[number, number]> = [
  [4, 1_000_000 * 5 + 1_689_800 * 5],
  [11, 1_670_100],
  [19, 2_637_500],
]

export function buildSession(): SessionView {
  const unsoldBioValue = 1_000_000 * 5 + 1_689_800 * 5 + 1_670_100 + 2_637_500
  const unsoldCartoValue = 18_452_310
  const saleAt = Date.parse('2026-10-15T21:40:46Z')
  // Carto grows system by system (uneven: some systems are empty), reaching the total at the end.
  const weights = Array.from({ length: 23 }, (_, i) => ((i * 7919) % 13) + (i % 5 === 0 ? 9 : 1))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  let carto = 0
  let bio = 0
  const growth: RiskPoint[] = [{ at: '2026-10-15T21:40:46Z', systemName: 'Gagarin Gate', carto: 0, bio: 0 }]
  weights.forEach((w, i) => {
    carto = i === weights.length - 1 ? unsoldCartoValue : carto + Math.round((unsoldCartoValue * w) / weightSum)
    bio += BIO_AT.find(([at]) => at === i)?.[1] ?? 0
    const at = new Date(saleAt + (i + 1) * 47 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    growth.push({ at, systemName: i === weights.length - 1 ? SYSTEM_NAME : `Oochoss Brou ${String.fromCharCode(65 + i)}Y-K d8-${i + 3}`, carto, bio })
  })
  return {
    commander: 'Jameson',
    unsoldBioCount: 4,
    unsoldBioValue,
    unsoldCartoBodies: 47,
    unsoldCartoSystems: 9,
    unsoldCartoValue,
    atRiskValue: unsoldBioValue + unsoldCartoValue,
    jumps: 23,
    distanceLy: 412.6,
    lastSaleAt: '2026-10-15T21:40:46Z',
    lastSaleStation: 'Gagarin Gate',
    lastSaleSystem: 'Eol Prou RS-T d3-94',
    lastDockedAt: '2026-10-15T21:38:02Z',
    lastDockedStation: 'Gagarin Gate',
    lastDockedSystem: 'Eol Prou RS-T d3-94',
    growth,
  }
}

/** Deep space: carriers nearby (listed on request), the Colonia stations far behind. */
export function buildSell(carriers: boolean, now = Date.now()): SellView {
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    state: 'ready',
    ship: 'Mandalay',
    pad: 'M',
    searchedAt: daysAgo(0.02),
    hereCartoBodies: 6,
    carriers,
    nearerCarrier: carriers
      ? null
      : { name: 'K7Q-2VZ', systemName: 'Oochoss Brou HW-V d2-17', distanceLy: 386.4, jumps: 6 },
    places: [
      ...(carriers ? carrierPlaces(daysAgo) : []),
      {
        systemName: 'Eol Prou RS-T d3-94',
        systemAddress: '3238296097059',
        distanceLy: 2_204.5,
        jumps: 31,
        stations: [
          { name: 'Gagarin Gate', kind: 'starport', distLs: 518, cartographics: true, genomics: true, seenAt: null, docked: true, access: null, permit: false },
        ],
        more: 3,
        nextJump: false,
      },
      {
        systemName: 'Kojeara',
        systemAddress: '5031654888146',
        distanceLy: 2_231.9,
        jumps: 32,
        stations: [
          { name: 'Ohm City', kind: 'outpost', distLs: 2_480, cartographics: true, genomics: false, seenAt: null, docked: false, access: null, permit: false },
          { name: 'Lee Biological Hub', kind: 'settlement', distLs: 2_513, cartographics: false, genomics: true, seenAt: null, docked: false, access: null, permit: false },
        ],
        more: 1,
        nextJump: false,
      },
      {
        systemName: 'Colonia',
        systemAddress: '3238296097058',
        distanceLy: 2_243.1,
        jumps: 32,
        stations: [
          { name: 'Jaques Station', kind: 'starport', distLs: 1_530, cartographics: true, genomics: true, seenAt: null, docked: true, access: null, permit: false },
        ],
        more: 11,
        nextJump: false,
      },
    ],
  }
}

/** The carriers on the way (only when carriers are asked for). */
function carrierPlaces(daysAgo: (d: number) => string): SellView['places'] {
  return [
    {
      systemName: 'Oochoss Brou HW-V d2-17',
      systemAddress: '594828407163',
      distanceLy: 386.4,
      jumps: 6,
      stations: [
        { name: 'K7Q-2VZ', kind: 'carrier', distLs: 12, cartographics: true, genomics: true, seenAt: daysAgo(3), docked: false, access: 'all', permit: false },
      ],
      more: 0,
      nextJump: false,
    },
    {
      systemName: 'Oochoss Brou QN-A c15-4',
      systemAddress: '1213117932650',
      distanceLy: 912.8,
      jumps: 13,
      stations: [
        { name: 'X2F-81B', kind: 'carrier', distLs: 0, cartographics: true, genomics: false, seenAt: daysAgo(21), docked: false, access: 'unknown', permit: false },
      ],
      more: 0,
      nextJump: false,
    },
  ]
}

// Demo travels for ?mock=1: the route plotted in the game ahead of the demo system, and the
// galaxy map — a long trip out from the bubble that ends with the demo history.

import type {
  DiscoveryChanceView,
  GalaxyEngineerView,
  GalaxySystemView,
  GalaxyView,
  HistoryView,
  LiveSystemView,
  LiveView,
  NavHopView,
  NavRouteView,
  RoutePoint,
  RouteView,
  StarKind,
  SystemView,
} from '../api/types'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

type Xyz = [number, number, number]
const ORIGIN: Xyz = [-1532.4, 48.9, 3721.2]

// --------------------------------------------------------------------------- plotted route

/** [star class, chance it is undiscovered (null: still being checked), state] */
const AHEAD: ReadonlyArray<[string, number | null, DiscoveryChanceView['state']]> = [
  ['M', 0.02, 'scanned'],
  ['K', 0.6, 'seen'],
  ['N', 0.68, 'unknown'],
  ['L', 0.9, 'unknown'],
  ['DA', 0.45, 'seen'],
  ['G', 0.05, 'bodies'],
  ['T', 0.9, 'unknown'],
  ['M', null, 'pending'],
  ['F', 0.6, 'seen'],
]
const REASONS: Record<DiscoveryChanceView['state'], string[]> = {
  scanned: ['scanned'],
  bodies: ['bodies_known'],
  seen: ['seen_in_routes'],
  unknown: ['not_in_databases'],
  pending: [],
}

function kindOf(starClass: string): StarKind {
  if (starClass === 'N') return 'neutron'
  if (starClass.startsWith('D')) return 'white_dwarf'
  if (/^[OBAFGKM]$/.test(starClass)) return 'scoopable'
  return 'other'
}

const UNLADEN = 383.2
const CAPACITY = 112
const K = 3.91e-10
const jumpFuel = (ly: number, fuel: number) => K * (ly * (UNLADEN + fuel)) ** 2.45

export function buildNavRoute(system: SystemView): NavRouteView {
  const random = rng(5)
  const start: Xyz = system.starPos ?? ORIGIN
  let at = start
  let tank = 74.3
  const hops: NavHopView[] = [
    {
      index: 0,
      address: system.address ?? '0',
      name: system.name ?? 'Start',
      starClass: 'K',
      starKind: 'scoopable',
      x: start[0],
      y: start[1],
      z: start[2],
      distanceLy: 0,
      status: 'here',
      fuelUsed: null,
      fuelAfter: null,
      refuel: false,
      short: false,
      discovery: null,
      discoveredByYou: true,
      note: null,
    },
  ]
  AHEAD.forEach(([starClass, probability, state], i) => {
    const hop = 24 + random() * 10
    const next: Xyz = [at[0] - hop * 0.35 + random() * 4, at[1] + (random() - 0.5) * 6, at[2] + hop * 0.93]
    at = next
    const used = jumpFuel(hop, tank)
    tank -= used
    const kind = kindOf(starClass)
    hops.push({
      index: i + 1,
      address: String(4_000_000 + i),
      name: `Eord Blao ${String.fromCharCode(65 + i)}${String.fromCharCode(70 + i)}-${String.fromCharCode(72 + i)} d${10 + i}-${2 * i + 3}`,
      starClass,
      starKind: kind,
      x: next[0],
      y: next[1],
      z: next[2],
      distanceLy: Math.round(hop * 100) / 100,
      status: 'ahead',
      fuelUsed: Math.round(used * 1000) / 1000,
      fuelAfter: Math.round(tank * 100) / 100,
      refuel: kind === 'scoopable',
      short: false,
      discovery: { probability, state, reasons: REASONS[state] },
      discoveredByYou: null,
      note: null,
    })
    if (kind === 'scoopable') tank = CAPACITY
  })
  const ahead = hops.slice(1)
  return {
    online: true,
    checking: true,
    plottedAt: new Date(Date.now() - 600_000).toISOString(),
    hops,
    hereIndex: 0,
    jumpsLeft: ahead.length,
    lyLeft: Math.round(ahead.reduce((n, h) => n + h.distanceLy, 0) * 100) / 100,
    fuel: {
      level: 74.3,
      capacity: CAPACITY,
      hasScoop: true,
      learntFrom: 21,
      needed: Math.round(ahead.reduce((n, h) => n + (h.fuelUsed ?? 0), 0) * 100) / 100,
      enough: true,
      shortAt: null,
      jumpsToScoop: 1,
      fuelAtScoop: ahead[0].fuelAfter,
      longestDry: 3,
      longestDryFuel: 21.4,
    },
    nextNeutron: 3,
    nextWhiteDwarf: 5,
    neutronsAhead: 1,
    whiteDwarfsAhead: 1,
    undiscoveredExpected: Math.round(ahead.reduce((n, h) => n + (h.discovery?.probability ?? 0), 0) * 100) / 100,
    warnings: [],
  }
}

// --------------------------------------------------------------------------- galaxy

const SECTORS = ['Swoilz', 'Pru Euq', 'Eol Prou', 'Blae Eork', 'Eord Blao']
const TRAIL = 170

/** A long trip from the bubble to the demo system, the demo history at its end. */
/** A few real engineers (app.engineers), at various stages. */
const DEMO_ENGINEERS: GalaxyEngineerView[] = [
  { name: 'Felicity Farseer', system: 'Deciat', address: '6681123623626', base: 'Farseer Inc', kind: 'ship', x: 122.625, y: -0.8125, z: -47.28125, progress: 'unlocked', rank: 5 },
  { name: 'Elvira Martuuk', system: 'Khun', address: '3107241104074', base: 'Long Sight Base', kind: 'ship', x: -171.59375, y: 19.96875, z: -56.96875, progress: 'unlocked', rank: 3 },
  { name: 'Professor Palin', system: 'Arque', address: '113573366131', base: 'Abel Laboratory', kind: 'ship', x: 66.5, y: 38.0625, z: 61.125, progress: 'invited', rank: null },
  { name: 'Colonel Bris Dekker', system: 'Sol', address: '10477373803', base: "Dekker's Yard", kind: 'ship', x: 0, y: 0, z: 0, progress: 'known', rank: null },
  { name: 'Domino Green', system: 'Orishis', address: '5068464399785', base: 'The Jackrabbit', kind: 'suit', x: -31, y: 93.96875, z: -3.5625, progress: 'known', rank: null },
  { name: 'Mel Brandon', system: 'Luchtaine', address: '66038577537618', base: 'The Brig', kind: 'ship', x: -9523.3125, y: -914.46875, z: 19825.90625, progress: null, rank: null },
  { name: 'Baltanos', system: 'Deriso', address: '71536135676490', base: 'The Divine Apparatus', kind: 'suit', x: -9520.3125, y: -909.5, z: 19808.75, progress: null, rank: null },
]

export function buildGalaxy(history: HistoryView, route: RouteView, plotted: NavRouteView): GalaxyView {
  const random = rng(29)
  const recent = [...history.systems].reverse() // oldest first
  const systems: GalaxySystemView[] = []
  const end = ORIGIN
  const start: Xyz = [18, -12, 34]
  const total = TRAIL + recent.length
  let day = Date.parse('2026-09-02T18:00:00Z')
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1)
    // Wander around the straight line out, with a side trip in the middle.
    const bend = Math.sin(t * Math.PI) * 900 + Math.sin(t * 11) * 120
    const p: Xyz = [
      start[0] + (end[0] - start[0]) * t + bend * 0.6 + (random() - 0.5) * 40,
      start[1] + (end[1] - start[1]) * t + (random() - 0.5) * 60,
      start[2] + (end[2] - start[2]) * t - bend * 0.25 + (random() - 0.5) * 40,
    ]
    const entry = i >= TRAIL ? recent[i - TRAIL] : null
    if (i === total - 1) p.splice(0, 3, ...end)
    day += (20 + random() * 400) * 60_000
    const iso = entry?.lastVisitAt ?? new Date(day).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const rich = !entry && random() < 0.12
    systems.push({
      address: entry?.address ?? String(7_000_000 + i),
      name: entry?.name ?? `${SECTORS[Math.floor(t * SECTORS.length * 0.999)]} ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(66 + ((i * 7) % 24))}-${String.fromCharCode(67 + (i % 20))} c${1 + (i % 27)}-${i % 40}`,
      x: p[0],
      y: p[1],
      z: p[2],
      visits: entry?.visits ?? 1,
      firstVisitAt: entry?.firstVisitAt ?? iso,
      lastVisitAt: iso,
      value: entry?.value ?? (rich ? Math.round(2e6 + random() * 3e7) : Math.round(random() * 4e5)),
      unsoldValue: entry?.unsoldValue ?? 0,
      firsts: entry ? entry.firstDiscoveries + entry.firstMapped + entry.firstFootfalls : rich ? Math.round(random() * 12) : 0,
      species: entry?.speciesAnalysed ?? (rich ? Math.round(random() * 4) : 0),
      starType: entry?.mainStar?.starType ?? ['M', 'K', 'G', 'F', 'L', 'T', 'DA', 'N', 'A'][Math.floor(random() * 9)],
      notable: entry?.notable ?? [],
      // The whole demo trip stays in the bubble's region.
      region: 18,
    })
  }
  const ids = systems.map((_, i) => i)
  const offset = (p: RoutePoint): RoutePoint => ({ ...p, x: p.x + ORIGIN[0], y: p.y + ORIGIN[1], z: p.z + ORIGIN[2] })
  return {
    commander: 'Jameson',
    systems,
    path: [ids.slice(0, 96), ids.slice(96)],
    current: systems.length - 1,
    deaths: [
      { at: systems[95].lastVisitAt, system: 95, name: systems[95].name, lostValue: 8_152_843, killers: ['Cmdr Kiranos'] },
      { at: systems[40].lastVisitAt, system: 40, name: systems[40].name, lostValue: 1_853_983, killers: ['Jed Telford'] },
    ],
    route: route.stops.filter((s) => !s.done && !s.skipped).map((s) => offset({ name: s.name, x: s.x, y: s.y, z: s.z })),
    plotted: plotted.hops.filter((h) => h.status !== 'passed').map((h) => ({ name: h.name, x: h.x, y: h.y, z: h.z })),
    distanceLy: 9_412.6,
    farthestFromSol: { name: systems[systems.length - 1].name, detail: null, value: Math.hypot(...ORIGIN), at: null },
    region: 18,
    engineers: DEMO_ENGINEERS,
    online: true,
    notes: [],
    regions: [
      {
        id: 18,
        name: 'Inner Orion Spur',
        systems: systems.length,
        firstVisitAt: systems[0].firstVisitAt,
        value: systems.reduce((n, s) => n + s.value, 0),
        codex: 23,
        species: 17,
      },
    ],
  }
}

// --------------------------------------------------------------------------- other players

const LIVE_CODEX = ['Bacterium Tela', 'Stratum Tectonicas', 'Fonticulua Campestris', 'K Type', 'Gas Giant With Water Based Life']

/** Demo players (EDDN): a crowd in the bubble, some at Colonia, a few on the road between. */
export function buildLive(): LiveView {
  const random = rng(7)
  const gauss = () => (random() + random() + random() - 1.5) / 1.5
  const systems: LiveSystemView[] = []
  const add = (name: string, x: number, y: number, z: number) => {
    const busy = random() < 0.12
    const players = busy ? 2 + Math.floor(random() * 5) : 1
    const codex = random() < 0.08 ? [LIVE_CODEX[Math.floor(random() * LIVE_CODEX.length)]] : []
    systems.push({
      address: String(9_000_000 + systems.length),
      name,
      x,
      y,
      z,
      ageS: Math.floor(random() * 300),
      players,
      arrived: 1 + Math.floor(random() * players),
      scans: random() < 0.5 ? Math.floor(random() * 12) : 0,
      codex,
      docked: random() < 0.3 ? 1 : 0,
      carriers: random() < 0.15 ? 1 + Math.floor(random() * 4) : 0,
    })
  }
  for (let i = 0; i < 260; i++) add(`${SECTORS[i % SECTORS.length]} ${String.fromCharCode(65 + (i % 26))}A-${i % 9} b${i % 30}`, gauss() * 260, gauss() * 120, gauss() * 260)
  for (let i = 0; i < 40; i++) add(`Colonia Sector ${i}`, -9530 + gauss() * 160, -910 + gauss() * 60, 19808 + gauss() * 160)
  for (let i = 0; i < 24; i++) {
    const t = random()
    add(`Eol Prou ${i}`, -9530 * t + gauss() * 300, -910 * t, 19808 * t + gauss() * 300)
  }
  systems.sort((a, b) => a.ageS - b.ageS)
  return { available: true, state: 'live', since: new Date(Date.now() - 20 * 60_000).toISOString(), windowMin: 5, spanS: 300, players: 268, systems }
}

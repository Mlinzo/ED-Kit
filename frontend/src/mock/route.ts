// Demo route for ?mock=1: a run from the demo system for mapping and biology, a few stops
// done. Planning a new one "takes" a moment and invents stops for the chosen kinds.

import type {
  BodyKind,
  BodyView,
  NeutronPlanView,
  RouteBodyView,
  RouteRequest,
  RouteStopView,
  RouteView,
  SystemView,
} from '../api/types'

const SECTORS = ['Oochoss Brou', 'Oochost Flyoo', 'Phroi Bluae']
const VALUES: Record<Exclude<BodyKind, 'bio'>, [number, number]> = {
  elw: [950_000, 1_350_000],
  tww: [880_000, 1_100_000],
  thmc: [520_000, 690_000],
  ww: [380_000, 460_000],
  aw: [520_000, 640_000],
  trocky: [460_000, 520_000],
}
const BUILD_MS = 1_200
/** The demo start is at the origin; a line route heads here (312.4 ly away). */
const DESTINATION = { x: 120, y: 15, z: 288 }

type Xyz = [number, number, number]
const dist = (a: Xyz, b: Xyz) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Where the i-th of `count` candidates lies: a loop within the radius, or along the corridor. */
function placeStop(req: RouteRequest, random: () => number, from: Xyz, i: number, count: number): Xyz {
  if (req.mode === 'line') {
    const t = (i + 0.5) / count
    const off = () => (random() - 0.5) * 2 * req.deviationLy * 0.6
    return [DESTINATION.x * t + off(), DESTINATION.y * t + off() * 0.4, DESTINATION.z * t + off()]
  }
  // A wandering walk that turns back towards the start near the edge of the radius.
  const hop = 8 + random() * 30
  const angle = random() * Math.PI * 2
  let to: Xyz = [from[0] + Math.cos(angle) * hop, from[1] + (random() - 0.5) * hop * 0.4, from[2] + Math.sin(angle) * hop]
  if (dist(to, [0, 0, 0]) > req.radiusLy * 0.8) {
    const k = hop / Math.max(1, dist(from, [0, 0, 0]))
    to = [from[0] * (1 - k), from[1] * (1 - k), from[2] * (1 - k)]
  }
  return to
}
const GENERA = ['Bacterium', 'Frutexa', 'Stratum', 'Tussock', 'Fungoida', 'Osseus', 'Concha', 'Cactoida']

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

function makeStops(req: RouteRequest, seed: number): RouteStopView[] {
  const random = rng(seed)
  const count = req.mode === 'line' ? 40 : Math.min(req.maxSystems, 60)
  const kinds = req.bodyTypes.filter((k) => k !== 'bio') as Exclude<BodyKind, 'bio'>[]
  const withBio = req.bodyTypes.includes('bio')
  const stops: RouteStopView[] = []
  let at: Xyz = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    const sector = SECTORS[Math.floor(random() * SECTORS.length)]
    const letters = () => String.fromCharCode(65 + Math.floor(random() * 26))
    const name = `${sector} ${letters()}${letters()}-${letters()} ${random() < 0.5 ? 'd' : 'c'}${1 + Math.floor(random() * 30)}-${Math.floor(random() * 120)}`
    const bodies: RouteBodyView[] = []
    const n = 1 + Math.floor(random() * 3)
    for (let b = 0; b < n; b++) {
      const short = `${random() < 0.4 ? 'A ' : ''}${1 + Math.floor(random() * 9)}${random() < 0.3 ? ' a' : ''}`
      const common = {
        bodyId: 10 + b,
        name: `${name} ${short}`,
        shortName: short,
        distanceLs: Math.round(20 + random() * 4_000),
        scanned: false,
        mapped: false,
        bioDone: 0,
        done: false,
      }
      // A mapping kind, biology, or both on one body.
      const mapped = kinds.length > 0 && (!withBio || random() < 0.6)
      const kind = mapped ? kinds[Math.floor(random() * kinds.length)] : 'bio'
      const [lo, hi] = kind === 'bio' ? [0, 0] : VALUES[kind]
      const mappingValue = Math.round(lo + random() * (hi - lo))
      if (kind !== 'bio' && mappingValue < req.minValue) continue
      const signals = withBio && (kind === 'bio' || random() < 0.3) ? 1 + Math.floor(random() * 4) : 0
      const known = random() < 0.6
      const bioLow = signals * Math.round(1_000_000 + random() * 3_000_000)
      const bioMax = signals ? bioLow + Math.round(random() * signals * 6_000_000) : 0
      if (signals && bioMax < req.bioMinValue && kind === 'bio') continue
      bodies.push({
        ...common,
        kind,
        mappingValue,
        bioSignals: signals,
        bioMin: known ? bioMax : bioLow,
        bioMax,
        genuses: signals && known ? GENERA.slice(0, signals) : [],
      })
    }
    const own = (b: RouteBodyView) => (b.kind !== 'bio' ? b.mappingValue : 0)
    const value = bodies.reduce((n, b) => n + own(b) + b.bioMax, 0)
    if (bodies.length === 0 || value < req.minSystemValue) continue
    const to = placeStop(req, random, at, i, count)
    const hop = dist(at, to)
    at = to
    stops.push({
      seq: stops.length + 1,
      address: String(4_000_000_000 + i * 977),
      name,
      x: Math.round(to[0] * 100) / 100,
      y: Math.round(to[1] * 100) / 100,
      z: Math.round(to[2] * 100) / 100,
      hopLy: Math.round(hop * 100) / 100,
      jumps: Math.max(1, Math.ceil(hop / 34.9)),
      population: random() < 0.55 ? Math.round(random() * 90_000) : 0,
      bodies,
      value,
      valueMin: bodies.reduce((n, b) => n + own(b) + b.bioMin, 0),
      visited: false,
      done: false,
      skipped: false,
      here: false,
    })
  }
  return stops
}

const EMPTY_NEUTRON: NeutronPlanView = {
  building: false,
  error: null,
  createdAt: null,
  source: null,
  destination: null,
  stale: false,
  efficiency: null,
  rangeLy: null,
  multiplier: null,
  totalJumps: null,
  directJumps: null,
  waypoints: [],
  nextIndex: null,
}

const DEFAULT_REQUEST: RouteRequest = {
  mode: 'riches',
  source: '',
  destination: null,
  radiusLy: 200,
  deviationLy: 25,
  maxSystems: 100,
  bodyTypes: ['elw', 'tww', 'thmc', 'bio'],
  minValue: 300_000,
  minSystemValue: 0,
  bioMinValue: 5_000_000,
  bioRequireGenuses: false,
  includePopulated: true,
  skipMapped: true,
  refresh: false,
}

/** The route's kind of a demo-system body worth a stop: its mapping kind, else its biology. */
function kindOf(b: BodyView): BodyKind | null {
  const sub = b.subtype.toLowerCase()
  if (b.worthMapping) {
    if (sub.includes('earth')) return 'elw'
    if (sub.includes('ammonia')) return 'aw'
    if (sub.includes('water')) return b.terraformable ? 'tww' : 'ww'
    if (sub.includes('metal')) return 'thmc'
    return 'trocky'
  }
  return b.signals.bio > 0 ? 'bio' : null
}

/** The demo system as a stop: its valuable and living bodies, with your progress on them. */
function demoStop(system: SystemView, seq: number, at: RouteStopView): RouteStopView {
  const bodies: RouteBodyView[] = []
  for (const b of system.bodies) {
    const kind = b.kind === 'planet' ? kindOf(b) : null
    if (!kind) continue
    bodies.push({
      bodyId: b.bodyId,
      name: b.name,
      shortName: b.shortName,
      kind,
      distanceLs: b.distanceLs,
      mappingValue: kind === 'bio' ? 0 : b.dssValue,
      scanned: true,
      mapped: b.mappedByMe,
      bioSignals: b.signals.bio,
      bioMin: b.signals.bio > 0 ? b.bioValueMin : 0,
      bioMax: b.signals.bio > 0 ? b.bioValueMax : 0,
      bioDone: Math.min(b.bioDone, b.signals.bio),
      genuses: [],
      done: (kind === 'bio' || b.mappedByMe) && b.bioDone >= b.signals.bio,
    })
  }
  const own = (b: RouteBodyView) => (b.kind !== 'bio' ? b.mappingValue : 0)
  return {
    ...at,
    seq,
    address: system.address ?? at.address,
    name: system.name ?? at.name,
    bodies,
    value: bodies.reduce((n, b) => n + own(b) + b.bioMax, 0),
    valueMin: bodies.reduce((n, b) => n + own(b) + b.bioMin, 0),
    visited: true,
    done: bodies.length > 0 && bodies.every((b) => b.done),
    here: true,
  }
}

export function createMockRoute(system: SystemView, emit: () => void) {
  const currentSystem = system.name ?? '?'
  let params: RouteRequest | null = DEFAULT_REQUEST
  let stops = makeStops(DEFAULT_REQUEST, 17)
  let building = false
  let createdAt = new Date(Date.now() - 3 * 3_600_000).toISOString()
  // The first three stops are done already; you are in the fourth, the demo system.
  for (const s of stops.slice(0, 3)) {
    s.visited = true
    s.done = true
    s.bodies = s.bodies.map((b) => ({ ...b, scanned: true, mapped: true, done: true }))
  }
  if (stops[3]) stops[3] = demoStop(system, 4, stops[3])

  /** Where you are: the stop flagged here, else the start (a new route starts where you are). */
  const where = () => {
    const here = stops.find((s) => s.here)
    return here ? { name: here.name, x: here.x, y: here.y, z: here.z } : { name: currentSystem, x: 0, y: 0, z: 0 }
  }
  /** Hops from the start in the current order, as the backend recomputes them after an edit. */
  const rehop = () => {
    let prev: Xyz = [0, 0, 0]
    for (const s of stops) {
      const at: Xyz = [s.x, s.y, s.z]
      s.hopLy = Math.round(dist(prev, at) * 100) / 100
      s.jumps = Math.max(1, Math.ceil(s.hopLy / 34.9))
      prev = at
    }
  }

  const view = (): RouteView => {
    const next = stops.find((s) => !s.done && !s.skipped) ?? null
    const position = params ? where() : null
    const toNext = next && position ? Math.round(dist([position.x, position.y, position.z], [next.x, next.y, next.z]) * 100) / 100 : null
    return {
      online: true,
      building,
      error: null,
      errorDetail: null,
      params,
      createdAt: params ? createdAt : null,
      dataAt: params ? createdAt : null,
      truncated: params?.mode === 'riches',
      source: params ? { name: params.source || currentSystem, x: 0, y: 0, z: 0 } : null,
      destination: params?.mode === 'line' ? { name: params.destination ?? '?', ...DESTINATION } : null,
      stops,
      nextSeq: next?.seq ?? null,
      currentSystem: position?.name ?? currentSystem,
      currentPosition: position,
      distanceToNextLy: toNext,
      jumpsToNext: toNext ? Math.max(1, Math.ceil(toNext / 34.9)) : null,
      jumpRangeLy: 34.9,
      totalValue: stops.reduce((s, x) => s + x.value, 0),
      collectedValue: stops.reduce(
        (s, x) => s + x.bodies.reduce((n, b) => n + (b.done ? (b.kind !== 'bio' ? b.mappingValue : 0) + b.bioMax : 0), 0),
        0,
      ),
      totalLy: stops.reduce((s, x) => s + x.hopLy, 0),
      directLy: params?.mode === 'line' ? 312.4 : null,
      remainingLy: next ? stops.filter((s) => s.seq >= next.seq).reduce((n, s) => n + s.hopLy, 0) : 0,
      doneCount: stops.filter((s) => s.done).length,
      skippedCount: stops.filter((s) => s.skipped && !s.done).length,
      neutron: neutron && { ...neutron, stale: neutron.destination !== next?.name },
    }
  }

  /** A demo neutron route: supercharges every ~4 jumps along the straight line to the next stop. */
  let neutron: NeutronPlanView | null = null
  const planNeutron = () => {
    const next = stops.find((s) => !s.done && !s.skipped)
    if (!next) return
    const from = where()
    const a: Xyz = [from.x, from.y, from.z]
    const b: Xyz = [next.x, next.y, next.z]
    const total = dist(a, b)
    const legs = Math.max(2, Math.round(total / 140))
    const random = rng(Math.round(total))
    const waypoints = Array.from({ length: legs + 1 }, (_, i) => {
      const t = i / legs
      const p: Xyz = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
      const end = i === 0 || i === legs
      const name = i === 0 ? from.name : i === legs ? next.name : `PSR J${1700 + Math.floor(random() * 99)}-${1000 + Math.floor(random() * 8999)}`
      return {
        name,
        address: String(9_000_000 + i),
        x: p[0],
        y: p[1],
        z: p[2],
        jumps: i === 0 ? 0 : end ? 1 : 3 + Math.floor(random() * 3),
        neutron: !end,
        leftLy: Math.round(total * (1 - t) * 100) / 100,
        visited: i === 0,
      }
    })
    neutron = {
      building: false,
      error: null,
      createdAt: new Date().toISOString(),
      source: from.name,
      destination: next.name,
      stale: false,
      efficiency: 60,
      rangeLy: 34.9,
      multiplier: 4,
      totalJumps: waypoints.reduce((n, w) => n + w.jumps, 0),
      directJumps: Math.ceil(total / 34.9),
      waypoints,
      nextIndex: 1,
    }
  }

  const send = (method: string, path: string, body: unknown): unknown => {
    if (method === 'POST' && path === '/api/route') {
      const req = { ...DEFAULT_REQUEST, ...(body as Partial<RouteRequest>) }
      building = true
      setTimeout(() => {
        params = req
        stops = makeStops(req, Math.floor(Math.random() * 1e9))
        createdAt = new Date().toISOString()
        building = false
        emit()
      }, BUILD_MS)
      return view()
    }
    if (method === 'DELETE' && path === '/api/route') {
      params = null
      stops = []
      neutron = null
      return null
    }
    if (method === 'POST' && path === '/api/route/neutron') {
      neutron = { ...(neutron ?? EMPTY_NEUTRON), building: true }
      setTimeout(() => {
        planNeutron()
        emit()
      }, BUILD_MS)
      return null
    }
    if (method === 'DELETE' && path === '/api/route/neutron') {
      neutron = null
      return null
    }
    const stopPath = /^\/api\/route\/stops\/(\d+)$/.exec(path)
    if (stopPath && (method === 'PUT' || method === 'DELETE')) {
      const index = stops.findIndex((s) => s.seq === Number(stopPath[1]))
      if (index < 0) throw new Error(`HTTP 404: ${path}`)
      const change = (body ?? {}) as { skipped?: boolean; position?: number }
      const [stop] = stops.splice(index, 1)
      if (method === 'PUT') {
        if (change.skipped !== undefined) stop.skipped = change.skipped
        const at = change.position !== undefined ? Math.max(0, Math.min(change.position - 1, stops.length)) : index
        stops.splice(at, 0, stop)
      }
      stops.forEach((s, i) => (s.seq = i + 1))
      rehop()
      return null
    }
    throw new Error(`HTTP 404: ${method} ${path}`)
  }

  return { view, send }
}

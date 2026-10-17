// Demo route for ?mock=1: a run from the demo system for mapping and biology, a few stops
// done. Planning a new one "takes" a moment and invents stops for the chosen kinds.

import type { BodyKind, RouteBodyView, RouteRequest, RouteStopView, RouteView } from '../api/types'

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
    const hop = 8 + random() * (req.mode === 'line' ? 60 : 30)
    stops.push({
      seq: stops.length + 1,
      address: String(4_000_000_000 + i * 977),
      name,
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

export function createMockRoute(currentSystem: string, emit: () => void) {
  let params: RouteRequest | null = DEFAULT_REQUEST
  let stops = makeStops(DEFAULT_REQUEST, 17)
  let building = false
  let createdAt = new Date(Date.now() - 3 * 3_600_000).toISOString()
  // The first three stops are done already.
  for (const s of stops.slice(0, 3)) {
    s.visited = true
    s.done = true
    s.bodies = s.bodies.map((b) => ({ ...b, scanned: true, mapped: true, done: true }))
  }
  if (stops[3]) stops[3].visited = true

  const view = (): RouteView => {
    const next = stops.find((s) => !s.done && !s.skipped) ?? null
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
      destination: params?.mode === 'line' ? { name: params.destination ?? '?', x: 0, y: 0, z: 0 } : null,
      stops,
      nextSeq: next?.seq ?? null,
      currentSystem,
      distanceToNextLy: next ? next.hopLy + 4.2 : null,
      jumpsToNext: next ? Math.max(1, Math.ceil((next.hopLy + 4.2) / 34.9)) : null,
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
      return null
    }
    throw new Error(`HTTP 404: ${method} ${path}`)
  }

  return { view, send }
}

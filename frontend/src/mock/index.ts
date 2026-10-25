// Demo transport for ?mock=1: serves fixtures and simulates the event stream —
// a commander driving an SRV around the sample sites so the radar animates,
// plus a short journal backfill so the progress bar shows.

import { createLiveTransport, type StreamHandlers, type Transport } from '../api/transport'
import type { IngestState, LiveStatus, NoteRequest, SurfaceView, SystemView, Topic } from '../api/types'
import { offsetLatLon } from '../lib/geo'
import {
  buildSell,
  buildSession,
  buildSurface,
  buildSystem,
  PLANET_RADIUS_M,
  SITE_ORIGIN,
  SURFACE_BODY_NAME,
} from './fixtures'
import { buildHistory, buildPastSystem, withHistory } from './history'
import { createMockNotes } from './notes'
import { createMockRoute } from './route'
import { buildSessions } from './sessions'
import { buildShop } from './shop'
import { buildGalaxy, buildLive, buildNavRoute } from './travel'
import { buildStats } from './stats'

/** What the backend answers for an address it does not know. */
function emptySystem(system: SystemView): SystemView {
  return {
    ...system,
    address: null,
    name: null,
    starPos: null,
    bodyCount: null,
    scannedCount: 0,
    allBodiesFound: false,
    isCurrent: false,
    currentBodyId: null,
    shipBodyId: null,
    shipNear: false,
    visits: 0,
    firstVisitAt: null,
    lastVisitAt: null,
    prevSystem: null,
    nextSystem: null,
    bodies: [],
    barycentres: [],
    totals: { fss: 0, dss: 0, bioMin: 0, bioMax: 0 },
  }
}

const STATUS_INTERVAL_MS = 250
const INGEST_INTERVAL_MS = 300
const LAP_SECONDS = 90
const TRACK_SECONDS = 45 // the drive behind you on the globe
const TRACK_EVERY_MS = 5_000 // as often as the app sends new path points
/** Elliptical drive around the two sample sites (metres, rotated by ROTATION). */
const PATH = { east: 25, north: 10, a: 900, b: 560, rotation: (20 * Math.PI) / 180 }

function positionAt(seconds: number): { east: number; north: number } {
  const t = (seconds / LAP_SECONDS) * 2 * Math.PI
  const x = PATH.a * Math.cos(t)
  const y = PATH.b * Math.sin(t)
  const cos = Math.cos(PATH.rotation)
  const sin = Math.sin(PATH.rotation)
  return { east: PATH.east + x * cos - y * sin, north: PATH.north + x * sin + y * cos }
}

/** The surface view with the last TRACK_SECONDS of the drive as your path (a point per 0.5 s). */
function withTrack(surface: SurfaceView, seconds: number): SurfaceView {
  if (!surface.globe) return surface
  const from = Math.max(0, seconds - TRACK_SECONDS)
  const stretch: [number, number][] = []
  for (let s = from; s <= seconds; s += 0.5) {
    const p = positionAt(s)
    const { lat, lon } = offsetLatLon(SITE_ORIGIN, p.east, p.north, PLANET_RADIUS_M)
    stretch.push([lat, lon])
  }
  return { ...surface, globe: { ...surface.globe, track: [stretch] } }
}

function simulatedStatus(seconds: number): LiveStatus {
  const here = positionAt(seconds)
  const ahead = positionAt(seconds + 0.5)
  const heading = ((Math.atan2(ahead.east - here.east, ahead.north - here.north) * 180) / Math.PI + 360) % 360
  const { lat, lon } = offsetLatLon(SITE_ORIGIN, here.east, here.north, PLANET_RADIUS_M)
  return {
    timestamp: new Date().toISOString(),
    flags: 0,
    flags2: 0,
    docked: false,
    landed: false,
    supercruise: false,
    inShip: false,
    inSrv: true,
    onFoot: false,
    hasLatLong: true,
    lat,
    lon,
    heading: Math.round(heading),
    altitude: 0,
    planetRadiusM: PLANET_RADIUS_M,
    bodyName: SURFACE_BODY_NAME,
    fuelMain: null,
    destinationSystem: null,
    destinationBody: null,
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createMockTransport(): Transport {
  const history = buildHistory(buildSystem())
  const system = withHistory(buildSystem(), history)
  const surface = buildSurface(system)
  const session = buildSession()
  const sessions = buildSessions()
  const stats = buildStats()
  let notify: ((topics: Topic[]) => void) | null = null
  const route = createMockRoute(system, () => notify?.(['route']))
  const navroute = buildNavRoute(system)
  const startedAt = performance.now()
  const elapsed = () => (performance.now() - startedAt) / 1_000
  const live = createLiveTransport()
  const players = buildLive()
  const notes = createMockNotes()

  let ingest: IngestState = {
    backfillDone: false,
    filesTotal: 21,
    filesDone: 0,
    events: 0,
    journalDir: 'C:\\Users\\Commander\\Saved Games\\Frontier Developments\\Elite Dangerous',
    journalDirFound: true,
    journalFiles: 21,
    journalDirFixed: false,
    journalDirDefault: 'C:\\Users\\Commander\\Saved Games\\Frontier Developments\\Elite Dangerous',
    gameRunning: true,
    dataDir: 'C:\\Users\\Commander\\AppData\\Local\\EDExplorerKit',
    dataDirDefault: 'C:\\Users\\Commander\\AppData\\Local\\EDExplorerKit',
    dataDirFixed: false,
    dataDirPending: null,
    dbBytes: 38_000_000,
    journalBytes: 8_700_000,
    freeBytes: 120_000_000_000,
    hold: null,
    holdBytes: 0,
    bigDataOk: false,
    largeDbBytes: 500_000_000,
    lowFreeBytes: 1_000_000_000,
  }

  const routes: Record<string, (query: URLSearchParams) => unknown> = {
    '/api/view/system': (query) => {
      const address = query.get('address')
      if (address === null) return system
      return buildPastSystem(system, history, address) ?? { ...emptySystem(system), currentSystem: system.currentSystem }
    },
    '/api/view/surface': () => withTrack(surface, elapsed()),
    '/api/view/session': () => session,
    '/api/view/sessions': () => sessions,
    '/api/view/sell': (query) => buildSell(query.get('carriers') === 'true'),
    '/api/view/shop': (query) => buildShop(query.get('item'), query.get('carriers') === 'true'),
    '/api/view/stats': () => stats,
    '/api/view/history': () => history,
    '/api/view/route': () => route.view(),
    '/api/view/navroute': () => navroute,
    '/api/view/galaxy': () => buildGalaxy(history, route.view(), navroute),
    '/api/view/live': () => players,
    '/api/status': () => simulatedStatus(elapsed()),
    '/api/ingest': () => ingest,
    '/api/network': () => ({ lan: true, urls: ['http://192.168.1.20:8765'], thisPc: true }),
  }

  return {
    mock: true,

    async fetchJson<T>(path: string): Promise<T> {
      const url = new URL(path, window.location.origin)
      // Game data, not yours: from the real server when one is running (no region layer otherwise).
      if (url.pathname === '/api/regions' || url.pathname === '/api/shop/catalog') return live.fetchJson<T>(path)
      await delay(60 + Math.random() * 80)
      const handler = routes[url.pathname]
      if (!handler) throw new Error(`HTTP 404: ${path}`)
      return notes.apply(url.pathname, structuredClone(handler(url.searchParams))) as T
    },

    async send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
      await delay(80)
      if (method === 'PUT' && path === '/api/notes') {
        notes.put(body as NoteRequest)
        notify?.(['system', 'navroute', 'history', 'galaxy'])
        return null
      }
      return structuredClone(route.send(method, path, body) ?? null) as T | null
    },

    stream(handlers: StreamHandlers): () => void {
      let seq = 0
      notify = (topics) => handlers.onEvent({ type: 'invalidate', data: { seq: ++seq, topics } })
      const timers: ReturnType<typeof setTimeout>[] = []

      timers.push(
        setTimeout(() => {
          handlers.onState('open')
          handlers.onEvent({ type: 'hello', data: { seq: ++seq } })
        }, 300),
      )

      const statusTimer = setInterval(() => {
        handlers.onEvent({ type: 'status', data: simulatedStatus(elapsed()) })
      }, STATUS_INTERVAL_MS)

      const trackTimer = setInterval(() => notify?.(['surface']), TRACK_EVERY_MS)

      const ingestTimer = setInterval(() => {
        if (ingest.backfillDone) return
        const filesDone = ingest.filesDone + 1
        ingest = {
          ...ingest,
          filesDone,
          events: ingest.events + 1_500 + Math.round(Math.random() * 1_500),
          backfillDone: filesDone >= ingest.filesTotal,
        }
        handlers.onEvent({ type: 'ingest', data: ingest })
        if (ingest.backfillDone) {
          handlers.onEvent({ type: 'invalidate', data: { seq: ++seq, topics: ['system', 'surface', 'session'] } })
        }
      }, INGEST_INTERVAL_MS)

      return () => {
        timers.forEach(clearTimeout)
        clearInterval(statusTimer)
        clearInterval(trackTimer)
        clearInterval(ingestTimer)
      }
    },
  }
}

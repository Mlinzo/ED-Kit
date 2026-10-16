// Demo transport for ?mock=1: serves fixtures and simulates the event stream —
// a commander driving an SRV around the sample sites so the radar animates,
// plus a short journal backfill so the progress bar shows.

import type { StreamHandlers, Transport } from '../api/transport'
import type { IngestState, LiveStatus } from '../api/types'
import { offsetLatLon } from '../lib/geo'
import {
  buildSession,
  buildSurface,
  buildSystem,
  PLANET_RADIUS_M,
  SITE_ORIGIN,
  SURFACE_BODY_NAME,
} from './fixtures'
import { buildStats } from './stats'

const STATUS_INTERVAL_MS = 250
const INGEST_INTERVAL_MS = 300
const LAP_SECONDS = 90
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
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createMockTransport(): Transport {
  const system = buildSystem()
  const surface = buildSurface(system)
  const session = buildSession()
  const stats = buildStats()
  const startedAt = performance.now()
  const elapsed = () => (performance.now() - startedAt) / 1_000

  let ingest: IngestState = {
    backfillDone: false,
    filesTotal: 21,
    filesDone: 0,
    events: 0,
    journalDir: 'C:\\Users\\Commander\\Saved Games\\Frontier Developments\\Elite Dangerous',
    journalDirFound: true,
  }

  const routes: Record<string, () => unknown> = {
    '/api/view/system': () => system,
    '/api/view/surface': () => surface,
    '/api/view/session': () => session,
    '/api/view/stats': () => stats,
    '/api/status': () => simulatedStatus(elapsed()),
    '/api/ingest': () => ingest,
  }

  return {
    mock: true,

    async fetchJson<T>(path: string): Promise<T> {
      await delay(60 + Math.random() * 80)
      const route = routes[path]
      if (!route) throw new Error(`HTTP 404: ${path}`)
      return structuredClone(route()) as T
    },

    stream(handlers: StreamHandlers): () => void {
      let seq = 0
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
        clearInterval(ingestTimer)
      }
    },
  }
}

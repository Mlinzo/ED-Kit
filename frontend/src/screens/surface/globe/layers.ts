// What the planet globe shows, layer by layer: the colour of each layer and where its data comes
// from (said next to it in the legend and on every mark's card).

import type { GlobeMark, GlobeView } from '../../../api/types'
import { t } from '../../../i18n'

/** Layers you can hide; your ship is shown whenever it is on the planet, you whenever you are. */
export type LayerId = 'samples' | 'codex' | 'landings' | 'settlements' | 'community'
export const LAYERS: readonly LayerId[] = ['samples', 'codex', 'landings', 'settlements', 'community']

export type SourceId = 'live' | 'journal' | 'recorded' | 'community'

export interface LayerStyle {
  /** sRGB hex: the WebGL marks and the legend dots. */
  color: string
  /** Mark size on screen, CSS px. */
  size: number
  source: SourceId
}

export const YOU_COLOR = '#38bdf8' // the accent (sky-400)
export const SHIP_COLOR = '#e4e4e7' // zinc-200

export const LAYER_STYLE: Record<LayerId | 'ship', LayerStyle> = {
  samples: { color: '#34d399', size: 10, source: 'recorded' }, // emerald-400: value
  codex: { color: '#fde68a', size: 10, source: 'journal' }, // amber-200
  landings: { color: '#a1a1aa', size: 8, source: 'journal' }, // zinc-400
  settlements: { color: '#fdba74', size: 11, source: 'journal' }, // orange-300
  community: { color: '#a78bfa', size: 8, source: 'community' }, // violet-400: community data
  ship: { color: SHIP_COLOR, size: 0, source: 'journal' },
}

export interface GlobePoint {
  id: string
  layer: LayerId | 'ship'
  lat: number
  lon: number
  title: string
  /** "sample 2 · analysed", the Canonn category, the ship's state. */
  detail: string | null
  /** When it was recorded (ISO); Canonn gives no dates. */
  at: string | null
  /** A Canonn find: its name ("Osseus Discus - Blue"), the list filters on it. */
  find?: string
}

function markLayer(kind: GlobeMark['kind']): LayerId {
  return kind === 'sample' ? 'samples' : kind === 'landing' ? 'landings' : kind === 'settlement' ? 'settlements' : 'codex'
}

/** Ids from content, not order: a refetch keeps the selection on the same mark. */
function markId(m: GlobeMark): string {
  return `${m.kind}:${m.lat}:${m.lon}:${m.n ?? ''}:${m.name}:${m.at ?? ''}`
}

function markPoint(m: GlobeMark): GlobePoint {
  const layer = markLayer(m.kind)
  const id = markId(m)
  if (m.kind === 'sample') {
    const parts = [m.n !== null ? t.globe.sample(m.n) : null, m.status ? t.globe.status[m.status] : null]
    return {
      id,
      layer,
      lat: m.lat,
      lon: m.lon,
      title: m.colour ? `${m.name} · ${m.colour}` : m.name,
      detail: parts.filter(Boolean).join(' · ') || null,
      at: m.at,
    }
  }
  const title = m.kind === 'landing' ? t.globe.landing : m.colour ? `${m.name} · ${m.colour}` : m.name
  return { id, layer, lat: m.lat, lon: m.lon, title, detail: null, at: m.at }
}

/** Every mark of the globe; Canonn's only for `find` when one is chosen. */
export function globePoints(globe: GlobeView, find: string | null = null): GlobePoint[] {
  const points = globe.marks.map(markPoint)
  const ship = globe.ship
  if (ship && ship.lat !== null && ship.lon !== null) {
    points.push({
      id: 'ship',
      layer: 'ship',
      lat: ship.lat,
      lon: ship.lon,
      title: t.globe.layer.ship,
      detail: t.globe.ship[ship.state],
      at: ship.at,
    })
  }
  for (const f of globe.community) {
    if (find !== null && f.name !== find) continue
    for (const [lat, lon] of f.points) {
      points.push({ id: `community:${lat}:${lon}:${f.name}`, layer: 'community', lat, lon, title: f.name, detail: f.category, at: null, find: f.name })
    }
  }
  return points
}

/** How many marks each layer has (the legend counts). */
export function layerCounts(globe: GlobeView): Record<LayerId, number> {
  const counts: Record<LayerId, number> = { samples: 0, codex: 0, landings: 0, settlements: 0, community: 0 }
  for (const m of globe.marks) counts[markLayer(m.kind)] += 1
  for (const f of globe.community) counts.community += f.points.length
  return counts
}

export function sourceLabel(source: SourceId): string {
  return t.globe.from[source]
}

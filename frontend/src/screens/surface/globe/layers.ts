// What the planet globe shows, layer by layer: the colour of each layer and where its data comes
// from (said next to it in the legend and on every mark's card).

import { PlaneLanding, PlaneTakeoff, type LucideIcon } from 'lucide-react'
import type { BookmarkView, GlobeMark, GlobeView } from '../../../api/types'
import { bookmarkName } from '../../../components/bookmarks'
import { t } from '../../../i18n'
import { haversineM, type LatLon } from '../../../lib/geo'

/** Layers you can hide; your ship is shown whenever it is on the planet, you whenever you are. */
export type LayerId = 'bookmarks' | 'samples' | 'track' | 'codex' | 'landings' | 'takeoffs' | 'settlements' | 'community'
export const LAYERS: readonly LayerId[] = ['bookmarks', 'samples', 'track', 'codex', 'landings', 'takeoffs', 'settlements', 'community']

export type SourceId = 'live' | 'journal' | 'recorded' | 'tracked' | 'community' | 'yours'

export interface LayerStyle {
  /** sRGB hex: the WebGL marks and the legend dots. */
  color: string
  /** Mark size on screen, CSS px (the path: its line width). */
  size: number
  source: SourceId
}

export const YOU_COLOR = '#38bdf8' // the accent (sky-400)
/** Farther than this from the path's end (you flew off), the path is not drawn on to you. */
const PATH_JOIN_M = 2_000
export const SHIP_COLOR = '#e4e4e7' // zinc-200

export const LAYER_STYLE: Record<LayerId | 'ship', LayerStyle> = {
  bookmarks: { color: '#fde68a', size: 12, source: 'yours' }, // amber-200, as on the galaxy map; drawn as icons
  samples: { color: '#34d399', size: 10, source: 'recorded' }, // emerald-400: value
  track: { color: '#7dd3fc', size: 2.5, source: 'tracked' }, // sky-300: you, lighter
  codex: { color: '#fde68a', size: 10, source: 'journal' }, // amber-200
  landings: { color: '#d4d4d8', size: 0, source: 'journal' }, // zinc-300, near the ship's; drawn as icons
  takeoffs: { color: '#d4d4d8', size: 0, source: 'journal' },
  settlements: { color: '#fdba74', size: 11, source: 'journal' }, // orange-300
  community: { color: '#a78bfa', size: 8, source: 'community' }, // violet-400: community data
  ship: { color: SHIP_COLOR, size: 0, source: 'journal' },
}

/** Layers drawn as icons over the globe (as in the legend and on cards) instead of dots. */
export const LAYER_ICON: Partial<Record<LayerId | 'ship', LucideIcon>> = { landings: PlaneLanding, takeoffs: PlaneTakeoff }

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
  /** One of your bookmarked places. */
  bookmark?: BookmarkView
}

const MARK_LAYER: Record<GlobeMark['kind'], LayerId> = {
  sample: 'samples',
  codex: 'codex',
  landing: 'landings',
  takeoff: 'takeoffs',
  settlement: 'settlements',
}

/** Ids from content, not order: a refetch keeps the selection on the same mark. */
function markId(m: GlobeMark): string {
  return `${m.kind}:${m.lat}:${m.lon}:${m.n ?? ''}:${m.name}:${m.at ?? ''}`
}

function markPoint(m: GlobeMark): GlobePoint {
  const layer = MARK_LAYER[m.kind]
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
  const title =
    m.kind === 'landing' ? t.globe.landing : m.kind === 'takeoff' ? t.globe.takeoff : m.colour ? `${m.name} · ${m.colour}` : m.name
  return { id, layer, lat: m.lat, lon: m.lon, title, detail: null, at: m.at }
}

function placePoint(b: BookmarkView): GlobePoint {
  return {
    id: `bookmark:${b.id}`,
    layer: 'bookmarks',
    lat: b.lat ?? 0,
    lon: b.lon ?? 0,
    title: bookmarkName(b),
    detail: t.bookmarks.category[b.category],
    at: b.createdAt,
    bookmark: b,
  }
}

/** Every mark of the globe; Canonn's only for `find` when one is chosen. */
export function globePoints(globe: GlobeView, find: string | null = null): GlobePoint[] {
  const points = [...globe.places.filter((b) => b.lat !== null && b.lon !== null).map(placePoint), ...globe.marks.map(markPoint)]
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

/** How many marks each layer has (the legend counts; the path: its points). */
export function layerCounts(globe: GlobeView): Record<LayerId, number> {
  const counts: Record<LayerId, number> = {
    bookmarks: globe.places.length,
    samples: 0,
    track: 0,
    codex: 0,
    landings: 0,
    takeoffs: 0,
    settlements: 0,
    community: 0,
  }
  for (const m of globe.marks) counts[MARK_LAYER[m.kind]] += 1
  for (const s of globe.track) counts.track += s.length
  for (const f of globe.community) counts.community += f.points.length
  return counts
}

/** Your path as lines: the stored stretches, the latest one drawn on to you while you are near
 * its end (the app sends new points every few seconds). */
export function pathLines(globe: GlobeView, here: LatLon | null): LatLon[][] {
  const lines = globe.track.map((s) => s.map(([lat, lon]) => ({ lat, lon })))
  const last = lines.at(-1)
  const end = last?.at(-1)
  if (last && end && here && haversineM(end, here, globe.radiusM) < PATH_JOIN_M) last.push({ lat: here.lat, lon: here.lon })
  return lines.filter((l) => l.length > 1)
}

/** The length of your path here, metres. */
export function pathLengthM(globe: GlobeView): number {
  let m = 0
  for (const s of globe.track) for (let i = 1; i < s.length; i++) m += haversineM({ lat: s[i - 1][0], lon: s[i - 1][1] }, { lat: s[i][0], lon: s[i][1] }, globe.radiusM)
  return m
}

export function sourceLabel(source: SourceId): string {
  return t.globe.from[source]
}

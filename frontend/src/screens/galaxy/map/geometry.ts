// Galaxy map geometry: your travels in galactic coordinates scaled to the scene, what to draw
// and how important each system is. Pure, so it is tested without WebGL.

import type { GalaxySystemView, GalaxyView, RoutePoint } from '../../../api/types'
import type { FitLimits, Vec3 } from '../../route/map/geometry'
import { toScene } from '../../route/map/geometry'
import { LANDMARKS } from '../../../lib/landmarks'

/** Scene units per light year: the whole galaxy (~90 000 ly) is ~900 units across. */
export const SCALE = 1 / 100
/** Controls' camera distance (scene units): from ~5 ly to the whole galaxy and more. */
export const GALAXY_RANGE: FitLimits = { min: 0.05, max: 2_500 }
/** Fitted views: never closer than ~40 ly (a single system), at most the whole range. */
export const GALAXY_LIMITS: FitLimits = { min: 0.4, max: 2_500 }
/** How close "go to you" comes (scene units): ~300 ly. */
export const FOCUS_DISTANCE = 3

const ORIGIN: Vec3 = [0, 0, 0]
export const at = (p: { x: number; y: number; z: number }): Vec3 => toScene(p, ORIGIN, SCALE)

export { LANDMARKS }
export const CORE = LANDMARKS[1]
/** Galaxy disk radius around the core, ly (the backdrop and the whole-galaxy view). */
export const DISK_RADIUS_LY = 46_000
/** Rings around the core every this many ly. */
export const RING_STEP_LY = 10_000

export type DotKind = 'plain' | 'earned' | 'firsts'

export interface MapSystem {
  index: number
  address: string
  name: string
  pos: Vec3
  kind: DotKind
  /** Dot diameter, CSS px. */
  size: number
}

export interface GalaxyScene {
  /** Draw order: the plain ones first, the systems with firsts last (on top, picked first). */
  systems: MapSystem[]
  /** Your travels, run by run (scene units), oldest point first. */
  paths: Vec3[][]
  you: Vec3 | null
  /** Where your travels begin: the first system of the path (or the first visited). */
  start: { pos: Vec3; index: number } | null
  deaths: { pos: Vec3; index: number }[]
  /** From you through the planned route's stops still to do. */
  route: Vec3[]
  /** The route plotted in the game, from where you are. */
  plotted: Vec3[]
  /** What "your travels" frames. */
  travels: Vec3[]
  /** What "whole galaxy" frames. */
  galaxy: Vec3[]
}

const DOT = { plain: 3.5, min: 5, max: 11, firsts: 8 }

export function dotKind(s: GalaxySystemView): DotKind {
  if (s.firsts > 0) return 'firsts'
  if (s.value > 0) return 'earned'
  return 'plain'
}

/** Dot sizes: plain systems small, the rest on a log scale of what they earned. */
export function dotSize(s: GalaxySystemView, lo: number, hi: number): number {
  const kind = dotKind(s)
  if (kind === 'plain') return DOT.plain
  const v = Math.log(Math.max(1, s.value))
  const t = hi > lo ? (v - lo) / (hi - lo) : 0.5
  const size = DOT.min + (DOT.max - DOT.min) * Math.max(0, Math.min(1, t))
  return kind === 'firsts' ? Math.max(size, DOT.firsts) : size
}

const RANK: Record<DotKind, number> = { plain: 0, earned: 1, firsts: 2 }

export function buildGalaxyScene(view: GalaxyView): GalaxyScene {
  let lo = Infinity
  let hi = -Infinity
  for (const s of view.systems) {
    if (s.value <= 0) continue
    const v = Math.log(s.value)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const systems = view.systems
    .map<MapSystem>((s, index) => ({
      index,
      address: s.address,
      name: s.name,
      pos: at(s),
      kind: dotKind(s),
      size: dotSize(s, lo, hi),
    }))
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.size - b.size || a.index - b.index)

  const pos = (i: number) => at(view.systems[i])
  const you = view.current !== null && view.systems[view.current] ? pos(view.current) : null
  const first = view.path.find((run) => run.length > 0)?.[0] ?? (view.systems.length > 0 ? 0 : null)
  const line = (points: RoutePoint[]) => points.map(at)
  const route = view.route.length > 0 ? [...(you ? [you] : []), ...line(view.route)] : []
  const plotted = line(view.plotted)
  const travels = [...view.systems.map(at), ...line(view.route), ...plotted]
  if (travels.length === 0) travels.push(at(LANDMARKS[0]))
  const core = at(CORE)
  const r = DISK_RADIUS_LY * SCALE
  return {
    systems,
    paths: view.path.filter((run) => run.length > 1).map((run) => run.map(pos)),
    you,
    start: first !== null && view.systems[first] ? { pos: pos(first), index: first } : null,
    deaths: view.deaths.filter((d) => d.system !== null && view.systems[d.system]).map((d) => ({ pos: pos(d.system!), index: d.system! })),
    route: route.length > 1 ? route : [],
    plotted: plotted.length > 1 ? plotted : [],
    travels,
    galaxy: [
      [core[0] - r, core[1], core[2] - r],
      [core[0] + r, core[1], core[2] - r],
      [core[0] - r, core[1], core[2] + r],
      [core[0] + r, core[1], core[2] + r],
    ],
  }
}

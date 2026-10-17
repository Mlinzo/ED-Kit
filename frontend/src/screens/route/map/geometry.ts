// Route map geometry: galactic coordinates in scene units, what to draw (paths, corridor, floor),
// camera framing and picking. Pure, so it is tested without WebGL.

import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import type { RouteStopView, RouteView } from '../../../api/types'
import { principalAzimuth, type Point } from '../../../map/framing'

export type Vec3 = [number, number, number]

interface Xyz {
  x: number
  y: number
  z: number
}

/**
 * Whatever its size (a 100 ly loop or a 20 000 ly line), the route is scaled to this radius in
 * scene units: clip planes, the sky and the camera limits stay fixed.
 */
export const SCENE_RADIUS = 50
/** Smallest radius (ly) framed: a route of one or two stops is not blown up. */
const MIN_RADIUS_LY = 10
/** You are drawn up to this far from the centre (× SCENE_RADIUS), and framed up to FRAME_YOU. */
const DRAW_YOU = 4
const FRAME_YOU = 1.6
/** Camera distance limits (scene units): the orbit controls' and every fitted view's. */
export const CAMERA_RANGE = { min: 1, max: SCENE_RADIUS * 12 }
/** The closest a whole-route view comes: a route of one system is not looked at from 1 unit. */
const MIN_FIT_DISTANCE = SCENE_RADIUS * 0.5

export type StopState = 'done' | 'next' | 'ahead' | 'skipped'

export interface MapStop {
  address: string
  seq: number
  name: string
  pos: Vec3
  state: StopState
  here: boolean
  /** Dot diameter, CSS px: the more to earn, the bigger. */
  size: number
}

export interface RouteScene {
  /** Galactic point at the scene origin, and scene units per light year. */
  center: Vec3
  scale: number
  radiusLy: number
  stops: MapStop[]
  source: Vec3 | null
  destination: Vec3 | null
  /** Where you are; null when unknown or far away from the route. */
  you: Vec3 | null
  /** You are close enough to be framed with the route (and to stand on its floor). */
  youFramed: boolean
  /** Distance (ly) to the nearest point of the route when you are too far away to be drawn. */
  youFarLy: number | null
  /** Plane under everything: the grid, and the stalks that drop to it. */
  floorY: number
  /** The start and the stops before the next one (skipped stops left out). */
  donePath: Vec3[]
  /** The last of those, the next stop and the rest. */
  aheadPath: Vec3[]
  /** Line mode: the last stop to the destination. */
  tailPath: Vec3[]
  /** Line mode: the corridor searched (scene units). */
  corridor: { from: Vec3; to: Vec3; radius: number } | null
  /** Riches mode: the search radius around the start (scene units). */
  ring: { center: Vec3; radius: number } | null
  /** Grid cell, ly. */
  gridLy: number
}

/**
 * Elite's galactic coordinates are left-handed (x towards galactic east, y up out of the plane,
 * z towards the core); the scene is right-handed, so z flips. Seen from above with azimuth 0 the
 * core is up the screen and +x to the right, as in the galaxy map.
 */
export function toScene(p: Xyz, center: Vec3, scale: number): Vec3 {
  return [(p.x - center[0]) * scale, (p.y - center[1]) * scale, -(p.z - center[2]) * scale]
}

export function stopState(stop: RouteStopView, nextSeq: number | null): StopState {
  if (stop.seq === nextSeq) return 'next'
  if (stop.done) return 'done'
  if (stop.skipped) return 'skipped'
  return 'ahead'
}

const DOT = { min: 7, max: 13, quiet: 6, next: 12 }

/** Dot sizes on a log scale of the stops' value; done and skipped stops stay small. */
function dotSizes(stops: readonly RouteStopView[], states: readonly StopState[]): number[] {
  const logs = stops.map((s) => Math.log(Math.max(1, s.value)))
  let lo = Infinity
  let hi = -Infinity
  for (const v of logs) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return stops.map((_, i) => {
    if (states[i] === 'done' || states[i] === 'skipped') return DOT.quiet
    const t = hi > lo ? (logs[i] - lo) / (hi - lo) : 0.5
    const size = DOT.min + (DOT.max - DOT.min) * t
    return states[i] === 'next' ? Math.max(size, DOT.next) : size
  })
}

/** Smallest 1-2-5 step (× 10ⁿ) of at least `x`. */
export function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-6)))
  for (const m of [1, 2, 5]) if (m * p >= x * (1 - 1e-9)) return m * p
  return 10 * p
}

const length = (p: Vec3) => Math.hypot(p[0], p[1], p[2])

export function buildScene(route: RouteView): RouteScene {
  const params = route.params
  const framed: Xyz[] = [...route.stops]
  if (route.source) framed.push(route.source)
  if (route.destination) framed.push(route.destination)
  if (framed.length === 0 && route.currentPosition) framed.push(route.currentPosition)

  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of framed) {
    const c = [p.x, p.y, p.z]
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], c[k])
      hi[k] = Math.max(hi[k], c[k])
    }
  }
  const center: Vec3 = framed.length > 0 ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0]
  let radiusLy = MIN_RADIUS_LY
  for (const p of framed) radiusLy = Math.max(radiusLy, Math.hypot(p.x - center[0], p.y - center[1], p.z - center[2]))
  const scale = SCENE_RADIUS / radiusLy
  const at = (p: Xyz) => toScene(p, center, scale)

  const states = route.stops.map((s) => stopState(s, route.nextSeq))
  const sizes = dotSizes(route.stops, states)
  const stops: MapStop[] = route.stops.map((s, i) => ({
    address: s.address,
    seq: s.seq,
    name: s.name,
    pos: at(s),
    state: states[i],
    here: s.here,
    size: sizes[i],
  }))

  const source = route.source ? at(route.source) : null
  const destination = route.destination ? at(route.destination) : null
  let you: Vec3 | null = null
  let youFarLy: number | null = null
  const here = route.currentPosition
  if (here) {
    const p = at(here)
    if (length(p) <= DRAW_YOU * SCENE_RADIUS) you = p
    else youFarLy = Math.min(...framed.map((q) => Math.hypot(q.x - here.x, q.y - here.y, q.z - here.z)))
  }
  const youFramed = you !== null && length(you) <= FRAME_YOU * SCENE_RADIUS

  // The path you fly: skipped stops are left out of it.
  const active = stops.filter((s) => s.state !== 'skipped')
  const nextAt = active.findIndex((s) => s.state === 'next')
  const travelled = [...(source ? [source] : []), ...(nextAt < 0 ? active : active.slice(0, nextAt)).map((s) => s.pos)]
  const aheadPath = nextAt < 0 ? [] : [...travelled.slice(-1), ...active.slice(nextAt).map((s) => s.pos)]
  const last = active.at(-1)?.pos ?? source
  const line = params?.mode === 'line'

  // Under what is framed: you far below the route would sink the floor out of view.
  let floorY = Infinity
  for (const p of [...stops.map((s) => s.pos), source, destination, youFramed ? you : null]) if (p) floorY = Math.min(floorY, p[1])
  if (!Number.isFinite(floorY)) floorY = 0

  return {
    center,
    scale,
    radiusLy,
    stops,
    source,
    destination,
    you,
    youFramed,
    youFarLy,
    floorY: floorY - SCENE_RADIUS * 0.06,
    donePath: travelled.length >= 2 ? travelled : [],
    aheadPath: aheadPath.length >= 2 ? aheadPath : [],
    tailPath: line && destination && last ? [last, destination] : [],
    corridor: line && source && destination && params ? { from: source, to: destination, radius: params.deviationLy * scale } : null,
    ring: !line && source && params ? { center: source, radius: params.radiusLy * scale } : null,
    gridLy: niceStep(radiusLy / 5),
  }
}

/** What the whole-route view frames: the route, and you when you are close to it. */
export function framePoints(scene: RouteScene): Vec3[] {
  const pts = scene.stops.map((s) => s.pos)
  if (scene.source) pts.push(scene.source)
  if (scene.destination) pts.push(scene.destination)
  if (scene.you && scene.youFramed) pts.push(scene.you)
  return pts
}

export interface View {
  target: Vec3
  distance: number
  polar: number
  azimuth: number
}

const DEG = Math.PI / 180
/** The overview looks down 40° from the plane; the top view straight down (core up). */
export const OVERVIEW_POLAR = 50 * DEG
export const TOP_POLAR = 0.02
/** NDC extents the framed points may use: room for labels above and the overlay around. */
const MARGIN = { x: 0.84, top: 0.7, bottom: 0.78 }

/**
 * Camera distance and look-at point that frame `points` seen from `polar` / `azimuth` within the
 * margins: bisects the distance, then shifts the target until the points are centred.
 */
export function fitView(points: readonly Vec3[], fovDeg: number, aspect: number, polar: number, azimuth: number): View {
  const pts = points.length > 0 ? points : [[0, 0, 0] as Vec3]
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k])
      hi[k] = Math.max(hi[k], p[k])
    }
  }
  const target = new Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)
  const span = Math.max(1, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2)
  const cam = new PerspectiveCamera(fovDeg, aspect, 0.01, 1e7)
  const sph = new Spherical()
  const v = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  const halfV = Math.tan((fovDeg * DEG) / 2)
  const halfH = halfV * aspect

  const measure = (d: number) => {
    sph.set(d, polar, azimuth)
    cam.position.setFromSpherical(sph).add(target)
    cam.lookAt(target)
    cam.updateMatrixWorld()
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of pts) {
      v.set(p[0], p[1], p[2]).applyMatrix4(cam.matrixWorldInverse)
      if (v.z > -0.01) return null // behind the camera: too close
      v.applyMatrix4(cam.projectionMatrix)
      x0 = Math.min(x0, v.x)
      x1 = Math.max(x1, v.x)
      y0 = Math.min(y0, v.y)
      y1 = Math.max(y1, v.y)
    }
    return { x0, x1, y0, y1 }
  }
  const fits = (m: ReturnType<typeof measure>) =>
    m !== null && m.x1 - m.x0 <= 2 * MARGIN.x && m.y1 - m.y0 <= MARGIN.top + MARGIN.bottom

  let distance = span * 3
  for (let iter = 0; iter < 6; iter++) {
    let a = span * 0.05
    let b = span * 400
    for (let i = 0; i < 30; i++) {
      const mid = (a + b) / 2
      if (fits(measure(mid))) b = mid
      else a = mid
    }
    distance = b
    const m = measure(distance)
    if (!m) break
    const cx = (m.x0 + m.x1) / 2
    const cy = (m.y0 + m.y1) / 2 - (MARGIN.top - MARGIN.bottom) / 2
    if (Math.abs(cx) < 0.003 && Math.abs(cy) < 0.003) break
    // NDC offset -> world offset at the target's depth.
    right.setFromMatrixColumn(cam.matrixWorld, 0)
    up.setFromMatrixColumn(cam.matrixWorld, 1)
    target.addScaledVector(right, cx * halfH * distance).addScaledVector(up, cy * halfV * distance)
  }
  // Within the controls' range, or a flight towards it would never arrive.
  distance = Math.min(CAMERA_RANGE.max, Math.max(MIN_FIT_DISTANCE, distance))
  return { target: [target.x, target.y, target.z], distance, polar, azimuth }
}

/** Tilted whole-route view, its long axis along the long side of the screen. */
export function overview(points: readonly Vec3[], fovDeg: number, aspect: number): View {
  const azimuth = principalAzimuth(
    points.map((p) => [p[0], p[2]] as Point),
    aspect,
  )
  return fitView(points, fovDeg, aspect, OVERVIEW_POLAR, azimuth)
}

/** Straight down, the core up the screen: the galaxy map's orientation. */
export function topView(points: readonly Vec3[], fovDeg: number, aspect: number): View {
  return fitView(points, fovDeg, aspect, TOP_POLAR, 0)
}

/** A stop's dot on screen (CSS px from the canvas's top-left corner). */
export interface Projected {
  x: number
  y: number
  radius: number
}

/**
 * The dot under (or next to) the pointer: within its radius plus `slop` px. Of several dots under
 * the pointer, the one drawn on top wins: the dots are one draw call without depth, so a later
 * one covers an earlier one. -1 when there is none.
 */
export function pickNearest(points: readonly (Projected | null)[], px: number, py: number, slop = 5): number {
  let best = -1
  let bestGap = Infinity
  points.forEach((p, i) => {
    if (!p) return
    const d = Math.hypot(p.x - px, p.y - py)
    if (d > p.radius + slop) return
    const gap = Math.max(0, d - p.radius)
    if (gap <= bestGap + 1e-6) {
      best = i
      bestGap = Math.min(bestGap, gap)
    }
  })
  return best
}

/** A circle in the horizontal plane through the origin, closed (first point repeated). */
export function circle(radius: number, segments = 96): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = (i / segments) * Math.PI * 2
    return [Math.cos(a) * radius, 0, Math.sin(a) * radius] as Vec3
  })
}

/** A label to place: its anchor on screen (CSS px), its size, how far it keeps from the anchor. */
export interface LabelBox {
  x: number
  y: number
  w: number
  h: number
  lift: number
  /** Shown even when it overlaps (hovered, selected). */
  always: boolean
  /** The anchor is in view. */
  visible: boolean
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const LABEL_PAD = 3
/** How far (px) a label may slide back inside the map at its edges. */
const MAX_NUDGE = 40

/**
 * Offsets (top-left corner relative to the anchor) for labels in priority order: above, below,
 * right or left of the anchor, slid back inside the map near its edges, never over the labels
 * placed before. null hides a label; the `always` ones take the first spot inside the map even
 * when it overlaps.
 */
export function placeLabels(boxes: readonly LabelBox[], width: number, height: number): ([number, number] | null)[] {
  const placed: Rect[] = []
  return boxes.map((b) => {
    if (!b.visible) return null
    const candidates: [number, number][] = [
      [-b.w / 2, -b.lift - b.h],
      [-b.w / 2, b.lift],
      [b.lift, -b.h / 2],
      [-b.lift - b.w, -b.h / 2],
    ]
    const clamp = (anchor: number, offset: number, size: number, limit: number) => {
      const lo = LABEL_PAD - anchor
      const hi = limit - LABEL_PAD - size - anchor
      return lo > hi ? offset : Math.min(hi, Math.max(lo, offset))
    }
    const r = Math.max(2, b.lift - 3)
    const own = { x0: b.x - r, y0: b.y - r, x1: b.x + r, y1: b.y + r }
    let fallback: { at: [number, number]; rect: Rect } | null = null
    /** Inside the map but slid farther than MAX_NUDGE (a big card in a corner): the least slid. */
    let farFallback: { at: [number, number]; rect: Rect; nudge: number } | null = null
    for (const [cx, cy] of candidates) {
      const dx = clamp(b.x, cx, b.w, width)
      const dy = clamp(b.y, cy, b.h, height)
      const rect = { x0: b.x + dx - LABEL_PAD, y0: b.y + dy - LABEL_PAD, x1: b.x + dx + b.w + LABEL_PAD, y1: b.y + dy + b.h + LABEL_PAD }
      // Never slid over its own point.
      if (overlaps(rect, own)) continue
      const nudge = Math.max(Math.abs(dx - cx), Math.abs(dy - cy))
      if (nudge > MAX_NUDGE) {
        if (!farFallback || nudge < farFallback.nudge) farFallback = { at: [dx, dy], rect, nudge }
        continue
      }
      fallback ??= { at: [dx, dy], rect }
      if (placed.some((p) => overlaps(p, rect))) continue
      placed.push(rect)
      return [dx, dy]
    }
    if (!b.always) return null
    const spot = fallback ?? farFallback
    if (spot) {
      placed.push(spot.rect)
      return spot.at
    }
    return [clamp(b.x, candidates[0][0], b.w, width), clamp(b.y, candidates[0][1], b.h, height)]
  })
}

// Default camera framing of the whole system: fits what is actually drawn (bodies and orbit
// circles at their current positions), not the worst-case disc, and turns the view so that an
// elongated system (two stars with their planets) lies along the long side of the screen.

import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { hasVisibleOrbit, worldPositions, type SystemLayout } from './layout'

export type Point = [number, number]

const ORBIT_SAMPLES = 32
/** Smallest area (radius, scene units) the overview frames. */
const MIN_VIEW_RADIUS = 14
const DEG = Math.PI / 180

/** Points (x, z) on the orbit plane that must be in view: body discs and drawn orbit circles. */
export function contentPoints(layout: SystemLayout, nowMs: number): Point[] {
  const pos = worldPositions(layout, nowMs)
  const pts: Point[] = []
  const circle = (cx: number, cz: number, r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)])
    }
  }
  for (const node of layout.nodes.values()) {
    const p = pos.get(node.id)
    if (!p) continue
    circle(p[0], p[1], Math.max(node.size, 0.5), 6)
    // Components are drawn as spokes to their barycentre (inside the discs), not as circles.
    if (node.parent && node.role === 'orbit' && hasVisibleOrbit(node)) {
      const q = pos.get(node.parent.id)
      if (q) circle(q[0], q[1], node.orbitRadius, ORBIT_SAMPLES)
    }
  }
  // A lone star (or a star with one close planet) is not blown up to fill the screen.
  if (pts.length > 0) {
    let x0 = Infinity
    let x1 = -Infinity
    let z0 = Infinity
    let z1 = -Infinity
    for (const [x, z] of pts) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
    }
    if (Math.max(x1 - x0, z1 - z0) / 2 < MIN_VIEW_RADIUS) circle((x0 + x1) / 2, (z0 + z1) / 2, MIN_VIEW_RADIUS, 24)
  }
  return convexHull(pts)
}

/** Monotone chain convex hull (counter-clockwise). Projections keep convexity, so it is enough. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length <= 2) return pts
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * Camera azimuth that lays the content's long axis along the screen's long side (horizontal on
 * landscape, vertical on portrait), or `fallback` for roundish content. Of the two equivalent
 * directions, the one closer to `fallback` wins.
 */
export function principalAzimuth(points: Point[], aspect: number, fallback = 0): number {
  if (points.length < 3) return fallback
  let mx = 0
  let mz = 0
  for (const [x, z] of points) {
    mx += x
    mz += z
  }
  mx /= points.length
  mz /= points.length
  let sxx = 0
  let szz = 0
  let sxz = 0
  for (const [x, z] of points) {
    sxx += (x - mx) ** 2
    szz += (z - mz) ** 2
    sxz += (x - mx) * (z - mz)
  }
  const tr = sxx + szz
  const det = sxx * szz - sxz * sxz
  const gap = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  const l1 = tr / 2 + gap
  const l2 = tr / 2 - gap
  // Roundish (or a square screen): keep the default view.
  if (l1 <= 0 || l1 < l2 * 1.6 || Math.abs(aspect - 1) < 0.15) return fallback
  const axis = Math.atan2(2 * sxz, sxx - szz) / 2 // angle of the long axis in the (x, z) plane
  const ax = Math.cos(axis)
  const az = Math.sin(axis)
  // Camera right = (cos θ, 0, -sin θ); towards the camera on the ground = (sin θ, 0, cos θ).
  const theta = aspect > 1 ? Math.atan2(-az, ax) : Math.atan2(ax, az)
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
  const a = wrap(theta - fallback)
  const b = wrap(theta + Math.PI - fallback)
  return fallback + (Math.abs(a) <= Math.abs(b) ? a : b)
}

/** Screen margins (NDC) kept free when fitting the whole system: labels above, hint below. */
export const FIT_MARGINS = { x: 0.9, top: 0.78, bottom: 0.86 }

/**
 * Camera distance and look-at point (on the orbit plane) that frame `points` seen from
 * `polar` / `azimuth`, centred between the margins.
 */
export function fitPoints(
  points: Point[],
  fovDeg: number,
  aspect: number,
  polar: number,
  azimuth: number,
  margins = FIT_MARGINS,
): { distance: number; target: Vector3 } {
  const pts = points.length > 0 ? points : [[0, 0] as Point]
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of pts) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const span = Math.max(1, Math.hypot(maxX - minX, maxZ - minZ) / 2)
  const cam = new PerspectiveCamera(fovDeg, aspect, 0.01, 1e7)
  const v = new Vector3()
  const sph = new Spherical()
  const target = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  const right = new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth))
  const toward = new Vector3(Math.sin(azimuth), 0, Math.cos(azimuth))
  const halfV = Math.tan(((fovDeg * Math.PI) / 180) / 2)
  const halfH = halfV * aspect
  const want = (margins.top - margins.bottom) / 2

  const measure = (d: number) => {
    sph.set(d, polar, azimuth)
    cam.position.setFromSpherical(sph).add(target)
    cam.lookAt(target)
    cam.updateMatrixWorld()
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    let behind = false
    for (const [x, z] of pts) {
      v.set(x, 0, z).project(cam)
      if (v.z > 1 || v.z < -1) behind = true
      x0 = Math.min(x0, v.x)
      x1 = Math.max(x1, v.x)
      y0 = Math.min(y0, v.y)
      y1 = Math.max(y1, v.y)
    }
    return { x0, x1, y0, y1, behind }
  }
  const fits = (m: ReturnType<typeof measure>) =>
    !m.behind && m.x1 - m.x0 <= 2 * margins.x && m.y1 - m.y0 <= margins.top + margins.bottom

  let distance = span * 3
  for (let iter = 0; iter < 8; iter++) {
    let lo = span * 0.2
    let hi = span * 200
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2
      if (fits(measure(mid))) hi = mid
      else lo = mid
    }
    distance = hi
    const m = measure(distance)
    const cx = (m.x0 + m.x1) / 2
    const cy = (m.y0 + m.y1) / 2 - want
    if (Math.abs(cx) < 0.002 && Math.abs(cy) < 0.002) break
    // NDC offset -> world offset on the plane at the target's depth (vertical is foreshortened).
    target.addScaledVector(right, cx * halfH * distance * 0.9)
    target.addScaledVector(toward, -(cy * halfV * distance * 0.9) / Math.max(0.2, Math.cos(polar)))
  }
  return { distance, target }
}

export interface Overview {
  target: Vector3
  distance: number
  polar: number
  azimuth: number
}

/** Elevations (degrees above the orbit plane) the overview may use. */
const ELEVATIONS = [30, 35, 40, 45, 50, 55, 60]
/** Views within this factor of the closest one count as equally close. */
const TIE = 1.02

/** Steepest elevation allowed: a slight tilt on wide screens, more top-down on a portrait phone. */
function maxElevation(aspect: number): number {
  const t = Math.min(1, Math.max(0, (1.25 - aspect) / 0.4))
  return 45 + 15 * t
}

/**
 * The whole-system view: long axis along the long side of the screen, and the tilt that shows the
 * bodies biggest. When the width is what limits the zoom (a row of stars, a portrait phone), the
 * view tilts further towards top-down while that costs nothing: orbits and labels get the empty
 * space above and below instead of being squashed into a thin band.
 */
export function overviewFor(points: Point[], fovDeg: number, aspect: number): Overview {
  const azimuth = principalAzimuth(points, aspect)
  const cap = maxElevation(aspect)
  const views = ELEVATIONS.filter((e) => e <= cap).map((elev) => {
    const polar = (90 - elev) * DEG
    return { polar, azimuth, ...fitPoints(points, fovDeg, aspect, polar, azimuth) }
  })
  const closest = Math.min(...views.map((v) => v.distance))
  return views.filter((v) => v.distance <= closest * TIE).at(-1)!
}

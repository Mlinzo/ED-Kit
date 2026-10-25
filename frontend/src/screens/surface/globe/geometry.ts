// Planet globe geometry: game coordinates (latitude / longitude in degrees) on a unit sphere with
// north up (+y). Seen from outside, longitude grows to the right (east), as on a map.

import type { LatLon } from '../../../lib/geo'

const RAD = Math.PI / 180

export type Vec3 = [number, number, number]

/** A surface point on the sphere of radius `r`. lat 0 / lon 0 is +x, lon 90 is -z. */
export function toVector({ lat, lon }: LatLon, r = 1): Vec3 {
  const la = lat * RAD
  const lo = lon * RAD
  return [r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo)]
}

/** Inverse of toVector (any length). */
export function toLatLon([x, y, z]: Vec3): LatLon {
  const len = Math.hypot(x, y, z) || 1
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / len))) / RAD, lon: Math.atan2(-z, x) / RAD }
}

/** Orbit-camera angles (three.js Spherical: phi from +y, theta = atan2(x, z)) looking at a point. */
export function viewAngles(p: LatLon): { phi: number; theta: number } {
  const [x, , z] = toVector(p)
  return { phi: (90 - p.lat) * RAD, theta: Math.atan2(x, z) }
}

/** The unit tangent pointing along `heading` (degrees clockwise from north) at a surface point. */
export function headingVector({ lat, lon }: LatLon, heading: number): Vec3 {
  const la = lat * RAD
  const lo = lon * RAD
  const north: Vec3 = [-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo)]
  const east: Vec3 = [-Math.sin(lo), 0, -Math.cos(lo)]
  const h = heading * RAD
  return [0, 1, 2].map((i) => Math.cos(h) * north[i] + Math.sin(h) * east[i]) as Vec3
}

/** Points along the shorter great-circle arc from a to b at radius r (both ends included). */
export function greatCircle(a: LatLon, b: LatLon, r = 1, maxStepDeg = 1): Vec3[] {
  const p = toVector(a)
  const q = toVector(b)
  const dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))
  const angle = Math.acos(dot)
  const steps = Math.max(2, Math.ceil(angle / (maxStepDeg * RAD)))
  const out: Vec3[] = []
  const s = Math.sin(angle)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Slerp; nearly equal points blend linearly (sin(angle) ~ 0).
    const wa = s < 1e-9 ? 1 - t : Math.sin((1 - t) * angle) / s
    const wb = s < 1e-9 ? t : Math.sin(t * angle) / s
    const v: Vec3 = [wa * p[0] + wb * q[0], wa * p[1] + wb * q[1], wa * p[2] + wb * q[2]]
    const len = Math.hypot(...v) || 1
    out.push([(v[0] / len) * r, (v[1] / len) * r, (v[2] / len) * r])
  }
  return out
}

/** A circle of latitude (or, with `meridian`, a whole meridian through `deg`) at radius r. */
export function gridLine(deg: number, meridian: boolean, r: number, stepDeg = 3): Vec3[] {
  const out: Vec3[] = []
  if (meridian) {
    for (let lat = -90; lat <= 90; lat += stepDeg) out.push(toVector({ lat, lon: deg }, r))
  } else {
    for (let lon = -180; lon <= 180; lon += stepDeg) out.push(toVector({ lat: deg, lon }, r))
  }
  return out
}

export interface ScreenPoint {
  id: string
  x: number
  y: number
}

/** Ids of the points within `radius` px of (x, y), nearest first. */
export function pickNear(points: readonly ScreenPoint[], x: number, y: number, radius: number): string[] {
  return points
    .map((p) => ({ id: p.id, d: Math.hypot(p.x - x, p.y - y) }))
    .filter((p) => p.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map((p) => p.id)
}

/** Whether a unit-sphere point faces a camera at `camera` (outside the sphere): before the horizon. */
export function facesCamera(p: Vec3, camera: Vec3): boolean {
  const d = Math.hypot(...camera)
  return (p[0] * camera[0] + p[1] * camera[1] + p[2] * camera[2]) / d > 1 / d
}

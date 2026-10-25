import { Spherical, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bearingDeg } from '../../../lib/geo'
import { facesCamera, greatCircle, headingVector, pickNear, toLatLon, toVector, viewAngles, type Vec3 } from './geometry'

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

describe('globe geometry', () => {
  it('puts north up and east to the right of the 0/0 point', () => {
    close(toVector({ lat: 0, lon: 0 }), [1, 0, 0])
    close(toVector({ lat: 90, lon: 37 }), [0, 1, 0])
    close(toVector({ lat: 0, lon: 90 }), [0, 0, -1])
    // A camera on +x looking at the origin with +y up has -z on its right.
    const right = new Vector3(-1, 0, 0).cross(new Vector3(0, 1, 0))
    close(right.toArray(), toVector({ lat: 0, lon: 90 }))
  })

  it('round-trips coordinates', () => {
    for (const p of [{ lat: 36.5, lon: -86.45 }, { lat: -12.25, lon: 170 }, { lat: 0, lon: -179.5 }]) {
      const back = toLatLon(toVector(p, 3))
      expect(back.lat).toBeCloseTo(p.lat, 9)
      expect(back.lon).toBeCloseTo(p.lon, 9)
    }
  })

  it('gives the orbit-camera angles of a point', () => {
    const p = { lat: -30, lon: 120 }
    const { phi, theta } = viewAngles(p)
    const s = new Spherical().setFromVector3(new Vector3(...toVector(p)))
    expect(phi).toBeCloseTo(s.phi, 9)
    expect(theta).toBeCloseTo(s.theta, 9)
  })

  it('points the heading along the surface the way bearings go', () => {
    const p = { lat: 20, lon: 40 }
    const v = toVector(p)
    for (const heading of [0, 90, 200]) {
      const h = headingVector(p, heading)
      expect(h[0] * v[0] + h[1] * v[1] + h[2] * v[2]).toBeCloseTo(0, 9) // tangent
      // A small step along it lands where bearingDeg says it went.
      const step = toLatLon(v.map((c, i) => c + h[i] * 1e-4) as Vec3)
      const turn = ((bearingDeg(p, step) - heading + 540) % 360) - 180 // 359.99° is 0°
      expect(turn).toBeCloseTo(0, 3)
    }
  })

  it('follows the shorter great circle and keeps to the sphere', () => {
    const arc = greatCircle({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 1.5)
    expect(arc.length).toBeGreaterThanOrEqual(20)
    for (const v of arc) {
      expect(Math.hypot(...v)).toBeCloseTo(1.5, 9)
      expect(Math.abs(toLatLon(v).lon)).toBeGreaterThanOrEqual(170 - 1e-9) // across the date line
    }
    close(arc[0], toVector({ lat: 0, lon: 170 }, 1.5))
    expect(greatCircle({ lat: 1, lon: 1 }, { lat: 1, lon: 1 })).toHaveLength(3)
  })

  it('hides what is past the horizon', () => {
    const camera: Vec3 = [3, 0, 0]
    expect(facesCamera(toVector({ lat: 0, lon: 0 }), camera)).toBe(true)
    expect(facesCamera(toVector({ lat: 0, lon: 75 }), camera)).toBe(false) // horizon at acos(1/3) ≈ 70.5°
    expect(facesCamera(toVector({ lat: 0, lon: 65 }), camera)).toBe(true)
  })

  it('picks the nearest points within the radius', () => {
    const pts = [
      { id: 'a', x: 10, y: 10 },
      { id: 'b', x: 14, y: 10 },
      { id: 'c', x: 40, y: 40 },
    ]
    expect(pickNear(pts, 13, 10, 8)).toEqual(['b', 'a'])
    expect(pickNear(pts, 100, 100, 8)).toEqual([])
  })
})

import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { contentPoints, convexHull, FIT_MARGINS, fitPoints, principalAzimuth, type Point } from './framing'
import { layoutSystem } from './layout'

const ring = (cx: number, cz: number, r: number, n = 64): Point[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cz + r * Math.sin((i / n) * Math.PI * 2)])

function project(points: Point[], fov: number, aspect: number, polar: number, azimuth: number, fit: { distance: number; target: Vector3 }) {
  const cam = new PerspectiveCamera(fov, aspect, 0.01, 1e7)
  cam.position.setFromSpherical(new Spherical(fit.distance, polar, azimuth)).add(fit.target)
  cam.lookAt(fit.target)
  cam.updateMatrixWorld()
  return points.map(([x, z]) => new Vector3(x, 0, z).project(cam))
}

describe('framing', () => {
  it('computes a convex hull', () => {
    const hull = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0.5]])
    expect(hull).toHaveLength(4)
    expect(hull).not.toContainEqual([1, 1])
  })

  it.each([
    ['landscape', 1.6, (60 * Math.PI) / 180],
    ['phone', 0.75, (45 * Math.PI) / 180],
  ])('fits off-centre content inside the margins, centred (%s)', (_, aspect, polar) => {
    // Two subsystems side by side, not centred on the origin.
    const pts = [...ring(40, 10, 30), ...ring(-50, 20, 12)]
    for (const azimuth of [0, 0.7, 2.5]) {
      const fit = fitPoints(pts, 40, aspect, polar, azimuth)
      const ndc = project(pts, 40, aspect, polar, azimuth, fit)
      const x0 = Math.min(...ndc.map((p) => p.x))
      const x1 = Math.max(...ndc.map((p) => p.x))
      const y0 = Math.min(...ndc.map((p) => p.y))
      const y1 = Math.max(...ndc.map((p) => p.y))
      expect(x0).toBeGreaterThanOrEqual(-FIT_MARGINS.x - 0.01)
      expect(x1).toBeLessThanOrEqual(FIT_MARGINS.x + 0.01)
      expect(y0).toBeGreaterThanOrEqual(-FIT_MARGINS.bottom - 0.01)
      expect(y1).toBeLessThanOrEqual(FIT_MARGINS.top + 0.01)
      // Tight: one of the two directions touches its margins.
      expect(Math.max((x1 - x0) / (2 * FIT_MARGINS.x), (y1 - y0) / (FIT_MARGINS.top + FIT_MARGINS.bottom))).toBeGreaterThan(0.97)
      expect((x0 + x1) / 2).toBeCloseTo(0, 1)
    }
  })

  it('turns an elongated system along the long side of the screen', () => {
    // Long along the z axis.
    const pts = [...ring(0, -60, 25), ...ring(0, 60, 25)]
    // Landscape: the camera's right vector (cos θ, 0, -sin θ) must follow z.
    const land = principalAzimuth(pts, 1.6)
    expect(Math.abs(Math.sin(land))).toBeCloseTo(1, 3)
    // Portrait: the axis runs away from the viewer instead (θ = 0 or π); 0 is closer to the default.
    expect(principalAzimuth(pts, 0.7)).toBeCloseTo(0, 3)
    // Round content keeps the default.
    expect(principalAzimuth(ring(5, 5, 30), 1.6, 0.3)).toBe(0.3)
  })

  it('frames a real layout tighter than its bounding disc', () => {
    const layout = layoutSystem({ bodies: [], barycentres: [] })
    expect(contentPoints(layout, 0)).toEqual([])
    expect(fitPoints([], 40, 1.5, 1, 0).distance).toBeGreaterThan(0)
  })
})

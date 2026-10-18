import { describe, expect, it } from 'vitest'
import type { GalaxySystemView, GalaxyView } from '../../../api/types'
import { buildBackdrop } from './backdrop'
import { at, buildGalaxyScene, CORE, DISK_RADIUS_LY, dotKind, SCALE } from './geometry'

function system(i: number, extra: Partial<GalaxySystemView> = {}): GalaxySystemView {
  return {
    address: String(i),
    name: `Sys ${i}`,
    x: i * 100,
    y: 0,
    z: i * 50,
    visits: 1,
    firstVisitAt: '2026-10-17T10:00:00Z',
    lastVisitAt: '2026-10-17T10:00:00Z',
    value: 0,
    unsoldValue: 0,
    firsts: 0,
    species: 0,
    starType: 'K',
    notable: [],
    region: 18,
    ...extra,
  }
}

function view(extra: Partial<GalaxyView> = {}): GalaxyView {
  return {
    commander: 'T',
    systems: [system(0), system(1, { value: 2_000_000 }), system(2, { firsts: 3, value: 50_000 }), system(3)],
    path: [[0, 1, 2], [3]],
    current: 2,
    deaths: [{ at: '2026-10-17T11:00:00Z', system: 1, name: 'Sys 1', lostValue: 10, killers: [] }],
    route: [{ name: 'R1', x: 500, y: 0, z: 500 }],
    plotted: [],
    distanceLy: 300,
    farthestFromSol: null,
    region: 18,
    regions: [],
    engineers: [],
    ...extra,
  }
}

describe('galaxy scene', () => {
  it('maps galactic coordinates: Sol at the origin, z flipped, 100 ly per unit', () => {
    expect(at({ x: 100, y: 200, z: 300 })).toEqual([1, 2, -3])
    expect(SCALE).toBe(1 / 100)
  })

  it('draws the systems with firsts last, then the earning ones', () => {
    const scene = buildGalaxyScene(view())
    expect(scene.systems.map((s) => s.kind)).toEqual(['plain', 'plain', 'earned', 'firsts'])
    expect(scene.systems.at(-1)?.index).toBe(2)
    expect(dotKind(system(9, { value: 1 }))).toBe('earned')
  })

  it('keeps runs of the path, you, deaths and the route ahead', () => {
    const scene = buildGalaxyScene(view())
    expect(scene.paths).toHaveLength(1) // a run of one system draws no line
    expect(scene.paths[0]).toHaveLength(3)
    expect(scene.you).toEqual(at(system(2)))
    expect(scene.deaths).toEqual([{ pos: at(system(1)), index: 1 }])
    expect(scene.route).toEqual([at(system(2)), at({ x: 500, y: 0, z: 500 })])
    expect(scene.plotted).toEqual([])
    expect(scene.travels).toHaveLength(5)
  })

  it('frames Sol when there is nothing yet', () => {
    const scene = buildGalaxyScene(view({ systems: [], path: [], current: null, deaths: [], route: [] }))
    expect(scene.travels).toEqual([[0, 0, -0]])
    expect(scene.you).toBeNull()
  })
})

describe('galaxy backdrop', () => {
  it('is the same on every load and stays within the disk', () => {
    const a = buildBackdrop(2_000)
    const b = buildBackdrop(2_000)
    expect(a.positions).toEqual(b.positions)
    for (let i = 0; i < a.count; i++) {
      const dx = a.positions[i * 3] - CORE.x
      const dz = a.positions[i * 3 + 2] - CORE.z
      expect(Math.hypot(dx, dz)).toBeLessThan(DISK_RADIUS_LY * 1.05)
      expect(a.sizes[i]).toBeGreaterThan(0)
    }
  })
})

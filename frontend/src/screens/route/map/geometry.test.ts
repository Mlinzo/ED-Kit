import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { RouteRequest, RouteStopView, RouteView } from '../../../api/types'
import {
  buildScene,
  CAMERA_RANGE,
  circle,
  fitView,
  framePoints,
  niceStep,
  overview,
  pickNearest,
  placeLabels,
  SCENE_RADIUS,
  toScene,
  topView,
  type LabelBox,
  type Vec3,
  type View,
} from './geometry'

const PARAMS: RouteRequest = {
  mode: 'riches',
  source: '',
  destination: null,
  radiusLy: 200,
  deviationLy: 25,
  maxSystems: 100,
  bodyTypes: ['elw'],
  minValue: 0,
  minSystemValue: 0,
  bioMinValue: 0,
  bioMinSpeciesValue: 0,
  bioRequireGenuses: false,
  includePopulated: true,
  skipMapped: true,
  refresh: false,
  goal: 'credits',
}

function stop(seq: number, x: number, y: number, z: number, extra: Partial<RouteStopView> = {}): RouteStopView {
  return {
    seq,
    address: String(1000 + seq),
    name: `S${seq}`,
    x,
    y,
    z,
    hopLy: 10,
    jumps: 1,
    population: 0,
    bodies: [],
    value: 1_000_000,
    valueMin: 1_000_000,
    visited: false,
    done: false,
    skipped: false,
    passed: false,
    here: false,
    codexNew: 0,
    neutron: false,
    ...extra,
  }
}

function route(stops: RouteStopView[], extra: Partial<RouteView> = {}): RouteView {
  const next = stops.find((s) => !s.done && !s.skipped && !s.passed) ?? null
  return {
    online: true,
    building: false,
    error: null,
    errorDetail: null,
    params: PARAMS,
    createdAt: '2026-10-17T10:00:00Z',
    dataAt: null,
    truncated: false,
    source: { name: 'Start', x: 0, y: 0, z: 0 },
    destination: null,
    stops,
    nextSeq: next?.seq ?? null,
    currentSystem: null,
    currentPosition: null,
    distanceToNextLy: null,
    jumpsToNext: null,
    jumpRangeLy: null,
    jumpRangeNowLy: null,
    jumpRangeFullLy: null,
    totalValue: 0,
    collectedValue: 0,
    totalLy: 0,
    directLy: null,
    remainingLy: 0,
    doneCount: 0,
    skippedCount: 0,
    neutron: null,
    codexLeft: 0,
    oneJumpFuelT: null,
    ...extra,
  }
}

/** NDC of `p` seen from `view`. */
function project(view: View, p: Vec3, aspect: number): Vector3 {
  const cam = new PerspectiveCamera(40, aspect, 0.01, 1e7)
  const target = new Vector3(...view.target)
  cam.position.setFromSpherical(new Spherical(view.distance, view.polar, view.azimuth)).add(target)
  cam.lookAt(target)
  cam.updateMatrixWorld()
  return new Vector3(...p).project(cam)
}

describe('toScene', () => {
  it('centres, scales and flips galactic z (the core is towards -z)', () => {
    expect(toScene({ x: 12, y: 3, z: 25 }, [10, 1, 20], 2)).toEqual([4, 4, -10])
  })
})

describe('niceStep', () => {
  it('rounds up to 1-2-5 steps', () => {
    expect(niceStep(0.7)).toBe(1)
    expect(niceStep(13.4)).toBe(20)
    expect(niceStep(20)).toBe(20)
    expect(niceStep(40)).toBe(50)
    expect(niceStep(51)).toBe(100)
    expect(niceStep(2400)).toBe(5000)
  })
})

describe('buildScene', () => {
  const stops = [
    stop(1, 10, 0, 0, { done: true, visited: true }),
    stop(2, 20, 0, 0, { skipped: true }),
    stop(3, 30, 5, 0, { value: 9_000_000 }),
    stop(4, 40, -5, 0, { value: 500_000 }),
  ]

  it('gives each stop its state and the dearer stops bigger dots', () => {
    const scene = buildScene(route(stops))
    expect(scene.stops.map((s) => s.state)).toEqual(['done', 'skipped', 'next', 'ahead'])
    const [done, skipped, next, ahead] = scene.stops
    expect(done.size).toBe(skipped.size)
    expect(next.size).toBeGreaterThan(ahead.size)
    expect(ahead.size).toBeGreaterThan(done.size)
  })

  it('shows a stop you went past unfinished as skipped', () => {
    const passed = [stop(1, 10, 0, 0, { passed: true, visited: true }), stop(2, 20, 0, 0, { here: true })]
    expect(buildScene(route(passed)).stops.map((s) => s.state)).toEqual(['skipped', 'next'])
  })

  it('fits the route into the scene radius around its centre', () => {
    const scene = buildScene(route(stops))
    // Box centre of start (0) .. last stop (40) on x, -5 .. 5 on y.
    expect(scene.center).toEqual([20, 0, 0])
    const far = Math.max(...framePoints(scene).map((p) => Math.hypot(...p)))
    expect(far).toBeCloseTo(SCENE_RADIUS, 6)
  })

  it('splits the path at the next stop and leaves skipped stops out of it', () => {
    const scene = buildScene(route(stops))
    const [s1, , s3, s4] = scene.stops.map((s) => s.pos)
    expect(scene.donePath).toEqual([scene.source, s1])
    expect(scene.aheadPath).toEqual([s1, s3, s4])
    expect(scene.tailPath).toEqual([])
    expect(scene.ring?.center).toEqual(scene.source)
    expect(scene.ring?.radius).toBeCloseTo(200 * scene.scale)
    expect(scene.corridor).toBeNull()
  })

  it('has nothing ahead once every stop is done or skipped', () => {
    const scene = buildScene(route([stop(1, 10, 0, 0, { done: true }), stop(2, 20, 0, 0, { skipped: true })]))
    expect(scene.aheadPath).toEqual([])
    expect(scene.donePath).toHaveLength(2)
  })

  it('draws the corridor and the last stretch to the destination in line mode', () => {
    const scene = buildScene(
      route([stop(1, 30, 0, 40), stop(2, 60, 0, 80)], {
        params: { ...PARAMS, mode: 'line', deviationLy: 20 },
        destination: { name: 'End', x: 90, y: 0, z: 120 },
      }),
    )
    expect(scene.corridor?.from).toEqual(scene.source)
    expect(scene.corridor?.to).toEqual(scene.destination)
    expect(scene.corridor?.radius).toBeCloseTo(20 * scene.scale)
    expect(scene.tailPath).toEqual([scene.stops[1].pos, scene.destination])
    expect(scene.ring).toBeNull()
    expect(scene.radiusLy).toBeCloseTo(75) // half of the 150 ly from start to end
    expect(scene.gridLy).toBe(20)
  })

  it('puts the floor under everything framed', () => {
    const scene = buildScene(route(stops, { currentPosition: { name: 'Here', x: 0, y: -15, z: 0 } }))
    expect(scene.youFramed).toBe(true)
    for (const p of [...scene.stops.map((s) => s.pos), scene.you!]) expect(p[1]).toBeGreaterThan(scene.floorY)
  })

  it('draws you nearby, frames you only when close, and reports you when far away', () => {
    const near = buildScene(route(stops, { currentPosition: { name: 'Here', x: 25, y: 0, z: 10 } }))
    expect(near.you).not.toBeNull()
    expect(framePoints(near)).toContainEqual(near.you)

    const aside = buildScene(route(stops, { currentPosition: { name: 'Here', x: 20, y: 0, z: 60 } }))
    expect(aside.you).not.toBeNull()
    expect(framePoints(aside)).not.toContainEqual(aside.you)

    const far = buildScene(route(stops, { currentPosition: { name: 'Sol', x: 20, y: 0, z: 5_000 } }))
    expect(far.you).toBeNull()
    // To the nearest point of the route (stop 2 at x=20), not to its centre.
    expect(far.youFarLy).toBeCloseTo(5_000)
    const farAside = buildScene(route(stops, { currentPosition: { name: 'Sol', x: 1_040, y: 0, z: 0 } }))
    expect(farAside.youFarLy).toBeCloseTo(1_000, 1) // stop 4 at (40, -5, 0)
  })

  it('keeps the floor under the route when you are drawn far below it', () => {
    const scene = buildScene(route(stops, { currentPosition: { name: 'Deep', x: 20, y: -60, z: 0 } }))
    expect(scene.you).not.toBeNull()
    expect(scene.youFramed).toBe(false)
    expect(scene.floorY).toBeGreaterThan(-6 * scene.scale - SCENE_RADIUS * 0.1)
  })
})

describe('framing', () => {
  it('keeps a fitted view within the camera range', () => {
    const one = fitView([[0, 0, 0]], 40, 1.5, 0.9, 0)
    expect(one.distance).toBeGreaterThanOrEqual(CAMERA_RANGE.min)
    expect(one.distance).toBeGreaterThan(SCENE_RADIUS * 0.4)
    const tall = overview(circle(SCENE_RADIUS, 32), 40, 0.25)
    expect(tall.distance).toBeLessThanOrEqual(CAMERA_RANGE.max)
  })

  const line: Vec3[] = [
    [-50, 0, 0],
    [-20, 4, 3],
    [10, -3, -2],
    [50, 0, 0],
  ]

  it('fits every point inside the margins, centred', () => {
    const aspect = 16 / 9
    const view = fitView(line, 40, aspect, 0.9, 0.3)
    const ndc = line.map((p) => project(view, p, aspect))
    for (const v of ndc) {
      expect(Math.abs(v.x)).toBeLessThanOrEqual(0.85)
      expect(v.y).toBeLessThanOrEqual(0.71)
      expect(v.y).toBeGreaterThanOrEqual(-0.79)
    }
    const xs = ndc.map((v) => v.x)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 2)
    // Tight: it could not come much closer.
    const closer = { ...view, distance: view.distance * 0.9 }
    expect(line.some((p) => Math.abs(project(closer, p, aspect).x) > 0.85)).toBe(true)
  })

  it('lays a long route along the wide screen in the overview', () => {
    const aspect = 2
    const view = overview(line, 40, aspect)
    const a = project(view, line[0], aspect)
    const b = project(view, line[3], aspect)
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(Math.abs(a.y - b.y) * 3)
  })

  it('looks straight down with the core up in the top view', () => {
    const aspect = 1.5
    const pts: Vec3[] = [toScene({ x: 0, y: 0, z: 0 }, [0, 0, 0], 1), toScene({ x: 0, y: 0, z: 40 }, [0, 0, 0], 1)]
    const view = topView(pts, 40, aspect)
    const sol = project(view, pts[0], aspect)
    const coreward = project(view, pts[1], aspect)
    expect(coreward.y).toBeGreaterThan(sol.y)
    expect(coreward.x).toBeCloseTo(sol.x, 3)
    const east = project(view, toScene({ x: 30, y: 0, z: 0 }, [0, 0, 0], 1), aspect)
    expect(east.x).toBeGreaterThan(sol.x)
  })
})

describe('pickNearest', () => {
  it('picks the dot under the pointer, the one drawn on top of overlapping dots', () => {
    const dots = [
      { x: 100, y: 100, radius: 6 },
      { x: 103, y: 100, radius: 6 },
      null,
      { x: 200, y: 100, radius: 4 },
    ]
    expect(pickNearest(dots, 101, 100)).toBe(1) // drawn after dot 0
    expect(pickNearest(dots, 207, 100)).toBe(3) // within radius + slop
    expect(pickNearest(dots, 150, 100)).toBe(-1)
  })

  it('prefers the closer dot when the pointer is between two', () => {
    const dots = [
      { x: 100, y: 100, radius: 4 },
      { x: 112, y: 100, radius: 4 },
    ]
    expect(pickNearest(dots, 109, 100)).toBe(1)
    expect(pickNearest(dots, 105, 100)).toBe(0)
  })
})

describe('circle', () => {
  it('is closed and lies in the horizontal plane', () => {
    const c = circle(3, 8)
    expect(c).toHaveLength(9)
    expect(c[0][0]).toBeCloseTo(c[8][0])
    expect(c[0][2]).toBeCloseTo(c[8][2])
    for (const p of c) {
      expect(p[1]).toBe(0)
      expect(Math.hypot(p[0], p[2])).toBeCloseTo(3)
    }
  })
})

describe('placeLabels', () => {
  const box = (x: number, y: number, extra: Partial<LabelBox> = {}): LabelBox => ({
    x,
    y,
    w: 100,
    h: 20,
    lift: 8,
    always: false,
    visible: true,
    ...extra,
  })

  it('puts a label above its point, centred', () => {
    expect(placeLabels([box(300, 300)], 800, 600)).toEqual([[-50, -28]])
  })

  it('moves a label that would overlap one placed before, and hides it when nothing fits', () => {
    const [first, second] = placeLabels([box(300, 300), box(305, 302)], 800, 600)
    expect(first).toEqual([-50, -28])
    expect(second).toEqual([-50, 8]) // below
    const crowded = placeLabels([box(300, 300), box(300, 300), box(300, 300), box(300, 300), box(300, 300), box(300, 300)], 800, 600)
    expect(crowded.slice(4)).toEqual([null, null])
  })

  it('keeps a hover card beside its point, wherever the point is up or down', () => {
    const card = (x: number, y: number) => box(x, y, { w: 256, h: 150, lift: 10, always: true, beside: true })
    // A crowd of points from the top edge to the bottom one: always on the right, slid inside.
    for (const y of [5, 40, 90, 160, 300, 520, 595]) {
      const [at] = placeLabels([card(300, y)], 800, 600)
      expect(at![0]).toBe(10)
      expect(y + at![1]).toBeGreaterThanOrEqual(3)
      expect(y + at![1] + 150).toBeLessThanOrEqual(597)
    }
    // No room on the right: on the left.
    expect(placeLabels([card(700, 300)], 800, 600)[0]![0]).toBe(-266)
  })

  it('always shows the hovered or selected label, even overlapping', () => {
    const at = placeLabels([box(300, 300), box(300, 300), box(300, 300), box(300, 300), box(300, 300, { always: true })], 800, 600)
    expect(at[4]).not.toBeNull()
  })

  it('slides a label back inside near the edge, or takes another side', () => {
    const [nudged] = placeLabels([box(30, 300)], 800, 600)
    expect(nudged).toEqual([-27, -28]) // 3 px from the left edge
    const [side] = placeLabels([box(300, 10)], 800, 600)
    expect(side).toEqual([-50, 8]) // no room above
  })

  it('keeps a big always-shown card inside the map in a corner', () => {
    const card = box(30, 25, { w: 256, h: 130, lift: 15, always: true })
    const [at] = placeLabels([card], 1100, 700)
    expect(at).not.toBeNull()
    const [dx, dy] = at!
    expect(30 + dx).toBeGreaterThanOrEqual(0)
    expect(25 + dy).toBeGreaterThanOrEqual(0)
    expect(30 + dx + 256).toBeLessThanOrEqual(1100)
    expect(25 + dy + 130).toBeLessThanOrEqual(700)
  })

  it('hides labels whose point is out of view', () => {
    expect(placeLabels([box(300, 300, { visible: false, always: true })], 800, 600)).toEqual([null])
  })
})

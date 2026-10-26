import { describe, expect, it } from 'vitest'
import type { BarycentreView, BodyView, OrbitView, ParentRef } from '../api/types'
import {
  fallbackAngle,
  keplerAngle,
  layoutSystem,
  localPosition,
  toKepler,
  worldPositions,
  type MapNode,
  type SystemLayout,
} from './layout'

const EPOCH = '2026-10-16T00:00:00Z'
const EPOCH_MS = Date.parse(EPOCH)
const DAY = 86_400

const star = (id: number): ParentRef => ({ kind: 'Star', bodyId: id })
const planet = (id: number): ParentRef => ({ kind: 'Planet', bodyId: id })
const bary = (id: number): ParentRef => ({ kind: 'Null', bodyId: id })
const ring = (id: number): ParentRef => ({ kind: 'Ring', bodyId: id })

function orbit(smaM: number, periodS: number, meanAnomalyDeg = 0, extra: Partial<OrbitView> = {}): OrbitView {
  return {
    epoch: EPOCH,
    semiMajorAxisM: smaM,
    eccentricity: 0,
    inclinationDeg: 0,
    periapsisDeg: 0,
    ascendingNodeDeg: 0,
    meanAnomalyDeg,
    periodS,
    ...extra,
  }
}

interface BodyOpts {
  kind?: 'star' | 'planet'
  parents?: ParentRef[]
  orbit?: OrbitView | null
  radiusKm?: number
  distanceLs?: number | null
  rings?: boolean
  interest?: BodyView['interest']
  stellarMass?: number
  massEm?: number
}

function body(bodyId: number, o: BodyOpts = {}): BodyView {
  const kind = o.kind ?? 'planet'
  const radiusKm = o.radiusKm ?? (kind === 'star' ? 600_000 : 3_000)
  return {
    id64: String(bodyId),
    bodyId,
    name: `Test ${bodyId}`,
    shortName: String(bodyId),
    kind,
    source: 'journal',
    sourceAt: null,
    sourceUrl: null,
    signalsSource: null,
    genusesSource: null,
    subtype: kind === 'star' ? 'K (Yellow-Orange) star' : 'Rocky body',
    parentId: null,
    distanceLs: o.distanceLs === undefined ? bodyId * 100 : o.distanceLs,
    landable: false,
    terraformable: false,
    atmosphere: null,
    gravityG: null,
    temperatureK: null,
    radiusKm,
    wasDiscovered: null,
    wasMapped: null,
    wasFootfalled: null,
    mappedByMe: false,
    footfallByMe: false,
    footfallClaimable: false,
    footfallTaken: null,
    signals: { bio: 0, geo: 0, human: 0, mining: 0, other: 0 },
    genuses: [],
    species: [],
    fssValue: 0,
    dssValue: 0,
    worthMapping: false,
    bioValueMin: 0,
    bioValueMax: 0,
    totalValue: 0,
    bioDone: 0,
    codexNew: 0,
    codexMaybe: 0,
    interest: o.interest ?? 'low',
    reasons: [],
    done: false,
    parents: o.parents ?? [],
    orbit: o.orbit ?? null,
    materials: [],
    visual: {
      planetClass: kind === 'planet' ? 'Rocky body' : null,
      starType: kind === 'star' ? 'K' : null,
      starSubclass: null,
      luminosity: null,
      atmosphereType: '',
      terraformState: '',
      volcanism: null,
      temperatureK: null,
      surfacePressureAtm: null,
      atmosphereComposition: {},
      massEm: o.massEm ?? null,
      radiusM: radiusKm * 1_000,
      stellarMass: o.stellarMass ?? null,
      axialTiltRad: null,
      rotationPeriodS: null,
      tidalLock: null,
      composition: {},
      rings: o.rings ? [{ name: 'A Ring', ringClass: 'eRingClass_Icy', innerM: radiusKm * 1_400, outerM: radiusKm * 2_600 }] : [],
    },
    bookmark: null,
    places: [],
  }
}

const bc = (bodyId: number, parents: ParentRef[] = [], o: OrbitView | null = null): BarycentreView => ({
  bodyId,
  parents,
  orbit: o,
})

const node = (layout: SystemLayout, id: number): MapNode => {
  const n = layout.nodes.get(id)
  if (!n) throw new Error(`no node ${id}`)
  return n
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const EPS = 1e-6
const TIMES = [EPOCH_MS, EPOCH_MS + 0.37 * DAY * 1_000, EPOCH_MS + 41 * DAY * 1_000, EPOCH_MS + 3_000 * DAY * 1_000]

/**
 * What breaks the layout invariants, collected in plain code and asserted once by `check`: an
 * `expect` per pair made a 120-body system take ~0.2 s and the CI runner timed the test out.
 * The comparisons are written so that NaN counts as broken, as `expect` would have it.
 */
type Broken = string[]
const atLeast = (bad: Broken, what: string, value: number, min: number) => {
  if (!(value >= min)) bad.push(`${what}: ${value} < ${min}`)
}
const atMost = (bad: Broken, what: string, value: number, max: number) => {
  if (!(value <= max)) bad.push(`${what}: ${value} > ${max}`)
}

/** The invariants every layout must satisfy, at several moments in time. */
function overlaps(layout: SystemLayout, bad: Broken) {
  for (const t of TIMES) {
    const pos = worldPositions(layout, t)
    for (const n of layout.nodes.values()) {
      const p = pos.get(n.id)!
      // Siblings' discs never intersect.
      for (let i = 0; i < n.children.length; i++) {
        for (let j = i + 1; j < n.children.length; j++) {
          const a = n.children[i]
          const b = n.children[j]
          atLeast(bad, `siblings ${a.id}, ${b.id} at ${t}`, dist(pos.get(a.id)!, pos.get(b.id)!), a.extent + b.extent - EPS)
          // Orbiting siblings sit on disjoint annuli: true at any angle, not just now.
          if (a.role === 'orbit' && b.role === 'orbit') {
            atLeast(bad, `annuli ${a.id}, ${b.id}`, Math.abs(a.orbitRadius - b.orbitRadius), a.extent + b.extent - EPS)
          }
        }
        // A child's disc stays inside its parent's disc and clear of the parent's body.
        const c = n.children[i]
        const d = dist(p, pos.get(c.id)!)
        atMost(bad, `${c.id} inside ${n.id} at ${t}`, d + c.extent, n.extent + EPS)
        if (n.size > 0) atLeast(bad, `${c.id} clear of ${n.id} at ${t}`, d - c.extent, n.clearance - EPS)
      }
    }
    // Roots side by side.
    for (let i = 0; i < layout.roots.length; i++) {
      for (let j = i + 1; j < layout.roots.length; j++) {
        const a = layout.roots[i]
        const b = layout.roots[j]
        atLeast(bad, `roots ${a.id}, ${b.id} at ${t}`, dist(pos.get(a.id)!, pos.get(b.id)!), a.extent + b.extent - EPS)
      }
    }
    // Every body sphere is inside the layout radius.
    for (const n of layout.nodes.values()) {
      const [x, z] = pos.get(n.id)!
      atMost(bad, `${n.id} inside the radius at ${t}`, Math.hypot(x, z) + n.size, layout.radius + EPS)
    }
  }
}

/** All body spheres pairwise disjoint (follows from the disc invariants; checked directly too). */
function bodiesTouching(layout: SystemLayout, bad: Broken) {
  for (const t of TIMES) {
    const pos = worldPositions(layout, t)
    const list = [...layout.nodes.values()].filter((n) => n.size > 0)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const d = dist(pos.get(a.id)!, pos.get(b.id)!)
        if (!(d > a.size + b.size)) bad.push(`bodies ${a.id}, ${b.id} at ${t}: ${d} <= ${a.size + b.size}`)
      }
    }
  }
}

function check(layout: SystemLayout) {
  const bad: Broken = []
  overlaps(layout, bad)
  bodiesTouching(layout, bad)
  expect(bad.slice(0, 10)).toEqual([])
}

describe('layoutSystem', () => {
  it('handles no bodies', () => {
    const layout = layoutSystem({ bodies: [], barycentres: [] })
    expect(layout.roots).toEqual([])
    expect(layout.nodes.size).toBe(0)
    expect(layout.radius).toBe(0)
  })

  it('lays out a single star with planets in distance order', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(3, { parents: [star(0)], orbit: orbit(9e11, 400 * DAY) }),
        body(1, { parents: [star(0)], orbit: orbit(1e11, 50 * DAY) }),
        body(2, { parents: [star(0)], orbit: orbit(3e11, 120 * DAY), radiusKm: 60_000 }),
      ],
      barycentres: [],
    })
    expect(layout.roots.map((r) => r.id)).toEqual([0])
    const root = node(layout, 0)
    expect(root.kind).toBe('star')
    expect(root.children.map((c) => c.id)).toEqual([1, 2, 3])
    expect(root.children.every((c) => c.role === 'orbit')).toBe(true)
    const radii = root.children.map((c) => c.orbitRadius)
    expect([...radii].sort((a, b) => a - b)).toEqual(radii)
    // Stars are the biggest bodies; a gas giant is bigger than a rock.
    expect(root.size).toBeGreaterThan(node(layout, 2).size)
    expect(node(layout, 2).size).toBeGreaterThan(node(layout, 1).size)
    check(layout)
  })

  it('places binary stars on opposite sides of their barycentre', () => {
    const p = 5 * 365 * DAY
    const layout = layoutSystem({
      bodies: [
        body(1, { kind: 'star', parents: [bary(0)], orbit: orbit(1e11, p, 30), stellarMass: 1.2, distanceLs: 0 }),
        body(2, {
          kind: 'star',
          parents: [bary(0)],
          orbit: orbit(4e11, p, 30, { periapsisDeg: 180 }),
          stellarMass: 0.3,
          radiusKm: 250_000,
          distanceLs: 1_700,
        }),
        body(3, { parents: [star(1), bary(0)], orbit: orbit(5e10, 30 * DAY) }),
        body(4, { parents: [star(1), bary(0)], orbit: orbit(9e10, 70 * DAY), rings: true, radiusKm: 50_000 }),
        body(5, { parents: [star(2), bary(0)], orbit: orbit(2e10, 10 * DAY) }),
      ],
      barycentres: [bc(0)],
    })
    const root = node(layout, 0)
    expect(root.kind).toBe('barycentre')
    expect(layout.roots).toEqual([root])
    const a = node(layout, 1)
    const b = node(layout, 2)
    expect(a.role).toBe('component')
    expect(b.role).toBe('component')
    // The heavier star is closer to the barycentre (real orbit sizes).
    expect(a.orbitRadius).toBeLessThan(b.orbitRadius)
    expect(a.orbitRadius + b.orbitRadius).toBeGreaterThanOrEqual(a.extent + b.extent)
    for (const t of TIMES) {
      const pa = localPosition(a, t)
      const pb = localPosition(b, t)
      // Opposite: the barycentre lies on the segment between the stars.
      expect(pa[0] * pb[1] - pa[1] * pb[0]).toBeCloseTo(0, 6)
      expect(pa[0] * pb[0] + pa[1] * pb[1]).toBeLessThanOrEqual(0)
    }
    // The leader keeps its real angle.
    expect(Math.atan2(-localPosition(a, EPOCH_MS)[1], localPosition(a, EPOCH_MS)[0])).toBeCloseTo((30 * Math.PI) / 180, 6)
    check(layout)
  })

  it('handles a trinary with nested barycentres: A + (B + C)', () => {
    const outer = 40 * 365 * DAY
    const inner = 2 * 365 * DAY
    const layout = layoutSystem({
      bodies: [
        body(1, { kind: 'star', parents: [bary(0)], orbit: orbit(2e12, outer), distanceLs: 0 }),
        body(4, { kind: 'star', parents: [bary(3), bary(0)], orbit: orbit(1e11, inner), distanceLs: 9_000 }),
        body(5, { kind: 'star', parents: [bary(3), bary(0)], orbit: orbit(1.5e11, inner, 0, { periapsisDeg: 180 }), distanceLs: 9_100 }),
        body(6, { parents: [star(1), bary(0)], orbit: orbit(3e10, 20 * DAY) }),
        body(7, { parents: [star(5), bary(3), bary(0)], orbit: orbit(1e10, 5 * DAY) }),
        body(8, { parents: [bary(3), bary(0)], orbit: orbit(1e12, 30 * 365 * DAY), distanceLs: 9_500 }),
      ],
      barycentres: [bc(0), bc(3, [bary(0)], orbit(3e12, outer, 0, { periapsisDeg: 180 }))],
    })
    const top = node(layout, 0)
    const sub = node(layout, 3)
    expect(sub.parent).toBe(top)
    expect(sub.kind).toBe('barycentre')
    expect(new Set(top.children.map((c) => c.id))).toEqual(new Set([1, 3]))
    expect(node(layout, 1).role).toBe('component')
    expect(sub.role).toBe('component')
    expect(node(layout, 4).role).toBe('component')
    expect(node(layout, 5).role).toBe('component')
    // Planet 8 orbits B+C outside both stars' systems (circumbinary at the inner barycentre).
    const p8 = node(layout, 8)
    expect(p8.role).toBe('orbit')
    for (const s of [node(layout, 4), node(layout, 5)]) {
      expect(p8.orbitRadius - p8.extent).toBeGreaterThanOrEqual(s.orbitRadius + s.extent - EPS)
    }
    check(layout)
  })

  it('handles a planet–planet binary under a star (Null under Star)', () => {
    const p = 30 * DAY
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(1, { parents: [star(0)], orbit: orbit(5e10, 40 * DAY), distanceLs: 160 }),
        body(3, { parents: [bary(2), star(0)], orbit: orbit(1.3e8, p, 190), radiusKm: 70_000, distanceLs: 1_050 }),
        body(5, { parents: [bary(2), star(0)], orbit: orbit(1.4e10, p, 190, { periapsisDeg: 180 }), radiusKm: 11_000, distanceLs: 1_100 }),
        // A moon pair around planet 3: barycentre 4 under Planet 3.
        body(6, { parents: [bary(4), planet(3), bary(2), star(0)], orbit: orbit(2e6, 0.8 * DAY, 200), distanceLs: 1_053 }),
        body(7, { parents: [bary(4), planet(3), bary(2), star(0)], orbit: orbit(3.8e6, 0.8 * DAY, 200, { periapsisDeg: 180 }), distanceLs: 1_053 }),
        body(8, { parents: [star(0)], orbit: orbit(8e11, 900 * DAY), distanceLs: 2_700 }),
      ],
      barycentres: [
        bc(2, [star(0)], orbit(3.1e11, 2_300 * DAY)),
        bc(4, [planet(3), bary(2), star(0)], orbit(8.7e8, 4.7 * DAY)),
      ],
    })
    const pair = node(layout, 2)
    expect(pair.parent?.id).toBe(0)
    expect(pair.role).toBe('orbit')
    expect(node(layout, 0).children.map((c) => c.id)).toEqual([1, 2, 8])
    expect(node(layout, 3).role).toBe('component')
    expect(node(layout, 5).role).toBe('component')
    const moons = node(layout, 4)
    expect(moons.parent?.id).toBe(3)
    expect(moons.role).toBe('orbit')
    expect(node(layout, 6).role).toBe('component')
    // Moons are smaller than the planet they orbit, even through barycentres.
    expect(node(layout, 6).size).toBeLessThan(node(layout, 3).size)
    expect(node(layout, 7).size).toBeLessThan(node(layout, 3).size)
    // A close moon pair still keeps clear space between the surfaces.
    const [m6, m7] = [node(layout, 6), node(layout, 7)]
    expect(m6.orbitRadius + m7.orbitRadius - m6.size - m7.size).toBeGreaterThanOrEqual(1.5 * Math.max(m6.size, m7.size))
    check(layout)
  })

  it('puts circumbinary planets outside both star systems', () => {
    const p = 3 * 365 * DAY
    const layout = layoutSystem({
      bodies: [
        body(1, { kind: 'star', parents: [bary(0)], orbit: orbit(2e11, p), distanceLs: 0 }),
        body(2, { kind: 'star', parents: [bary(0)], orbit: orbit(2.4e11, p, 0, { periapsisDeg: 180 }), distanceLs: 1_400 }),
        body(3, { parents: [star(1), bary(0)], orbit: orbit(2e10, 9 * DAY) }),
        body(4, { parents: [star(2), bary(0)], orbit: orbit(3e10, 15 * DAY) }),
        body(9, { parents: [bary(0)], orbit: orbit(2e12, 40 * 365 * DAY), radiusKm: 40_000 }),
      ],
      barycentres: [bc(0)],
    })
    const cb = node(layout, 9)
    expect(cb.parent?.id).toBe(0)
    expect(cb.role).toBe('orbit')
    for (const s of [node(layout, 1), node(layout, 2)]) {
      expect(s.role).toBe('component')
      expect(cb.orbitRadius - cb.extent).toBeGreaterThan(s.orbitRadius + s.extent)
    }
    check(layout)
  })

  it('nests moons of moons with decreasing sizes', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(1, { parents: [star(0)], orbit: orbit(1e11, 100 * DAY), radiusKm: 60_000, rings: true }),
        body(2, { parents: [planet(1), star(0)], orbit: orbit(5e8, 3 * DAY), radiusKm: 2_000 }),
        body(3, { parents: [planet(1), star(0)], orbit: orbit(9e8, 7 * DAY), radiusKm: 2_500 }),
        body(4, { parents: [planet(3), planet(1), star(0)], orbit: orbit(1e7, 0.5 * DAY), radiusKm: 2_400 }),
      ],
      barycentres: [],
    })
    const gg = node(layout, 1)
    const moon = node(layout, 3)
    const sub = node(layout, 4)
    expect(sub.parent).toBe(moon)
    expect(moon.parent).toBe(gg)
    expect(gg.children.map((c) => c.id)).toEqual([2, 3])
    expect(moon.size).toBeLessThan(gg.size)
    expect(sub.size).toBeLessThan(moon.size)
    expect(sub.depth).toBe(3)
    // Rings widen the free zone around the giant.
    expect(gg.clearance).toBeGreaterThan(gg.size * 1.5)
    check(layout)
  })

  it('turns an unscanned parent into a placeholder', () => {
    const layout = layoutSystem({
      bodies: [
        body(1, { kind: 'star', parents: [bary(0)], orbit: orbit(1e11, 1_000 * DAY), distanceLs: 0 }),
        body(2, { kind: 'star', parents: [bary(0)], orbit: orbit(1e11, 1_000 * DAY, 0, { periapsisDeg: 180 }), distanceLs: 700 }),
        body(9, { parents: [star(5), bary(0)], orbit: orbit(3e10, 20 * DAY), distanceLs: 40_000 }),
      ],
      barycentres: [bc(0)],
    })
    const ph = node(layout, 5)
    expect(ph.kind).toBe('placeholder')
    expect(ph.refKind).toBe('Star')
    expect(ph.body).toBeNull()
    expect(ph.parent?.id).toBe(0)
    expect(ph.size).toBeGreaterThan(0)
    expect(node(layout, 9).parent).toBe(ph)
    // Far away (distance estimated from its planet): outside the binary.
    expect(ph.role).toBe('orbit')
    check(layout)
  })

  it('treats an unlisted Null parent as a barycentre, not a placeholder', () => {
    const layout = layoutSystem({
      bodies: [
        body(1, { kind: 'star', parents: [bary(0)], distanceLs: 0 }),
        body(2, { kind: 'star', parents: [bary(0)], distanceLs: 500 }),
      ],
      barycentres: [],
    })
    expect(node(layout, 0).kind).toBe('barycentre')
    expect(node(layout, 1).role).toBe('component')
    expect(node(layout, 2).role).toBe('component')
    check(layout)
  })

  it('skips Ring parents (belt clusters attach to the next parent)', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(2, { parents: [ring(1), star(0)], orbit: orbit(4e11, 300 * DAY) }),
        body(3, { parents: [star(0)], orbit: orbit(1e11, 50 * DAY) }),
      ],
      barycentres: [],
    })
    expect(layout.nodes.has(1)).toBe(false)
    expect(node(layout, 2).parent?.id).toBe(0)
    expect(node(layout, 0).children.map((c) => c.id)).toEqual([3, 2])
    check(layout)
  })

  it('copes with missing orbit data: deterministic angles, distance order', () => {
    const system = {
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(5, { parents: [star(0)], distanceLs: 900 }),
        body(4, { parents: [star(0)], distanceLs: 100 }),
        body(6, { parents: [star(0)], distanceLs: null }),
        body(7, { parents: [planet(5), star(0)], distanceLs: 901 }),
        body(8, { parents: [planet(5), star(0)], distanceLs: 900.5 }),
        body(1, { kind: 'star', parents: [bary(9)], distanceLs: null }),
        body(2, { kind: 'star', parents: [bary(9)], distanceLs: null }),
      ],
      barycentres: [],
    }
    const a = layoutSystem(system)
    const b = layoutSystem(system)
    expect(node(a, 0).children.map((c) => c.id)).toEqual([4, 5, 6])
    expect(node(a, 5).children.map((c) => c.id)).toEqual([8, 7])
    expect(node(a, 4).phase).toEqual({ kind: 'fixed', angle: fallbackAngle(4) })
    expect(localPosition(node(a, 6), EPOCH_MS)).toEqual(localPosition(node(b, 6), EPOCH_MS + 9e9))
    // Two roots (star 0 and barycentre 9) side by side.
    expect(a.roots.length).toBe(2)
    expect(a.roots[0].id).toBe(0)
    check(a)
  })

  it('falls back to parentId for bodies without a parent chain', () => {
    const b2 = body(2, { distanceLs: 10 })
    b2.parentId = 1
    const layout = layoutSystem({
      bodies: [body(1, { kind: 'star', distanceLs: 0 }), b2],
      barycentres: [],
    })
    expect(node(layout, 2).parent?.id).toBe(1)
    expect(layout.roots.length).toBe(1)
  })

  it('survives cyclic parent data', () => {
    const layout = layoutSystem({
      bodies: [body(1, { parents: [planet(2)] }), body(2, { parents: [planet(1)] })],
      barycentres: [],
    })
    expect(layout.roots.length).toBe(1)
    expect(layout.nodes.size).toBe(2)
    check(layout)
  })

  it('handles a lone barycentre component (partner unscanned) and a lone root body', () => {
    const p = 600 * DAY
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(3, { parents: [bary(2), bary(1), star(0)], orbit: orbit(3.7e9, p, 70), radiusKm: 56_000, distanceLs: 1_400 }),
        body(4, { parents: [bary(2), bary(1), star(0)], orbit: orbit(4.2e9, p, 70, { periapsisDeg: 180 }), radiusKm: 53_000, distanceLs: 1_390 }),
      ],
      barycentres: [bc(1, [star(0)], orbit(4.2e11, 3_500 * DAY)), bc(2, [bary(1), star(0)], orbit(6e8, p))],
    })
    const b1 = node(layout, 1)
    expect(b1.children.map((c) => c.id)).toEqual([2])
    expect(node(layout, 2).orbitRadius).toBe(0)
    // Equal masses: nearly equal shares of the separation.
    expect(node(layout, 3).orbitRadius / node(layout, 4).orbitRadius).toBeCloseTo(3.7 / 4.2, 6)
    check(layout)
  })

  it('marks subtree interest so orbits leading to interesting moons stay visible', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(1, { parents: [star(0)], orbit: orbit(1e11, 100 * DAY), interest: 'low' }),
        body(2, { parents: [planet(1), star(0)], orbit: orbit(1e8, 2 * DAY), interest: 'high' }),
      ],
      barycentres: [],
    })
    expect(node(layout, 1).interest).toBe('low')
    expect(node(layout, 1).subtreeInterest).toBe('high')
  })
})

describe('kepler phase', () => {
  it('starts at the epoch angle and advances with the period', () => {
    const o = toKepler(orbit(1e9, DAY, 30, { ascendingNodeDeg: 10, periapsisDeg: 20 }))!
    expect(keplerAngle(o, EPOCH_MS)).toBeCloseTo((60 * Math.PI) / 180, 9)
    expect(keplerAngle(o, EPOCH_MS + DAY * 1_000)).toBeCloseTo((60 * Math.PI) / 180, 6)
    expect(keplerAngle(o, EPOCH_MS + DAY * 500)).toBeCloseTo((240 * Math.PI) / 180, 6)
  })

  it('solves eccentric orbits (true anomaly runs ahead of mean anomaly after periapsis)', () => {
    const o = toKepler(orbit(1e9, DAY, 45, { eccentricity: 0.5 }))!
    const nu = keplerAngle(o, EPOCH_MS)
    expect(nu).toBeGreaterThan((45 * Math.PI) / 180)
    expect(nu).toBeLessThan(Math.PI)
  })

  it('stays put without a period or epoch', () => {
    const o = toKepler(orbit(1e9, DAY, 90, { epoch: null }))!
    expect(o.periodS).toBeNull()
    expect(keplerAngle(o, 0)).toBeCloseTo(keplerAngle(o, 1e12), 9)
    expect(toKepler(null)).toBeNull()
    expect(toKepler(orbit(1e9, DAY, 0, { meanAnomalyDeg: null }))).toBeNull()
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Adversarial inputs                                                                         */
/* ------------------------------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface GenOpts {
  bodies: number
  /** Share of bodies (and barycentres) with orbit data. */
  orbitShare: number
  /** Share of generated bodies removed from the payload (their children keep referencing them). */
  dropShare: number
  /** Share of barycentres left out of `barycentres`. */
  hideBaryShare: number
}

/**
 * ED-like random system: a star or a multiple-star barycentre at the root, planets, moons of
 * moons, planet–planet and star–star pairs (shared periods), trinaries, Ring parents.
 */
function randomSystem(seed: number, o: GenOpts): { bodies: BodyView[]; barycentres: BarycentreView[] } {
  const rand = mulberry32(seed)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
  type Host = { id: number; kind: 'star' | 'planet' | 'bary'; chain: ParentRef[]; depth: number; distLs: number }
  const ref = (h: Host): ParentRef => ({ kind: h.kind === 'bary' ? 'Null' : h.kind === 'star' ? 'Star' : 'Planet', bodyId: h.id })
  const bodies: BodyView[] = []
  const barys: BarycentreView[] = []
  const hosts: Host[] = []
  let next = 0
  const maybeOrbit = (sma: number, period: number): OrbitView | null =>
    rand() < o.orbitShare ? orbit(sma, period, rand() * 360, { eccentricity: rand() * 0.6, periapsisDeg: rand() * 360 }) : null

  const addBody = (kind: 'star' | 'planet', parent: Host | null, period: number, sma: number): Host => {
    const id = next++
    const chain = parent ? [ref(parent), ...parent.chain] : []
    const distLs = parent ? parent.distLs + sma / 3e8 : 0
    const big = rand() < 0.3
    bodies.push(
      body(id, {
        kind,
        parents: rand() < 0.05 && parent ? [ring(900 + id), ...chain] : chain,
        orbit: parent ? maybeOrbit(sma, period) : null,
        radiusKm: kind === 'star' ? 100_000 + rand() * 900_000 : big ? 30_000 + rand() * 50_000 : 500 + rand() * 6_000,
        distanceLs: rand() < 0.9 ? distLs : null,
        rings: kind === 'planet' && big && rand() < 0.4,
        interest: pick(['low', 'low', 'medium', 'high'] as const),
        stellarMass: kind === 'star' ? 0.1 + rand() * 2 : undefined,
        massEm: kind === 'planet' ? 0.01 + rand() * 300 : undefined,
      }),
    )
    const h: Host = { id, kind, chain, depth: parent ? parent.depth + 1 : 0, distLs }
    hosts.push(h)
    return h
  }
  const addBary = (parent: Host | null, period: number, sma: number): Host => {
    const id = next++
    const chain = parent ? [ref(parent), ...parent.chain] : []
    barys.push(bc(id, chain, parent && rand() < o.orbitShare ? orbit(sma, period, rand() * 360) : null))
    return { id, kind: 'bary', chain, depth: parent ? parent.depth + 1 : 0, distLs: parent?.distLs ?? 0 }
  }
  /** k components sharing one period around a new barycentre (sometimes a nested pair). */
  const addGroup = (parent: Host | null, kind: 'star' | 'planet', k: number, sma: number, period: number): Host => {
    const b = addBary(parent, period * 3, sma)
    const pair = 1e3 + rand() * 1e5
    for (let i = 0; i < k; i++) {
      if (kind === 'star' && i === k - 1 && k === 2 && rand() < 0.3) hosts.push(addGroup(b, 'star', 2, sma * 0.01, pair * 0.1))
      else addBody(kind, b, pair * DAY, sma * (0.2 + rand()))
    }
    return b
  }

  const root = rand() < 0.5 ? addBody('star', null, 0, 0) : addGroup(null, 'star', 2 + Math.floor(rand() * 3), 1e12, 1e4)
  if (root.kind === 'bary') hosts.push(root)
  while (bodies.length < o.bodies) {
    const parent = pick(hosts.filter((h) => h.depth < 7))
    const sma = (parent.kind === 'planet' ? 1e7 : 1e10) * (1 + rand() * 300)
    const period = 1 + rand() * 1_000
    const r = rand()
    if (r < 0.1) hosts.push(addGroup(parent, 'planet', 2, sma, period))
    else if (r < 0.14 && parent.kind !== 'planet') hosts.push(addGroup(parent, 'star', 2 + Math.floor(rand() * 2), sma, period))
    else addBody(parent.kind === 'planet' || rand() < 0.95 ? 'planet' : 'star', parent, period * DAY, sma)
  }
  return {
    bodies: bodies.filter(() => rand() >= o.dropShare),
    barycentres: barys.filter(() => rand() >= o.hideBaryShare),
  }
}

describe('layoutSystem — adversarial', () => {
  it('handles deep nesting: barycentres four levels deep and moons six levels deep', () => {
    const p = [4_000, 900, 200, 40].map((d) => d * DAY)
    const b4 = [bary(6), bary(4), bary(2), bary(0)]
    const layout = layoutSystem({
      bodies: [
        body(1, { kind: 'star', parents: [bary(0)], orbit: orbit(1e12, p[0]), distanceLs: 0 }),
        body(3, { kind: 'star', parents: [bary(2), bary(0)], orbit: orbit(2e11, p[1]), distanceLs: 5_000 }),
        body(5, { kind: 'star', parents: [bary(4), bary(2), bary(0)], orbit: orbit(5e10, p[2]), distanceLs: 5_500 }),
        body(7, { kind: 'star', parents: b4, orbit: orbit(1e10, p[3]), distanceLs: 5_600 }),
        body(8, { kind: 'star', parents: b4, orbit: orbit(1.2e10, p[3], 0, { periapsisDeg: 180 }), distanceLs: 5_650 }),
        body(20, { parents: [star(8), ...b4], orbit: orbit(1e9, 30 * DAY), radiusKm: 70_000, distanceLs: 5_652 }),
        body(21, { parents: [planet(20), star(8), ...b4], orbit: orbit(1e8, 3 * DAY), radiusKm: 6_000 }),
        body(22, { parents: [planet(21), planet(20), star(8), ...b4], orbit: orbit(1e7, DAY), radiusKm: 5_000 }),
        body(23, { parents: [planet(22), planet(21), planet(20), star(8), ...b4], orbit: orbit(1e6, 0.3 * DAY), radiusKm: 4_000 }),
        body(24, { parents: [planet(23), planet(22), planet(21), planet(20), star(8), ...b4], orbit: orbit(1e5, 0.1 * DAY) }),
        body(25, {
          parents: [planet(24), planet(23), planet(22), planet(21), planet(20), star(8), ...b4],
          orbit: orbit(5e4, 0.05 * DAY),
        }),
      ],
      barycentres: [
        bc(0),
        bc(2, [bary(0)], orbit(3e12, p[0], 0, { periapsisDeg: 180 })),
        bc(4, [bary(2), bary(0)], orbit(4e11, p[1], 0, { periapsisDeg: 180 })),
        bc(6, [bary(4), bary(2), bary(0)], orbit(8e10, p[2], 0, { periapsisDeg: 180 })),
      ],
    })
    expect(layout.roots.map((r) => r.id)).toEqual([0])
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) expect(node(layout, id).role).toBe('component')
    expect(node(layout, 25).depth).toBe(10)
    // Every moon is smaller than what it orbits, and still visible.
    for (let id = 21; id <= 25; id++) expect(node(layout, id).size).toBeLessThan(node(layout, id - 1).size)
    expect(node(layout, 25).size).toBeGreaterThan(0)
    check(layout)
  })

  it.each([3, 4, 5])('places %i stars sharing one barycentre evenly around it', (k) => {
    const p = 800 * DAY
    const stars = Array.from({ length: k }, (_, i) =>
      body(i + 1, { kind: 'star', parents: [bary(0)], orbit: orbit(1e11 * (1 + i * 0.1), p, 40), distanceLs: i * 300 }),
    )
    const planets = Array.from({ length: k }, (_, i) =>
      body(10 + i, {
        parents: [star(i + 1), bary(0)],
        orbit: orbit(3e10, (20 + i) * DAY),
        radiusKm: i === 0 ? 60_000 : 3_000,
        rings: i === 0,
      }),
    )
    const layout = layoutSystem({
      bodies: [...stars, ...planets, body(30, { parents: [bary(0)], orbit: orbit(5e12, 50 * 365 * DAY) })],
      barycentres: [bc(0)],
    })
    const comps = stars.map((s) => node(layout, s.bodyId))
    expect(comps.every((c) => c.role === 'component')).toBe(true)
    expect(new Set(comps.map((c) => c.orbitRadius.toFixed(9))).size).toBe(1)
    const angles = comps
      .map((c) => {
        const [x, z] = localPosition(c, EPOCH_MS)
        return Math.atan2(-z, x)
      })
      .sort((a, b) => a - b)
    for (let i = 1; i < k; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo((2 * Math.PI) / k, 6)
    // The circum-multiple planet orbits outside all of them.
    const cb = node(layout, 30)
    expect(cb.role).toBe('orbit')
    for (const c of comps) expect(cb.orbitRadius - cb.extent).toBeGreaterThanOrEqual(c.orbitRadius + c.extent - EPS)
    check(layout)
  })

  it('copes with barycentres that were never scanned (no orbit, not listed, components without orbits)', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(2, { parents: [bary(1), star(0)], distanceLs: 800, radiusKm: 50_000 }),
        body(3, { parents: [bary(1), star(0)], distanceLs: 801, radiusKm: 20_000 }),
        body(4, { parents: [planet(2), bary(1), star(0)], distanceLs: 800.2 }),
        // Listed barycentre without orbit or parents: its parent comes from the chains below it.
        body(6, { parents: [bary(5), star(0)], distanceLs: 2_000 }),
        body(7, { parents: [bary(5), star(0)], distanceLs: 2_001 }),
        body(8, { parents: [bary(5), star(0)], orbit: orbit(9e11, 3_000 * DAY), distanceLs: 2_900 }),
      ],
      barycentres: [bc(5)],
    })
    expect(layout.roots.map((r) => r.id)).toEqual([0])
    expect(node(layout, 1).kind).toBe('barycentre')
    expect(node(layout, 1).parent?.id).toBe(0)
    expect(node(layout, 5).parent?.id).toBe(0)
    expect(node(layout, 2).role).toBe('component')
    expect(node(layout, 3).role).toBe('component')
    // Without periods the two innermost children are the pair; the third orbits outside.
    expect(node(layout, 6).role).toBe('component')
    expect(node(layout, 7).role).toBe('component')
    expect(node(layout, 8).role).toBe('orbit')
    check(layout)
  })

  it('builds the missing ancestors of a body whose whole parent chain is absent', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(1, { parents: [star(0)], orbit: orbit(1e11, 90 * DAY) }),
        body(30, { parents: [planet(29), bary(28), star(27), bary(26)], orbit: orbit(1e8, 2 * DAY), distanceLs: 9_000 }),
        // A second body disagreeing about the ancestry of 29: the first chain wins, nothing breaks.
        body(31, { parents: [planet(29), star(0)], orbit: orbit(2e8, 4 * DAY), distanceLs: 9_000 }),
      ],
      barycentres: [],
    })
    expect(node(layout, 29).kind).toBe('placeholder')
    expect(node(layout, 29).refKind).toBe('Planet')
    expect(node(layout, 28).kind).toBe('barycentre')
    expect(node(layout, 27).kind).toBe('placeholder')
    expect(node(layout, 27).refKind).toBe('Star')
    expect(node(layout, 26).kind).toBe('barycentre')
    expect(node(layout, 30).parent?.id).toBe(29)
    expect(node(layout, 31).parent?.id).toBe(29)
    expect(new Set(layout.roots.map((r) => r.id))).toEqual(new Set([0, 26]))
    // A missing planet is drawn smaller than a missing star.
    expect(node(layout, 29).size).toBeLessThan(node(layout, 27).size)
    check(layout)
  })

  it('drops barycentres with nothing under them (no empty roots or orbit slots)', () => {
    const layout = layoutSystem({
      bodies: [body(0, { kind: 'star', distanceLs: 0 }), body(1, { parents: [star(0)], orbit: orbit(1e11, 90 * DAY) })],
      // 5: scanned, nothing known to orbit it; 6: under the star, also empty; 7 > 8: an empty chain.
      barycentres: [bc(5, [], orbit(1e12, 1e9)), bc(6, [star(0)], orbit(4e11, 1e8)), bc(7, [star(0)]), bc(8, [bary(7), star(0)])],
    })
    expect(layout.roots.map((r) => r.id)).toEqual([0])
    expect(node(layout, 0).children.map((c) => c.id)).toEqual([1])
    for (const id of [5, 6, 7, 8]) expect(layout.nodes.has(id)).toBe(false)
    check(layout)
  })

  it('survives garbage orbit values', () => {
    const layout = layoutSystem({
      bodies: [
        body(0, { kind: 'star', distanceLs: 0 }),
        body(1, { parents: [star(0)], orbit: orbit(-5, -10, 30, { eccentricity: 3 }) }),
        body(2, { parents: [star(0)], orbit: orbit(0, 0, 400, { epoch: 'not a date', eccentricity: -1 }) }),
        body(3, { parents: [star(0)], orbit: orbit(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN) }),
        body(4, { parents: [star(0)], orbit: orbit(1e11, 1e7, 10, { ascendingNodeDeg: Number.NaN, periapsisDeg: null }) }),
      ],
      barycentres: [],
    })
    for (const t of TIMES) {
      for (const [x, z] of worldPositions(layout, t).values()) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(z)).toBe(true)
      }
    }
    check(layout)
  })

  it.each([
    ['60+ bodies, mixed data', { bodies: 70, orbitShare: 0.7, dropShare: 0.08, hideBaryShare: 0.3 }],
    ['120 bodies, full data', { bodies: 120, orbitShare: 1, dropShare: 0, hideBaryShare: 0 }],
    ['80 bodies, no orbit data at all', { bodies: 80, orbitShare: 0, dropShare: 0.05, hideBaryShare: 1 }],
    ['60 bodies, a third of them missing', { bodies: 60, orbitShare: 0.5, dropShare: 0.33, hideBaryShare: 0.5 }],
  ] as const)('random ED-like systems: %s', (_, opts) => {
    for (let seed = 1; seed <= 25; seed++) {
      const system = randomSystem(seed * 7919, opts)
      const t0 = performance.now()
      const layout = layoutSystem(system)
      expect(performance.now() - t0).toBeLessThan(50)
      // Every node is in the tree exactly once, reachable from a root.
      const seen = new Set<number>()
      const walk = (n: MapNode) => {
        expect(seen.has(n.id)).toBe(false)
        seen.add(n.id)
        n.children.forEach(walk)
      }
      layout.roots.forEach(walk)
      expect(seen.size).toBe(layout.nodes.size)
      for (const b of system.bodies) expect(layout.nodes.get(b.bodyId)?.body).toBe(b)
      // No barycentre is left empty.
      for (const n of layout.nodes.values()) if (n.kind === 'barycentre') expect(n.children.length).toBeGreaterThan(0)
      check(layout)
    }
  })

  it('is deterministic and independent of payload order', () => {
    const system = randomSystem(4242, { bodies: 70, orbitShare: 0.6, dropShare: 0.1, hideBaryShare: 0.3 })
    const a = layoutSystem(system)
    const b = layoutSystem({ bodies: [...system.bodies].reverse(), barycentres: [...system.barycentres].reverse() })
    expect(a.radius).toBeCloseTo(b.radius, 9)
    const pa = worldPositions(a, EPOCH_MS)
    const pb = worldPositions(b, EPOCH_MS)
    for (const [id, [x, z]] of pa) {
      expect(pb.get(id)![0]).toBeCloseTo(x, 9)
      expect(pb.get(id)![1]).toBeCloseTo(z, 9)
    }
  })
})

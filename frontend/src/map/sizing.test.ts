import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { BodyView, Interest, ParentRef } from '../api/types'
import { contentPoints, overviewFor } from './framing'
import { layoutSystem, type SystemLayout } from './layout'
import { LIGHT_POOL, litStars } from './lights'
import { floorPx, MAX_ZOOM, Sizer, viewFactor } from './sizing'
import { worldPerPixel } from './three-utils'

const EPOCH = '2026-10-16T00:00:00Z'
const NOW = Date.parse(EPOCH)
const DAY = 86_400
const star = (id: number): ParentRef => ({ kind: 'Star', bodyId: id })
const planet = (id: number): ParentRef => ({ kind: 'Planet', bodyId: id })

interface Opts {
  kind?: 'star' | 'planet'
  parents?: ParentRef[]
  sma?: number
  period?: number
  anomaly?: number
  radiusKm?: number
  interest?: Interest
  rings?: boolean
}

function body(bodyId: number, o: Opts = {}): BodyView {
  const kind = o.kind ?? 'planet'
  const radiusKm = o.radiusKm ?? (kind === 'star' ? 600_000 : 3_000)
  return {
    id64: String(bodyId),
    bodyId,
    name: `T ${bodyId}`,
    shortName: String(bodyId),
    kind,
    source: 'journal',
    sourceAt: null,
    sourceUrl: null,
    signalsSource: null,
    genusesSource: null,
    subtype: kind === 'star' ? 'K (Yellow-Orange) star' : 'Rocky body',
    parentId: null,
    distanceLs: bodyId * 100,
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
    signals: { bio: 0, geo: 0, human: 0, other: 0 },
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
    orbit:
      o.sma != null
        ? {
            epoch: EPOCH,
            semiMajorAxisM: o.sma,
            eccentricity: 0,
            inclinationDeg: 0,
            periapsisDeg: 0,
            ascendingNodeDeg: 0,
            meanAnomalyDeg: o.anomaly ?? (bodyId * 137.5) % 360,
            periodS: o.period ?? 100 * DAY,
          }
        : null,
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
      massEm: null,
      radiusM: radiusKm * 1_000,
      stellarMass: null,
      axialTiltRad: null,
      rotationPeriodS: null,
      tidalLock: null,
      composition: {},
      rings: o.rings ? [{ name: 'A Ring', ringClass: 'eRingClass_Icy', innerM: radiusKm * 1_400, outerM: radiusKm * 2_600 }] : [],
    },
  }
}

/** A star with a dozen planets (one with moons, one ringed): a crowded whole-system view. */
function wideSystem(): SystemLayout {
  const bodies: BodyView[] = [body(0, { kind: 'star' })]
  for (let i = 1; i <= 12; i++) {
    bodies.push(
      body(i, {
        parents: [star(0)],
        sma: i * 3e10,
        radiusKm: 1_500 + ((i * 2_371) % 30_000),
        interest: i % 4 === 0 ? 'high' : i % 3 === 0 ? 'medium' : 'low',
        rings: i === 7,
      }),
    )
  }
  bodies.push(body(20, { parents: [planet(4), star(0)], sma: 2e8, period: 3 * DAY, radiusKm: 1_200 }))
  bodies.push(body(21, { parents: [planet(4), star(0)], sma: 4e8, period: 9 * DAY, radiusKm: 900, interest: 'high' }))
  return layoutSystem({ bodies, barycentres: [] })
}

function overviewCamera(layout: SystemLayout, width: number, height: number): PerspectiveCamera {
  const ov = overviewFor(contentPoints(layout, NOW), 40, width / height)
  const cam = new PerspectiveCamera(40, width / height, 0.1, 1e5)
  cam.position.setFromSpherical(new Spherical(ov.distance, ov.polar, ov.azimuth)).add(ov.target)
  cam.lookAt(ov.target)
  cam.updateMatrixWorld()
  return cam
}

interface Disc {
  id: number
  x: number
  y: number
  r: number
  natural: number
}

/** On-screen body circles (CSS px), magnified or at rest. */
function discs(sizer: Sizer, cam: PerspectiveCamera, width: number, height: number, rest: boolean): Disc[] {
  const out: Disc[] = []
  sizer.nodes.forEach((n, i) => {
    if (n.size <= 0) return
    const v = rest ? restPosition(sizer.layout, n.id) : new Vector3(sizer.worldX[i], 0, sizer.worldZ[i])
    const wpp = worldPerPixel(cam, cam.position.distanceTo(v), height)
    v.project(cam)
    const scale = rest ? 1 : sizer.worldScale[i] * sizer.body[i]
    out.push({
      id: n.id,
      x: ((v.x + 1) / 2) * width,
      y: ((1 - v.y) / 2) * height,
      r: (n.size * scale) / wpp,
      natural: n.size / wpp,
    })
  })
  return out
}

function restPosition(layout: SystemLayout, id: number): Vector3 {
  const rest = new Sizer(layout, 'rest')
  const i = rest.index.get(id)!
  // Positions only: a camera that sees nothing magnifies nothing.
  const far = new PerspectiveCamera(40, 1, 0.1, 1e9)
  far.position.set(0, 1e7, 1)
  far.lookAt(0, 0, 0)
  rest.solve(far, 100, 100, NOW, 0, null)
  return new Vector3(rest.worldX[i], 0, rest.worldZ[i])
}

const gap = (a: Disc, b: Disc) => Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r

describe('floors', () => {
  it('keep the hierarchy: stars, then interest, then layout size', () => {
    const layout = wideSystem()
    const s = layout.nodes.get(0)!
    const planets = [...layout.nodes.values()].filter((n) => n.kind === 'planet')
    const high = planets.find((n) => n.interest === 'high')!
    const low = planets.find((n) => n.interest === 'low')!
    expect(floorPx(s, false)).toBeGreaterThan(floorPx(high, false))
    expect(floorPx({ ...high, size: low.size }, false)).toBeGreaterThan(floorPx(low, false))
    expect(floorPx({ ...low, size: 1.1 }, false)).toBeGreaterThan(floorPx({ ...low, size: 0.3 }, false))
    // "You are here" is never treated as dull.
    expect(floorPx(low, true)).toBeGreaterThan(floorPx(low, false))
    expect(viewFactor(358, 480)).toBeLessThan(viewFactor(930, 637))
  })
})

describe('Sizer', () => {
  it.each([
    ['desktop', 930, 637],
    ['phone', 358, 480],
  ])('magnifies small bodies without making any touch (%s)', (_, width, height) => {
    const layout = wideSystem()
    const cam = overviewCamera(layout, width, height)
    const sizer = new Sizer(layout, 'wide')
    for (let k = 0; k < 3; k++) sizer.solve(cam, width, height, NOW, 0, null)

    const before = discs(sizer, cam, width, height, true)
    const after = discs(sizer, cam, width, height, false)
    let grown = 0
    for (let i = 0; i < after.length; i++) {
      expect(after[i].r).toBeGreaterThanOrEqual(before[i].r - 1e-9)
      if (after[i].r > before[i].r * 1.3) grown++
      for (let j = i + 1; j < after.length; j++) {
        // Bodies apart at rest stay apart (projection may already overlap a moon and its planet).
        if (gap(before[i], before[j]) > 0) expect(gap(after[i], after[j])).toBeGreaterThan(-0.05)
      }
    }
    expect(grown).toBeGreaterThanOrEqual(4)
    for (const z of sizer.zoom) expect(z).toBeLessThanOrEqual(MAX_ZOOM)

    // A planet's moons are magnified with it (its whole subsystem zooms).
    const p = sizer.index.get(4)!
    const m = sizer.index.get(21)!
    expect(sizer.worldScale[m]).toBeGreaterThanOrEqual(sizer.worldScale[p] - 1e-9)
    // Planets of the star are not drawn bigger than they ask for.
    const k = viewFactor(width, height)
    for (const d of after) {
      const n = layout.nodes.get(d.id)!
      if (n.parent?.id === 0) expect(d.r).toBeLessThanOrEqual(Math.max(d.natural, floorPx(n, false) * k) + 1e-6)
    }
  })

  it('keeps an interesting moon smaller than its dull giant', () => {
    const bodies: BodyView[] = [body(0, { kind: 'star' })]
    for (let i = 1; i <= 30; i++) bodies.push(body(i, { parents: [star(0)], sma: i * 1e10, radiusKm: 2_000 }))
    bodies.push(body(11, { parents: [star(0)], sma: 40e10, radiusKm: 70_000, anomaly: 90 }))
    bodies.push(body(30, { parents: [planet(11), star(0)], sma: 5e8, period: 4 * DAY, radiusKm: 2_500, interest: 'high' }))
    const layout = layoutSystem({ bodies, barycentres: [] })
    const cam = overviewCamera(layout, 930, 637)
    const sizer = new Sizer(layout, 'moon')
    for (let k = 0; k < 3; k++) sizer.solve(cam, 930, 637, NOW, 0, null)
    const d = discs(sizer, cam, 930, 637, false)
    const giant = d.find((x) => x.id === 11)!
    const moon = d.find((x) => x.id === 30)!
    expect(moon.r).toBeGreaterThan(moon.natural * 1.5)
    expect(moon.r).toBeLessThan(giant.r)
    // It asks for less than its planet does, though its interest alone would ask for more.
    expect(floorPx(layout.nodes.get(30)!, false)).toBeGreaterThan(floorPx(layout.nodes.get(11)!, false))
    expect(sizer.floorOf(30)).toBeLessThan(sizer.floorOf(11))
  })

  it('leaves a close-up alone', () => {
    const layout = wideSystem()
    const target = restPosition(layout, 4)
    const cam = new PerspectiveCamera(40, 1.5, 0.1, 1e5)
    cam.position.copy(target).add(new Vector3(0, 2, 6))
    cam.lookAt(target)
    cam.updateMatrixWorld()
    const sizer = new Sizer(layout, 'wide')
    sizer.solve(cam, 900, 600, NOW, 0, null)
    const i = sizer.index.get(4)!
    expect(sizer.zoom[i]).toBe(1)
    expect(sizer.body[i]).toBe(1)
    expect(sizer.worldOf(4)).toBe(1)
  })

  it('eases growth in and carries it over between layouts of the same system only', () => {
    const layout = wideSystem()
    const cam = overviewCamera(layout, 930, 637)
    const sizer = new Sizer(layout, 'wide')
    sizer.solve(cam, 930, 637, NOW, 1 / 30, null)
    const first = Math.max(...sizer.zoom)
    for (let k = 0; k < 60; k++) sizer.solve(cam, 930, 637, NOW, 1 / 30, null)
    const settled = Math.max(...sizer.zoom)
    expect(first).toBeGreaterThan(1)
    expect(first).toBeLessThan(settled)

    const again = new Sizer(wideSystem(), 'wide', sizer)
    expect(Math.max(...again.zoom)).toBeCloseTo(settled)
    const other = new Sizer(wideSystem(), 'another system', sizer)
    expect(Math.max(...other.zoom)).toBe(1)
  })
})

describe('litStars', () => {
  it('gives the pooled lights to the stars that light the most bodies', () => {
    const bodies: BodyView[] = []
    for (let s = 0; s < 6; s++) {
      bodies.push(body(s * 10, { kind: 'star', radiusKm: 400_000 + s * 10_000 }))
      for (let p = 1; p <= s; p++) bodies.push(body(s * 10 + p, { parents: [star(s * 10)], sma: p * 1e10 }))
    }
    const lit = litStars(layoutSystem({ bodies, barycentres: [] }))
    expect(lit).toHaveLength(LIGHT_POOL)
    expect(lit.map((n) => n.id)).toEqual([50, 40, 30, 20])
  })
})

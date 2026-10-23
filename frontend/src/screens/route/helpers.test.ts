import { describe, expect, it } from 'vitest'
import type { RouteBodyView, RouteStopView, RouteView } from '../../api/types'
import { approxLy, routeLeft, stopLeft } from './helpers'

function body(extra: Partial<RouteBodyView>): RouteBodyView {
  return {
    bodyId: 1,
    name: 'X 1',
    shortName: '1',
    kind: 'elw',
    distanceLs: 100,
    mappingValue: 0,
    scanned: false,
    mapped: false,
    bioSignals: 0,
    bioMin: 0,
    bioMax: 0,
    bioDone: 0,
    genuses: [],
    done: false,
    codex: [],
    ...extra,
  }
}

function stop(bodies: RouteBodyView[], extra: Partial<RouteStopView> = {}): RouteStopView {
  return {
    seq: 1,
    address: '1',
    name: 'X',
    x: 0,
    y: 0,
    z: 0,
    hopLy: 10,
    jumps: 1,
    population: 0,
    bodies,
    value: 0,
    valueMin: 0,
    visited: false,
    done: false,
    skipped: false,
    passed: false,
    here: false,
    codexNew: 0,
    discovery: null,
    spreadLy: 0,
    first: null,
    neutron: false,
    ...extra,
  }
}

describe('what is left to earn', () => {
  it('counts unmapped planets and the species not analysed yet, biology as a range', () => {
    const s = stop([
      body({ mappingValue: 1_000_000 }),
      body({ kind: 'thmc', mappingValue: 600_000, mapped: true }),
      body({ kind: 'bio', bioSignals: 4, bioMin: 8_000_000, bioMax: 20_000_000, bioDone: 1 }),
    ])
    // 1M mapping + 3 of 4 species: 6M–15M.
    expect(stopLeft(s)).toEqual({ min: 7_000_000, max: 16_000_000 })
  })

  it('sums the route without the skipped stops', () => {
    const route = {
      stops: [
        stop([body({ mappingValue: 1_000_000 })]),
        stop([body({ mappingValue: 5_000_000 })], { skipped: true }),
        stop([body({ mappingValue: 2_000_000, mapped: true, done: true })], { done: true }),
        stop([body({ kind: 'bio', bioSignals: 2, bioMin: 2_000_000, bioMax: 6_000_000 })]),
      ],
    } as RouteView
    expect(routeLeft(route)).toEqual({ min: 3_000_000, max: 7_000_000 })
  })
})

describe('approxLy', () => {
  it('marks a distance to a stop placed at its boxel centre', () => {
    expect(approxLy(12.34, true).startsWith('≈')).toBe(true)
    expect(approxLy(12.34, false).startsWith('≈')).toBe(false)
  })
})

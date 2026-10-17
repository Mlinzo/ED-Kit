import { describe, expect, it } from 'vitest'
import type { NavHopView, NavRouteView } from '../../api/types'
import { AHEAD_SHOWN, chanceTone, fuelTone, hasHidden, percent, shownHops, sortedWarnings } from './plotted'

function hop(index: number, status: NavHopView['status']): NavHopView {
  return {
    index,
    address: String(index),
    name: `Hop ${index}`,
    starClass: 'K',
    starKind: 'scoopable',
    x: index * 30,
    y: 0,
    z: 0,
    distanceLy: index ? 30 : 0,
    status,
    fuelUsed: null,
    fuelAfter: null,
    refuel: false,
    short: false,
    discovery: null,
    discoveredByYou: null,
  }
}

function view(count: number, here: number | null, warnings: string[] = []): NavRouteView {
  return {
    online: true,
    checking: false,
    plottedAt: null,
    hops: Array.from({ length: count }, (_, i) =>
      hop(i, here === null ? 'ahead' : i < here ? 'passed' : i === here ? 'here' : 'ahead'),
    ),
    hereIndex: here,
    jumpsLeft: 0,
    lyLeft: 0,
    fuel: {
      level: null,
      capacity: null,
      hasScoop: true,
      learntFrom: 0,
      needed: null,
      enough: null,
      shortAt: null,
      jumpsToScoop: null,
      fuelAtScoop: null,
      longestDry: 0,
      longestDryFuel: null,
    },
    nextNeutron: null,
    nextWhiteDwarf: null,
    neutronsAhead: 0,
    whiteDwarfsAhead: 0,
    undiscoveredExpected: 0,
    warnings,
  }
}

describe('plotted route panel', () => {
  it('lists where you are and the next hops, the passed ones only when expanded', () => {
    const v = view(30, 4)
    const shown = shownHops(v, false)
    expect(shown[0].index).toBe(4)
    expect(shown).toHaveLength(1 + AHEAD_SHOWN)
    expect(hasHidden(v)).toBe(true)
    expect(shownHops(v, true)).toHaveLength(30)
  })

  it('shows a short route whole', () => {
    const v = view(5, 0)
    expect(shownHops(v, false)).toHaveLength(5)
    expect(hasHidden(v)).toBe(false)
  })

  it('starts at the first hop ahead when you are off the route', () => {
    const v = view(5, null)
    expect(shownHops(v, false)[0].index).toBe(0)
  })

  it('puts fuel trouble first', () => {
    const v = view(3, 0, ['neutron_next', 'off_route', 'fuel_tight', 'refuel_here'])
    expect(sortedWarnings(v)).toEqual(['refuel_here', 'fuel_tight', 'neutron_next', 'off_route'])
    expect(fuelTone(v)).toBe('danger')
    expect(fuelTone(view(3, 0, ['fuel_tight']))).toBe('warn')
    expect(fuelTone(view(3, 0, ['neutron_next']))).toBe('ok')
  })

  it('formats chances', () => {
    expect(percent(0.6)).toBe('60%')
    expect(percent(0.005)).toBe('< 1%')
    expect(percent(0)).toBe('0%')
    expect(chanceTone(0.9)).toBe('high')
    expect(chanceTone(0.3)).toBe('mid')
    expect(chanceTone(0.02)).toBe('low')
    expect(chanceTone(null)).toBe('low')
  })
})

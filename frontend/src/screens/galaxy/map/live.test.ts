import { describe, expect, it } from 'vitest'
import type { LiveSystemView, LiveView } from '../../../api/types'
import { buildLivePoints, liveAlpha, liveKey, liveSize } from './live'

function system(address: string, ageS: number, players = 1): LiveSystemView {
  return { address, name: `Sys ${address}`, x: 100, y: 0, z: 200, ageS, players, arrived: 1, scans: 0, codex: [], docked: 0, carriers: 0 }
}

describe('live players', () => {
  it('sizes by players, on a log scale with a cap', () => {
    expect(liveSize(1)).toBe(5)
    expect(liveSize(4)).toBeGreaterThan(liveSize(2))
    expect(liveSize(1000)).toBe(13)
  })

  it('fades with age, never out', () => {
    expect(liveAlpha(0, 900)).toBe(1)
    expect(liveAlpha(900, 900)).toBeCloseTo(0.28)
    expect(liveAlpha(5000, 900)).toBeCloseTo(0.28)
  })

  it('draws the freshest last', () => {
    const view: LiveView = { available: true, state: 'live', since: null, windowMin: 5, spanS: 300, players: 3, systems: [system('1', 10), system('2', 500), system('3', 60, 3)] }
    const points = buildLivePoints(view)
    expect(points.map((p) => p.key)).toEqual([liveKey('2'), liveKey('3'), liveKey('1')])
    expect(points[2].pos).toEqual([1, 0, -2])
  })
})

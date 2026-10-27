import { describe, expect, it } from 'vitest'
import { AFK_GAP_S, liveSeconds, perHour, splitDuration } from './timeSpent'

const AS_OF = '2026-10-20T10:00:00Z'
const after = (s: number) => Date.parse(AS_OF) + s * 1_000

describe('time spent', () => {
  it('counts on from the last event where you are now', () => {
    expect(liveSeconds(600, AS_OF, after(90), true)).toBe(690)
    expect(liveSeconds(600, AS_OF, after(90), false)).toBe(600)
    expect(liveSeconds(600, null, after(90), true)).toBe(600)
  })

  it('stops counting once the silence is AFK', () => {
    expect(liveSeconds(600, AS_OF, after(AFK_GAP_S), true)).toBe(600 + AFK_GAP_S)
    expect(liveSeconds(600, AS_OF, after(AFK_GAP_S + 1), true)).toBe(600)
    expect(liveSeconds(600, AS_OF, after(-5), true)).toBe(600) // a clock behind the journal
  })

  it('gives a pace per hour only for stays of ten minutes or more', () => {
    expect(perHour(5_000_000, 1_800)).toBe(10_000_000)
    expect(perHour(5_000_000, 599)).toBeNull()
  })

  it('splits a duration into hours and minutes', () => {
    expect(splitDuration(5_820)).toEqual({ h: 1, m: 37 })
    expect(splitDuration(20)).toEqual({ h: 0, m: 1 })
    expect(splitDuration(3_599)).toEqual({ h: 1, m: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '../../api/types'
import { DEFAULT_SORT, nextSort, sortRows, toRows, totals } from './sessionList'

function session(startedAt: string, durationS: number, value: number, extra: Partial<SessionEntry> = {}): SessionEntry {
  return {
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + durationS * 1_000).toISOString(),
    open: false,
    durationS,
    jumps: 0,
    distanceLy: 0,
    systems: 0,
    bodiesScanned: 0,
    bodiesMapped: 0,
    speciesAnalysed: 0,
    firstDiscoveries: 0,
    firstMapped: 0,
    firstFootfalls: 0,
    cartoValue: value,
    bioValue: 0,
    value,
    lostValue: 0,
    deaths: 0,
    codex: [],
    ...extra,
  }
}

const NOW = Date.parse('2026-10-20T12:00:00Z')
const SESSIONS = [
  session('2026-10-20T10:00:00Z', 3_600, 10_000_000, { open: true }),
  session('2026-10-19T18:00:00Z', 7_200, 30_000_000, { jumps: 12 }),
  session('2026-10-18T18:00:00Z', 300, 5_000_000),
  session('2026-10-17T18:00:00Z', 3_600, 30_000_000),
]

describe('toRows', () => {
  it('counts a live session up to now', () => {
    const [live] = toRows(SESSIONS, true, NOW)
    expect(live.live).toBe(true)
    expect(live.playedS).toBe(2 * 3_600)
    expect(live.perHour).toBe(5_000_000)
  })

  it('takes an open session as ended when the game is not running (it crashed)', () => {
    const [crashed] = toRows(SESSIONS, false, NOW)
    expect(crashed.live).toBe(false)
    expect(crashed.playedS).toBe(3_600)
  })

  it('gives short sessions no pace', () => {
    expect(toRows(SESSIONS, false, NOW)[2].perHour).toBeNull()
  })
})

describe('sortRows', () => {
  const rows = toRows(SESSIONS, false, NOW)
  const starts = (sorted: ReturnType<typeof sortRows>) => sorted.map((r) => r.s.startedAt.slice(0, 10))

  it('starts newest first', () => {
    expect(starts(sortRows(rows, DEFAULT_SORT))).toEqual(['2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17'])
  })

  it('breaks ties newest first', () => {
    expect(starts(sortRows(rows, { key: 'earned', desc: true }))).toEqual([
      '2026-10-19',
      '2026-10-17',
      '2026-10-20',
      '2026-10-18',
    ])
  })

  it('keeps sessions without a pace last in both directions', () => {
    expect(starts(sortRows(rows, { key: 'perHour', desc: true })).at(-1)).toBe('2026-10-18')
    expect(starts(sortRows(rows, { key: 'perHour', desc: false })).at(-1)).toBe('2026-10-18')
    expect(starts(sortRows(rows, { key: 'perHour', desc: false }))[0]).toBe('2026-10-20')
  })
})

describe('nextSort', () => {
  it('opens a column biggest first, then reverses it', () => {
    const byJumps = nextSort(DEFAULT_SORT, 'jumps')
    expect(byJumps).toEqual({ key: 'jumps', desc: true })
    expect(nextSort(byJumps, 'jumps')).toEqual({ key: 'jumps', desc: false })
  })
})

describe('figures', () => {
  it('adds up time and earnings', () => {
    expect(totals(toRows(SESSIONS, false, NOW))).toEqual({ playedS: 14_700, earned: 75_000_000 })
  })
})

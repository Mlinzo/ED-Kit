import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../api/types'
import { bookmarkOf } from '../../mock/bookmarks'
import {
  filterCounts,
  groupByDay,
  isTransit,
  limitRows,
  matchesFilter,
  matchesQuery,
  relativeDay,
  sortSystems,
  type HistorySort,
} from './historyList'

function entry(name: string, at: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    address: name,
    name,
    firstVisitAt: at,
    lastVisitAt: at,
    visits: 1,
    mainStar: null,
    bodyCount: null,
    allBodiesFound: false,
    bodiesScanned: 1,
    bodiesMapped: 0,
    bioSignals: 0,
    speciesAnalysed: 0,
    firstDiscoveries: 0,
    firstMapped: 0,
    firstFootfalls: 0,
    value: 1_200,
    unsoldValue: 0,
    lostValue: 0,
    notable: [],
    bookmark: null,
    innerBookmarks: 0,
    timeS: 0,
    ...extra,
  }
}

// Local times, so the day grouping does not depend on the test machine's time zone.
const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString()

describe('history filters', () => {
  const transit = entry('Hyades Sector BV-Y c16', local(2026, 10, 16, 22))
  const bio = entry('Col 285 Sector TT-H c10-4', local(2026, 10, 16, 21), { bodiesScanned: 8, bioSignals: 3 })
  const firsts = entry('Oochoss Brou KD-K d8-61', local(2026, 10, 15, 20), {
    bodiesScanned: 4,
    firstDiscoveries: 4,
    unsoldValue: 900_000,
    bookmark: bookmarkOf({ comment: 'come back' }),
  })
  const noted = entry('Col 285 Sector AB-C d1', local(2026, 10, 15, 19), { innerBookmarks: 1 })

  it('treats a lone arrival star as transit', () => {
    expect(isTransit(transit)).toBe(true)
    expect(isTransit(bio)).toBe(false)
    expect(isTransit(entry('x', local(2026, 10, 16, 1), { speciesAnalysed: 1 }))).toBe(false)
  })

  it('matches filters', () => {
    expect([transit, bio, firsts].filter((e) => matchesFilter(e, 'explored'))).toEqual([bio, firsts])
    expect([transit, bio, firsts].filter((e) => matchesFilter(e, 'bio'))).toEqual([bio])
    expect([transit, bio, firsts].filter((e) => matchesFilter(e, 'firsts'))).toEqual([firsts])
    expect([transit, bio, firsts].filter((e) => matchesFilter(e, 'unsold'))).toEqual([firsts])
    expect([transit, bio, firsts, noted].filter((e) => matchesFilter(e, 'bookmarks'))).toEqual([firsts, noted])
  })

  it('searches names by words, ignoring case', () => {
    expect(matchesQuery(bio, '  col   tt-h ')).toBe(true)
    expect(matchesQuery(bio, 'hyades')).toBe(false)
    expect(matchesQuery(bio, '')).toBe(true)
  })

  it('counts every filter within the search', () => {
    expect(filterCounts([transit, bio, firsts], '')).toEqual({ all: 3, explored: 2, bio: 1, firsts: 1, unsold: 1, bookmarks: 1 })
    expect(filterCounts([transit, bio, firsts], 'sector')).toEqual({
      all: 2,
      explored: 1,
      bio: 1,
      firsts: 0,
      unsold: 0,
      bookmarks: 0,
    })
  })
})

describe('day groups', () => {
  const list = [
    entry('a', local(2026, 10, 16, 22)),
    entry('b', local(2026, 10, 16, 0)),
    entry('c', local(2026, 10, 15, 23)),
    entry('d', local(2026, 10, 13, 12)),
  ]

  it('groups consecutive systems by local day', () => {
    const groups = groupByDay(list)
    expect(groups.map((g) => [g.day, g.entries.map((e) => e.name).join('')])).toEqual([
      ['2026-10-16', 'ab'],
      ['2026-10-15', 'c'],
      ['2026-10-13', 'd'],
    ])
  })

  it('limits rows but keeps full day counts', () => {
    const groups = limitRows(groupByDay(list), 3)
    expect(groups.map((g) => [g.rows.length, g.entries.length])).toEqual([
      [2, 2],
      [1, 1],
    ])
  })

  it('names today and yesterday', () => {
    const now = new Date(2026, 9, 16, 12).getTime()
    expect(relativeDay('2026-10-16', now)).toBe('today')
    expect(relativeDay('2026-10-15', now)).toBe('yesterday')
    expect(relativeDay('2026-10-13', now)).toBeNull()
  })
})

describe('history order', () => {
  // Newest first, as the backend sends them.
  const list = [
    entry('a', local(2026, 10, 16, 22), { timeS: 300, value: 100_000 }),
    entry('b', local(2026, 10, 16, 21), { timeS: 3_600, value: 2_000_000 }),
    entry('c', local(2026, 10, 16, 20), { timeS: 3_600, value: 9_000_000 }),
    entry('d', local(2026, 10, 16, 19), { timeS: 1_200, value: 6_000_000 }),
  ]
  const stay = (e: HistoryEntry) => ({ timeS: e.timeS, perHour: e.timeS >= 600 ? (e.value * 3_600) / e.timeS : null })
  const names = (sort: HistorySort) => sortSystems(list, sort, stay).map((e) => e.name).join('')

  it('keeps the newest first by default', () => {
    expect(names('recent')).toBe('abcd')
  })

  it('puts the longest stays first, the newest first among equals', () => {
    expect(names('time')).toBe('bcda')
  })

  it('puts the best pace first and short stays last', () => {
    expect(names('perHour')).toBe('dcba')
  })
})

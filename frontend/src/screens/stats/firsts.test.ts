import { describe, expect, it } from 'vitest'
import type { FirstEntry } from '../../api/types'
import { entryTime, groupFirsts, markCounts, stateCounts } from './firstGroups'
import { shipName } from './ships'

const entry = (system: string | null, short: string, at: string | null, extra: Partial<FirstEntry> = {}): FirstEntry => ({
  system,
  body: system ? `${system} ${short}` : short,
  shortName: short,
  subtype: 'Icy body',
  at,
  discovered: 'sold',
  mapped: null,
  footfallAt: null,
  ...extra,
})

describe('shipName', () => {
  it('maps common journal symbols', () => {
    expect(shipName('python_nx')).toBe('Python Mk II')
    expect(shipName('federation_gunship')).toBe('Federal Gunship')
    expect(shipName('Krait_MkII')).toBe('Krait Mk II')
    expect(shipName('$Anaconda_Name;')).toBe('Anaconda')
  })
  it('names suits and title-cases unknown symbols', () => {
    expect(shipName('utilitysuit_class3')).toBe('Maverick Suit')
    expect(shipName('assaultsuit_ai_class1')).toBe('Assault Suit')
    expect(shipName('some_new_ship_mkiii')).toBe('Some New Ship Mk III')
    expect(shipName('skimmer')).toBe('Skimmer')
  })
  it('returns null for nothing', () => {
    expect(shipName(null)).toBeNull()
    expect(shipName('')).toBeNull()
  })
})

describe('firsts grouping', () => {
  const list: FirstEntry[] = [
    entry('Triviatii', 'B 5', '2026-10-16T20:59:28Z', { discovered: null, footfallAt: '2026-10-16T21:38:32Z' }),
    entry('Arawan', '2 f', '2026-10-16T21:00:00Z', { discovered: null, footfallAt: null, mapped: 'pending' }),
    entry('Triviatii', 'A 10', '2026-10-16T20:58:56Z', { discovered: 'lost' }),
    entry('Triviatii', 'A 4', '2026-10-16T20:58:00Z', { discovered: 'pending', mapped: 'sold' }),
    entry(null, 'X 1', null),
  ]

  it('uses the newer of scan and footfall', () => {
    expect(entryTime(list[0])).toBe(Date.parse('2026-10-16T21:38:32Z'))
    expect(entryTime(list[1])).toBe(Date.parse('2026-10-16T21:00:00Z'))
    expect(entryTime(list[4])).toBe(-Infinity)
  })

  it('groups by system, newest system first, bodies in natural order', () => {
    const groups = groupFirsts(list)
    expect(groups.map((g) => g.system)).toEqual(['Triviatii', 'Arawan', null])
    expect(groups[0].entries.map((e) => e.shortName)).toEqual(['A 4', 'A 10', 'B 5'])
    expect(groups[0].counts).toEqual({ discovered: 2, mapped: 1, footfall: 1 })
  })

  it('filters by mark', () => {
    expect(groupFirsts(list, 'footfall').map((g) => [g.system, g.entries.length])).toEqual([['Triviatii', 1]])
    expect(groupFirsts(list, 'mapped').map((g) => g.system)).toEqual(['Arawan', 'Triviatii'])
  })

  it('counts marks and states', () => {
    expect(markCounts(list)).toEqual({ discovered: 3, mapped: 2, footfall: 1 })
    expect(stateCounts(list, 'discovered')).toEqual({ sold: 1, pending: 1, lost: 1 })
    expect(stateCounts(list, 'mapped')).toEqual({ sold: 1, pending: 1, lost: 0 })
  })
})

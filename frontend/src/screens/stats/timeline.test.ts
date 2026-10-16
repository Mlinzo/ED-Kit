import { describe, expect, it } from 'vitest'
import type { DayStats } from '../../api/types'
import { bucketize } from './timeline'

const day = (date: string, carto: number, bio: number, extra: Partial<DayStats> = {}): DayStats => ({
  date,
  jumps: 1,
  distanceLy: 10,
  bodiesScanned: 2,
  speciesAnalysed: 0,
  earnings: carto + bio,
  earningsCarto: carto,
  earningsBio: bio,
  ...extra,
})

describe('bucketize earnings split', () => {
  it('sums cartography and exobiology per bucket', () => {
    const buckets = bucketize([day('2026-10-12', 100, 0), day('2026-10-13', 50, 400), day('2026-10-20', 0, 7)], 'week')
    expect(buckets.map((b) => [b.start, b.earningsCarto, b.earningsBio, b.earnings])).toEqual([
      ['2026-10-12', 150, 400, 550],
      ['2026-10-19', 0, 7, 7],
    ])
  })
  it('treats a missing split (older backend) as zero, keeping the total', () => {
    const old = { ...day('2026-10-12', 0, 0), earnings: 900 } as Partial<DayStats>
    delete old.earningsCarto
    delete old.earningsBio
    const [b] = bucketize([old as DayStats], 'day')
    expect([b.earnings, b.earningsCarto, b.earningsBio]).toEqual([900, 0, 0])
  })
})

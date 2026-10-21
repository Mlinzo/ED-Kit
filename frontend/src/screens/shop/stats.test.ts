import { Crosshair, Drone, Puzzle, Rocket, Zap } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { formatStat, moduleIcon, shownStats } from './stats'

describe('module figures', () => {
  it('formats with the unit, without a tail of zeros on whole numbers', () => {
    expect(formatStat('fsdoptmass', 1050)).toBe('1,050 t')
    expect(formatStat('maxfuel', 5)).toBe('5 t')
    expect(formatStat('maxfuel', 2.6)).toBe('2.60 t')
    expect(formatStat('thmres', -20)).toBe('−20%')
    expect(formatStat('scooprate', 0.577)).toBe('0.577 t/s')
  })

  it('lists only the figures it knows', () => {
    expect(shownStats({ dps: 12.6, somethingNew: 3, maximumrng: 4000 })).toEqual([
      ['dps', 12.6],
      ['maximumrng', 4000],
    ])
  })

  it('picks an icon by module type', () => {
    expect(moduleIcon('cfsd')).toBe(Zap)
    expect(moduleIcon('hmr')).toBe(Rocket)
    expect(moduleIcon('hmc')).toBe(Crosshair)
    expect(moduleIcon('iplc')).toBe(Drone)
    expect(moduleIcon(null)).toBe(Puzzle)
  })
})

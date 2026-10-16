import { describe, expect, it } from 'vitest'
import type { BodyView } from '../api/types'
import { buildSystem } from '../mock/fixtures'
import { communityText, isCommunity, sourceDate, sourceMarker } from './source'

const bodies = buildSystem().bodies
const byName = (name: string): BodyView => {
  const b = bodies.find((x) => x.shortName === name)
  if (!b) throw new Error(name)
  return b
}
const NOW = Date.parse('2026-10-17T12:00:00Z')

describe('sourceDate', () => {
  it('drops the abbreviation dot and keeps day and month together', () => {
    expect(sourceDate('2026-10-11T12:00:00Z', false, NOW)).toBe('11\u00a0окт')
  })
  it('adds the year for another year, the time on request', () => {
    expect(sourceDate('2025-03-03T12:00:00Z', false, NOW)).toBe('3\u00a0мар\u00a02025')
    expect(sourceDate('2026-10-16T12:00:00Z', true, NOW)).toMatch(/^16\u00a0окт, \d\d:\d\d$/)
  })
  it('is null without a valid date', () => {
    expect(sourceDate(null)).toBeNull()
    expect(sourceDate('soon')).toBeNull()
  })
})

describe('sourceMarker', () => {
  it('says nothing for your own scans', () => {
    expect(sourceMarker(byName('A 3'))).toBeNull()
    expect(sourceMarker(byName('A 1'))).toBeNull()
  })
  it('marks a database body as a whole, with the database and its date', () => {
    const m = sourceMarker(byName('B 3'))
    expect(m?.scope).toBe('body')
    expect(m?.source).toBe('spansh')
    expect(m?.title).toContain('Spansh — данные других игроков')
    expect(m?.title).toContain('обновлено 11\u00a0окт')
  })
  it('marks only the bio data of your body when its signals come from a database', () => {
    const m = sourceMarker(byName('A 5 a'))
    expect(m).toEqual({ scope: 'bio', source: 'spansh', title: 'Биосигналы: Spansh — данные других игроков' })
  })
})

describe('mock community data', () => {
  it('links Spansh bodies to their page and does not count them as found', () => {
    const system = buildSystem()
    const community = system.bodies.filter((b) => isCommunity(b.source))
    expect(community.length).toBeGreaterThanOrEqual(3)
    for (const b of community) {
      expect(b.sourceUrl).toBe(`https://spansh.co.uk/body/${b.id64}`)
      expect(b.wasDiscovered).toBe(true)
    }
    expect(system.scannedCount).toBe(system.bodies.length - community.length)
    expect(communityText('edsm')).toBe('EDSM — данные других игроков')
  })
  it('has finished bodies and reasons that agree with interest', () => {
    const done = bodies.filter((b) => b.done)
    expect(done.length).toBeGreaterThanOrEqual(2)
    for (const b of bodies) {
      if (b.interest === 'high') expect(b.reasons.length).toBeGreaterThan(0)
      if (b.done) expect(b.interest).not.toBe('high')
    }
  })
})

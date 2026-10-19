import { describe, expect, it } from 'vitest'
import type { BodyView } from '../api/types'
import { t } from '../i18n'
import { buildSystem } from '../mock/fixtures'
import { bodyCodex, codexLabel, codexNewStatus, codexTitle } from './codex'

const bodies = buildSystem().bodies
const byName = (name: string): BodyView => {
  const b = bodies.find((x) => x.shortName === name)
  if (!b) throw new Error(name)
  return b
}

describe('species codex marks', () => {
  it('labels the three states', () => {
    expect(codexLabel('new')).toBe(t.codex.new)
    expect(codexLabel('new_region')).toBe(t.codex.newRegion)
    expect(codexLabel('logged')).toBe(t.codex.logged)
  })
  it('explains that the codex is per region and per species', () => {
    expect(codexTitle('new_region')).toContain(t.codex.newRegionHint)
    expect(codexTitle('logged')).toContain(t.codex.note)
  })
  it('says when a new species is only predicted here', () => {
    expect(codexTitle('new', true)).toContain(t.codex.tentativeHint)
    expect(codexTitle('new')).not.toContain(t.codex.tentativeHint)
    expect(codexTitle('logged', true)).not.toContain(t.codex.tentativeHint)
  })
  it('treats new for the region as a new entry', () => {
    expect(codexNewStatus('new')).toBe(true)
    expect(codexNewStatus('new_region')).toBe(true)
    expect(codexNewStatus('logged')).toBe(false)
  })
})

describe('bodyCodex', () => {
  it('is strong with the confirmed count', () => {
    const c = bodyCodex({ codexNew: 2, codexMaybe: 0, genuses: ['Stratum'] })
    expect(c).toMatchObject({ level: 'new', count: 2, text: t.codex.bodyNew(2) })
  })
  it('mentions uncertain ones next to confirmed ones', () => {
    const c = bodyCodex({ codexNew: 1, codexMaybe: 3, genuses: [] })
    expect(c?.level).toBe('new')
    expect(c?.text).toBe(`${t.codex.bodyNew(1)} · ${t.codex.alsoMaybe(3)}`)
    expect(c?.title).toContain(t.codex.bodyMaybe(3))
  })
  it('is faint with only predictions, and points to DSS', () => {
    const c = bodyCodex({ codexNew: 0, codexMaybe: 5, genuses: [] })
    expect(c).toMatchObject({ level: 'maybe', count: 5, text: t.codex.bodyMaybe(5) })
    expect(c?.title).toContain(t.codex.dssHint)
  })
  it('says nothing when everything is known', () => {
    expect(bodyCodex({ codexNew: 0, codexMaybe: 0, genuses: [] })).toBeNull()
  })
  it('the demo shows every state', () => {
    expect(bodyCodex(byName('A 3'))?.level).toBe('new')
    expect(bodyCodex(byName('B 3'))?.level).toBe('new')
    expect(bodyCodex(byName('A 5 a'))?.level).toBe('new') // the genus is deduced
    expect(bodyCodex(byName('A 5 b'))?.level).toBe('maybe')
    expect(bodyCodex(byName('B 1'))).toBeNull()
    const states = new Set(bodies.flatMap((b) => b.species.map((s) => s.codex)))
    expect([...states].sort()).toEqual(['logged', 'new', 'new_region'])
  })
})

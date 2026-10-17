import { describe, expect, it } from 'vitest'
import { parsePath, pathOf } from './router'

describe('page paths', () => {
  it('reads every tab', () => {
    for (const tab of ['system', 'surface', 'route', 'session', 'history', 'galaxy', 'stats'] as const) {
      expect(parsePath(`/${tab}`)).toEqual({ tab, address: null })
      expect(parsePath(`/${tab}/`)).toEqual({ tab, address: null })
    }
  })

  it('reads a system from the history', () => {
    expect(parsePath('/system/2931055102291')).toEqual({ tab: 'system', address: '2931055102291' })
  })

  it('has no page for the root or anything else', () => {
    expect(parsePath('/')).toBeNull()
    expect(parsePath('/nowhere')).toBeNull()
    expect(parsePath('/system/not-a-number')).toBeNull()
    expect(parsePath('/galaxy/123')).toBeNull()
    expect(parsePath('/system/1/2')).toBeNull()
  })

  it('writes paths back', () => {
    expect(pathOf({ tab: 'galaxy', address: null })).toBe('/galaxy')
    expect(pathOf({ tab: 'system', address: '42' })).toBe('/system/42')
    expect(pathOf({ tab: 'route', address: '42' })).toBe('/route')
    for (const path of ['/system', '/system/42', '/stats']) expect(pathOf(parsePath(path)!)).toBe(path)
  })
})

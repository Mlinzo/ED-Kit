import { describe, expect, it } from 'vitest'
import { fitsRole, ROLES, SHIP_ROLES } from './roles'
import { SKETCHES } from './sketches'

describe('ship roles', () => {
  it('names a role for every ship', () => {
    for (const symbol of Object.keys(SKETCHES)) expect(SHIP_ROLES[symbol]?.length, symbol).toBeGreaterThan(0)
    for (const role of ROLES) expect(Object.values(SHIP_ROLES).some((r) => r.includes(role)), role).toBe(true)
  })

  it('filters by any of a ship’s roles', () => {
    expect(fitsRole('diamondbackxl', 'combat')).toBe(true)
    expect(fitsRole('diamondbackxl', 'explorer')).toBe(true)
    expect(fitsRole('diamondbackxl', 'freighter')).toBe(false)
    expect(fitsRole('asp', 'explorer')).toBe(true)
    expect(fitsRole('unknown', 'all')).toBe(true)
    expect(fitsRole('unknown', 'combat')).toBe(false)
  })
})

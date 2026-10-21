import { describe, expect, it } from 'vitest'
import type { ShopCatalogView, ShopModuleView, ShopVariantView } from '../../api/types'
import { lookup, optionsFor, parseQuery, searchCatalog, variantFor } from './catalog'

const v = (symbol: string, size: number, rating: string, mount: ShopVariantView['mount'] = null, guidance: ShopVariantView['guidance'] = null): ShopVariantView => ({
  symbol,
  size,
  rating,
  mount,
  guidance,
})

const fsd: ShopModuleView = {
  name: 'Frame Shift Drive',
  category: 'core',
  unlock: null,
  variants: [v('fsd2e', 2, 'E'), v('fsd2a', 2, 'A'), v('fsd5d', 5, 'D'), v('fsd5a', 5, 'A')],
}
const mc: ShopModuleView = {
  name: 'Multi-Cannon',
  category: 'hardpoint',
  unlock: null,
  variants: [v('mc1f', 1, 'F', 'Fixed'), v('mc1g', 1, 'G', 'Gimballed'), v('mc2e', 2, 'E', 'Fixed'), v('mc2f', 2, 'F', 'Gimballed'), v('mc2t', 2, 'F', 'Turreted')],
}
const missiles: ShopModuleView = {
  name: 'Missile Rack',
  category: 'hardpoint',
  unlock: null,
  variants: [v('mrd', 2, 'B', 'Fixed', 'Dumbfire'), v('mrs', 2, 'B', 'Fixed', 'Seeker')],
}
const catalog: ShopCatalogView = {
  ships: [
    { symbol: 'anaconda', name: 'Anaconda' },
    { symbol: 'diamondbackxl', name: 'Diamondback Explorer' },
    { symbol: 'ferdelance', name: 'Fer-de-Lance' },
  ],
  modules: [fsd, { name: 'Frame Shift Drive (SCO)', category: 'core', unlock: null, variants: [v('sco5a', 5, 'A')] }, mc, missiles],
}

const names = (query: string) => searchCatalog(catalog, query).map((p) => (p.kind === 'ship' ? p.ship.name : p.module.name))

describe('shop catalog search', () => {
  it('finds by word starts, initials and aliases', () => {
    expect(names('conda')).toEqual(['Anaconda'])
    expect(names('dbx')).toEqual(['Diamondback Explorer'])
    expect(names('fdl')).toEqual(['Fer-de-Lance'])
    expect(names('fsd')).toEqual(['Frame Shift Drive', 'Frame Shift Drive (SCO)'])
    expect(names('multi')).toEqual(['Multi-Cannon'])
    expect(names('mc')).toEqual(['Multi-Cannon'])
    expect(names('')).toEqual([])
  })

  it('reads class, rating and mount from the query', () => {
    expect(parseQuery('FSD 5A')).toEqual({ words: ['fsd'], want: { size: 5, rating: 'A' } })
    expect(parseQuery('mc 2 gimballed')).toEqual({ words: ['mc'], want: { size: 2, mount: 'Gimballed' } })
    // A variant asked for: ships drop out, and so do modules without it.
    expect(names('fsd 2a')).toEqual(['Frame Shift Drive'])
    const [pick] = searchCatalog(catalog, 'fsd 5a')
    expect(pick.kind === 'module' && variantFor(pick.module, pick.want).symbol).toBe('fsd5a')
  })
})

describe('module variants', () => {
  it('keeps what is wanted when it exists, else the defaults', () => {
    expect(variantFor(fsd).symbol).toBe('fsd2a') // smallest class, best rating
    expect(variantFor(fsd, { size: 5, rating: 'D' }).symbol).toBe('fsd5d')
    expect(variantFor(fsd, { size: 5, rating: 'E' }).symbol).toBe('fsd5a') // no 5E
    expect(variantFor(mc, { size: 2, rating: 'F', mount: 'Turreted' }).symbol).toBe('mc2t')
    expect(variantFor(missiles, { guidance: 'Seeker' }).symbol).toBe('mrs')
    // Another class keeps the mount; another mount takes its own rating.
    expect(variantFor(mc, { size: 1, rating: 'F', mount: 'Gimballed' }).symbol).toBe('mc1g')
    expect(variantFor(mc, { size: 2, rating: 'E', mount: 'Turreted' }).symbol).toBe('mc2t')
  })

  it('offers the choices that exist for the chosen variant', () => {
    expect(optionsFor(fsd, variantFor(fsd, { size: 5 }))).toEqual({ sizes: [2, 5], mounts: [], ratings: ['A', 'D'], guidances: [] })
    // A weapon: the mounts of its class, and the rating that goes with the mount.
    expect(optionsFor(mc, variantFor(mc, { size: 2, rating: 'F' }))).toEqual({
      sizes: [1, 2],
      mounts: ['Fixed', 'Gimballed', 'Turreted'],
      ratings: ['F'],
      guidances: [],
    })
    expect(optionsFor(missiles, variantFor(missiles)).guidances).toEqual(['Dumbfire', 'Seeker'])
  })

  it('looks a stored symbol up', () => {
    expect(lookup(catalog, 'anaconda')).toMatchObject({ kind: 'ship' })
    expect(lookup(catalog, 'mc2t')).toMatchObject({ kind: 'module', variant: { mount: 'Turreted' } })
    expect(lookup(catalog, 'gone')).toBeNull()
  })
})

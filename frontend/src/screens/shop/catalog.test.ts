import { describe, expect, it } from 'vitest'
import type { ShopCatalogView, ShopModuleView, ShopVariantView } from '../../api/types'
import { commoditiesOf, commodityGroups, lookup, materialKind, materialRows, neighbour, nextModule, optionsFor, orderShips, parseQuery, searchCatalog, variantFor } from './catalog'

const v = (symbol: string, size: number, rating: string, mount: ShopVariantView['mount'] = null, guidance: ShopVariantView['guidance'] = null): ShopVariantView => ({
  symbol,
  size,
  rating,
  mount,
  guidance,
  price: null,
  mass: null,
  power: null,
  integrity: null,
  stats: {},
})

const fsd: ShopModuleView = {
  name: 'Frame Shift Drive',
  category: 'core',
  type: null,
  unlock: null,
  variants: [v('fsd2e', 2, 'E'), v('fsd2a', 2, 'A'), v('fsd5d', 5, 'D'), v('fsd5a', 5, 'A')],
}
const mc: ShopModuleView = {
  name: 'Multi-Cannon',
  category: 'hardpoint',
  type: null,
  unlock: null,
  variants: [v('mc1f', 1, 'F', 'Fixed'), v('mc1g', 1, 'G', 'Gimballed'), v('mc2e', 2, 'E', 'Fixed'), v('mc2f', 2, 'F', 'Gimballed'), v('mc2t', 2, 'F', 'Turreted')],
}
const missiles: ShopModuleView = {
  name: 'Missile Rack',
  category: 'hardpoint',
  type: null,
  unlock: null,
  variants: [v('mrd', 2, 'B', 'Fixed', 'Dumbfire'), v('mrs', 2, 'B', 'Fixed', 'Seeker')],
}
const catalog: ShopCatalogView = {
  ships: [
    { symbol: 'anaconda', name: 'Anaconda', stats: null, rank: null },
    { symbol: 'diamondbackxl', name: 'Diamondback Explorer', stats: null, rank: null },
    { symbol: 'ferdelance', name: 'Fer-de-Lance', stats: null, rank: null },
  ],
  modules: [fsd, { name: 'Frame Shift Drive (SCO)', category: 'core', type: null, unlock: null, variants: [v('sco5a', 5, 'A')] }, mc, missiles],
  commodities: [
    { symbol: 'gold', name: 'Gold', category: 'Metals', rare: false },
    { symbol: 'titanium', name: 'Titanium', category: 'Metals', rare: false },
    { symbol: 'lowtemperaturediamond', name: 'Low Temperature Diamonds', category: 'Minerals', rare: false },
    { symbol: 'lavianbrandy', name: 'Lavian Brandy', category: 'Legal Drugs', rare: true },
  ],
  materials: [
    { symbol: 'phosphorus', name: 'Phosphorus', type: 'raw', grade: 1, group: '2', sources: [], rich: 14.6 },
    { symbol: 'arsenic', name: 'Arsenic', type: 'raw', grade: 2, group: '6', sources: ['Outcrop'], rich: 2.5 },
    { symbol: 'mercury', name: 'Mercury', type: 'raw', grade: 3, group: '6', sources: [], rich: 0.9 },
    { symbol: 'heatvanes', name: 'Heat Vanes', type: 'manufactured', grade: 4, group: 'Heat', sources: [], rich: null },
    { symbol: 'guardian_powercell', name: 'Guardian Power Cell', type: 'manufactured', grade: 1, group: null, sources: [], rich: null },
  ],
}

const names = (query: string) =>
  searchCatalog(catalog, query).map((p) =>
    p.kind === 'ship' ? p.ship.name : p.kind === 'module' ? p.module.name : p.kind === 'commodity' ? p.commodity.name : p.material.name,
  )

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

  it('finds commodities, not when a module variant is asked for', () => {
    expect(names('titan')).toEqual(['Titanium'])
    expect(names('ltd')).toEqual(['Low Temperature Diamonds'])
    expect(names('brandy')).toEqual(['Lavian Brandy'])
    expect(names('gold 5a')).toEqual([])
  })
})

describe('materials', () => {
  it('are found by name and listed by kind, a row per trader group', () => {
    expect(names('arsen')).toEqual(['Arsenic'])
    expect(lookup(catalog, 'heatvanes')).toMatchObject({ kind: 'material', material: { grade: 4 } })
    expect(materialRows(catalog, 'raw').map((r) => [r.group, r.materials.map((m) => m.symbol)])).toEqual([
      ['2', ['phosphorus']],
      ['6', ['arsenic', 'mercury']],
    ])
    // No trader takes Guardian materials: a kind of their own, whatever their type.
    expect(materialKind(catalog.materials[4])).toBe('special')
    expect(materialRows(catalog, 'manufactured').map((r) => r.group)).toEqual(['Heat'])
  })
})

describe('commodity groups', () => {
  it('lists the market categories, the rare commodities apart and last', () => {
    expect(commodityGroups(catalog)).toEqual(['Metals', 'Minerals', 'Rare'])
    expect(commoditiesOf(catalog, 'Metals').map((c) => c.symbol)).toEqual(['gold', 'titanium'])
    expect(commoditiesOf(catalog, 'Rare').map((c) => c.symbol)).toEqual(['lavianbrandy'])
    expect(lookup(catalog, 'titanium')).toMatchObject({ kind: 'commodity', commodity: { name: 'Titanium' } })
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

describe('flipping through the catalog', () => {
  const ship = (symbol: string, name: string, price: number, pad: 'S' | 'M' | 'L') => ({
    symbol,
    name,
    rank: null,
    stats: { pad, price, speed: null, boost: null, shields: null, armour: null, mass: null, hardness: null, masslock: null, crew: null, core: [], internal: [], military: [], hardpoints: [], utility: 0, fighterBay: false },
  })
  const ships = [ship('anaconda', 'Anaconda', 146_000_000, 'L'), ship('adder', 'Adder', 87_000, 'S'), ship('python', 'Python', 57_000_000, 'M')]

  it('orders ships by name, price or size', () => {
    expect(orderShips(ships, 'name').map((s) => s.symbol)).toEqual(['adder', 'anaconda', 'python'])
    expect(orderShips(ships, 'price').map((s) => s.symbol)).toEqual(['adder', 'python', 'anaconda'])
    expect(orderShips(ships, 'size').map((s) => s.symbol)).toEqual(['adder', 'python', 'anaconda'])
  })

  it('wraps round both ways', () => {
    expect(neighbour([1, 2, 3], 3, 1)).toBe(1)
    expect(neighbour([1, 2, 3], 1, -1)).toBe(3)
    expect(neighbour([1, 2, 3], 9, 1)).toBe(1)
    expect(neighbour([], 1, 1)).toBeUndefined()
  })

  it('keeps the class and rating on the next module of the group', () => {
    // Frame Shift Drive -> Frame Shift Drive (SCO): 5A carries over.
    expect(nextModule(catalog, fsd, variantFor(fsd, { size: 5, rating: 'A' }), 1)?.symbol).toBe('sco5a')
    // The last core module wraps round to the first, still 5A.
    expect(nextModule(catalog, catalog.modules[1], variantFor(catalog.modules[1]), 1)?.symbol).toBe('fsd5a')
  })
})

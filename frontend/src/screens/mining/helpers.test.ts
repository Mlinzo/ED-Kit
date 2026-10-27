import { describe, expect, it } from 'vitest'
import type { MiningBuyerView } from '../../api/types'
import { buyersFiltered, miningParams, NO_FILTERS, orderBuyers, parseFilters, ringParts, ringsFiltered, type MiningFilters } from './helpers'

const buyer = (station: string, price: number, distanceLy: number, demand: number): MiningBuyerView => ({
  station,
  kind: 'starport',
  systemName: 'Lave',
  systemAddress: null,
  distanceLy,
  jumps: null,
  distLs: null,
  pad: 'L',
  price,
  demand,
  marketAt: null,
  permit: false,
  access: null,
})

describe('buyers in order', () => {
  const buyers = [buyer('Far floor', 211_587, 90, 50_000), buyer('Best', 528_968, 40, 1_666), buyer('Near floor', 211_587, 5, 400)]

  it('the best price first, the nearest of equal prices first', () => {
    expect(orderBuyers(buyers, 'price').map((b) => b.station)).toEqual(['Best', 'Near floor', 'Far floor'])
  })

  it('the nearest first', () => {
    expect(orderBuyers(buyers, 'distance').map((b) => b.station)).toEqual(['Near floor', 'Best', 'Far floor'])
  })

  it('the largest demand first', () => {
    expect(orderBuyers(buyers, 'demand').map((b) => b.station)).toEqual(['Far floor', 'Best', 'Near floor'])
  })

  it('leaves the list it was given as it was', () => {
    orderBuyers(buyers, 'distance')
    expect(buyers.map((b) => b.station)).toEqual(['Far floor', 'Best', 'Near floor'])
  })
})

describe('ring names', () => {
  it('split into the body to fly to and the ring', () => {
    const ring = (name: string, body: string, systemName: string) => ringParts({ name, body, systemName })
    expect(ring('12 G. Canis Minoris ABC 1 A Ring', '12 G. Canis Minoris ABC 1', '12 G. Canis Minoris')).toEqual({ body: 'ABC 1', ring: 'A' })
    expect(ring("Barnard's Star 5 B Ring", "Barnard's Star 5", "Barnard's Star")).toEqual({ body: '5', ring: 'B' })
    expect(ring('Disobey 1 A Ring', 'Disobey 1', 'Diso')).toEqual({ body: 'Disobey 1', ring: 'A' })
  })

  it('keep a ring named otherwise whole', () => {
    expect(ringParts({ name: 'Hutton Ring', body: 'Hutton', systemName: 'Diso' })).toEqual({ body: 'Hutton', ring: null })
  })
})

describe('filters', () => {
  const all: MiningFilters = { reserves: ['Major', 'Pristine'], ringLs: 5_000, demand: 'hold', freshDays: 7, stationLs: 1_000 }

  it('ask for nothing more when none is set', () => {
    expect(miningParams('painite', false, NO_FILTERS, 720)).toEqual({ item: 'painite' })
    expect(miningParams(null, true, all, 720)).toEqual({ carriers: 'true' })
  })

  it('go into the query, reserves from the most', () => {
    expect(miningParams('painite', true, all, 720)).toEqual({
      item: 'painite',
      carriers: 'true',
      reserves: 'Pristine,Major',
      ringLs: '5000',
      demand: '720',
      freshDays: '7',
      stationLs: '1000',
    })
    expect(miningParams('painite', false, { ...NO_FILTERS, demand: 5_000 }, null)).toEqual({ item: 'painite', demand: '5000' })
  })

  it('leave the hold out until it is known', () => {
    expect(miningParams('painite', false, { ...NO_FILTERS, demand: 'hold' }, null)).toEqual({ item: 'painite' })
  })

  it('come back from the browser as they were, anything else as none', () => {
    expect(parseFilters(JSON.stringify(all))).toEqual({ ...all, reserves: ['Pristine', 'Major'] })
    expect(parseFilters(null)).toEqual(NO_FILTERS)
    expect(parseFilters('not json')).toEqual(NO_FILTERS)
    expect(parseFilters(JSON.stringify({ reserves: ['Pristine', 'Rich'], ringLs: 123, demand: 'lots', freshDays: 7 }))).toEqual({
      ...NO_FILTERS,
      reserves: ['Pristine'],
      freshDays: 7,
    })
  })

  it('tell which list they narrow', () => {
    expect([ringsFiltered(NO_FILTERS), buyersFiltered(NO_FILTERS)]).toEqual([false, false])
    expect([ringsFiltered({ ...NO_FILTERS, ringLs: 1_000 }), buyersFiltered({ ...NO_FILTERS, freshDays: 1 })]).toEqual([true, true])
  })
})

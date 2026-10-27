import { describe, expect, it } from 'vitest'
import type { MiningBuyerView } from '../../api/types'
import { orderBuyers, ringLabel } from './helpers'

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
  it('drop the system name they start with', () => {
    expect(ringLabel({ name: 'Diso 5 A Ring', systemName: 'Diso' })).toBe('5 A Ring')
    expect(ringLabel({ name: "Barnard's Star 5 B Ring", systemName: "Barnard's Star" })).toBe('5 B Ring')
  })

  it('stay whole when named otherwise', () => {
    expect(ringLabel({ name: 'Hutton Ring', systemName: 'Diso' })).toBe('Hutton Ring')
    expect(ringLabel({ name: 'Disobey 1 A Ring', systemName: 'Diso' })).toBe('Disobey 1 A Ring')
  })
})

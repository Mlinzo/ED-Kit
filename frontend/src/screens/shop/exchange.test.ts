import { describe, expect, it } from 'vitest'
import type { ShopMaterialView } from '../../api/types'
import { offers, rate, total } from './exchange'

const m = (symbol: string, type: ShopMaterialView['type'], grade: number, group: string | null): ShopMaterialView => ({
  symbol,
  name: symbol,
  type,
  grade,
  group,
  sources: [],
  rich: null,
})

const cadmium = m('cadmium', 'raw', 3, '3')
const arsenic = m('arsenic', 'raw', 2, '6')
const storage = m('chemicalstorageunits', 'manufactured', 1, 'Chemical')
const processors = m('chemicalprocessors', 'manufactured', 2, 'Chemical')
const distillery = m('chemicaldistillery', 'manufactured', 3, 'Chemical')
const manipulators = m('chemicalmanipulators', 'manufactured', 4, 'Chemical')
const isolators = m('pharmaceuticalisolators', 'manufactured', 5, 'Chemical')
const sensors = m('shieldingsensors', 'manufactured', 3, 'Shielding')
const protoLight = m('protolightalloys', 'manufactured', 4, 'Alloys')
const exchangers = m('heatexchangers', 'manufactured', 3, 'Heat')
const guardian = m('guardian_sentinel_wreckagecomponents', 'manufactured', 1, null)
const catalog = [cadmium, arsenic, storage, processors, distillery, manipulators, isolators, sensors, protoLight, exchangers, guardian]

describe('trade rates', () => {
  it('match the trades in the journal', () => {
    // 2026-10-27: 10 Cadmium for 5 Arsenic, 6 Shielding Sensors for 1 Chemical Distillery,
    // 6 Proto Light Alloys for 1 Chemical Manipulators.
    expect(rate(cadmium, arsenic)).toEqual({ give: 2, get: 1 })
    expect(rate(sensors, distillery)).toEqual({ give: 6, get: 1 })
    expect(rate(protoLight, manipulators)).toEqual({ give: 6, get: 1 })
  })

  it('multiply a grade up (6), a grade down (3) and another category (6)', () => {
    expect(rate(distillery, manipulators)).toEqual({ give: 6, get: 1 })
    expect(rate(storage, manipulators)).toEqual({ give: 216, get: 1 })
    expect(rate(manipulators, processors)).toEqual({ give: 1, get: 9 })
    expect(rate(exchangers, manipulators)).toEqual({ give: 36, get: 1 })
    expect(rate(protoLight, processors)).toEqual({ give: 2, get: 3 })
  })
})

describe('offers', () => {
  it('lists your materials of the type, the ones giving most first', () => {
    const stock = { manipulators: 0, chemicaldistillery: 12, protolightalloys: 18, heatexchangers: 40, chemicalstorageunits: 90, arsenic: 50, guardian_sentinel_wreckagecomponents: 9 }
    const list = offers(manipulators, catalog, stock)
    expect(list.map((o) => [o.material.symbol, o.gives])).toEqual([
      ['protolightalloys', 3],
      ['chemicaldistillery', 2],
      ['heatexchangers', 1],
      ['chemicalstorageunits', 0],
    ])
    expect(total(manipulators, list, stock)).toBe(6)
  })

  it('give no more than the room for it, in whole trades', () => {
    // 148 of 150 Chemical Manipulators: room for 2; Pharmaceutical Isolators give 3 a trade.
    const stock = { chemicalmanipulators: 148, pharmaceuticalisolators: 5, chemicaldistillery: 60 }
    const list = offers(manipulators, catalog, stock)
    expect(list.map((o) => [o.material.symbol, o.gives])).toEqual([
      ['chemicaldistillery', 2],
      ['pharmaceuticalisolators', 0],
    ])
    expect(total(manipulators, list, stock)).toBe(2)
  })

  it('are none for what no trader takes', () => {
    expect(offers(guardian, catalog, { chemicalstorageunits: 90 })).toEqual([])
  })
})

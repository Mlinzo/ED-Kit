// Demo answers of the Shop tab (?mock=1): the shops near Colonia, and a few of them for any item.

import type { ShopPlaceView, ShopStationView, ShopView } from '../api/types'

const daysAgo = (d: number, now: number) => new Date(now - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

function station(name: string, kind: ShopStationView['kind'], distLs: number, extra: Partial<ShopStationView>): ShopStationView {
  return { name, kind, distLs, price: null, offerAt: null, access: null, permit: false, shipCount: null, moduleCount: null, ...extra }
}

export function buildShop(item: string | null, carriers: boolean, now = Date.now()): ShopView {
  const shops = !item
  const price = (base: number) => (shops ? null : base)
  const counts = (ships: number | null, modules: number | null) => (shops ? { shipCount: ships, moduleCount: modules } : {})
  const places: ShopPlaceView[] = [
    {
      systemName: 'Colonia',
      systemAddress: '3238296097059',
      distanceLy: 0,
      jumps: 0,
      stations: [
        station('Jaques Station', 'starport', 2_190, { price: price(5_103_950), offerAt: daysAgo(1, now), ...counts(31, 742) }),
        station('Colonia Hub', 'outpost', 3_402, { price: price(5_103_950), offerAt: daysAgo(3, now), ...counts(null, 388) }),
      ],
      more: 0,
    },
    {
      systemName: 'Ratraii',
      systemAddress: '5031654888146',
      distanceLy: 14.3,
      jumps: 1,
      stations: [station('Hillary Depot', 'starport', 512, { price: price(4_338_357), offerAt: daysAgo(48, now), ...counts(17, 610) })],
      more: 1,
    },
    {
      systemName: 'Eol Prou LW-L c8-198',
      systemAddress: '45601000154',
      distanceLy: 22.8,
      jumps: 1,
      stations: [station('Morten-Marrero Prospect', 'planetary', 88, { price: price(5_103_950), offerAt: daysAgo(6, now), ...counts(0, 205) })],
      more: 0,
    },
  ]
  if (carriers)
    places.splice(1, 0, {
      systemName: 'Colonia',
      systemAddress: '3238296097059x',
      distanceLy: 0.1,
      jumps: 0,
      stations: [station('K7Q-2VZ', 'carrier', 30, { price: price(5_200_000), offerAt: daysAgo(2, now), access: 'all', ...counts(4, 120) })],
      more: 0,
    })
  return {
    state: 'ready',
    item: item ? 'Frame Shift Drive 5A' : null,
    ship: 'Mandalay',
    pad: 'M',
    carriers,
    places,
    nearerCarrier: null,
    rank: null,
    unlock: null,
    searchedAt: daysAgo(0.01, now),
  }
}

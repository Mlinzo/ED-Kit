// Demo answers of the Mining tab (?mock=1): rings and markets around Colonia, the same for any
// commodity (its name and price scale change), narrowed by the filters as the server does.

import type { MiningBuyerView, MiningCommodityView, MiningRingView, MiningView } from '../api/types'

const COMMODITIES: [symbol: string, name: string, price: number][] = [
  ['platinum', 'Platinum', 248_000],
  ['painite', 'Painite', 211_587],
  ['lowtemperaturediamond', 'Low Temperature Diamonds', 180_000],
  ['opal', 'Void Opal', 520_000],
  ['osmium', 'Osmium', 42_000],
  ['alexandrite', 'Alexandrite', 210_000],
  ['benitoite', 'Benitoite', 160_000],
  ['grandidierite', 'Grandidierite', 190_000],
  ['monazite', 'Monazite', 290_000],
  ['musgravite', 'Musgravite', 230_000],
  ['rhodplumsite', 'Rhodplumsite', 250_000],
  ['serendibite', 'Serendibite', 240_000],
  ['bromellite', 'Bromellite', 60_000],
  ['tritium', 'Tritium', 52_000],
]

const daysAgo = (d: number, now: number) => new Date(now - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

function buyer(station: string, systemName: string, distanceLy: number, price: number, demand: number, extra: Partial<MiningBuyerView>): MiningBuyerView {
  return {
    station,
    kind: 'starport',
    systemName,
    systemAddress: null,
    distanceLy,
    jumps: distanceLy < 0.5 ? 0 : Math.ceil(distanceLy / 30),
    distLs: 800,
    pad: 'L',
    price,
    demand,
    marketAt: null,
    permit: false,
    access: null,
    ...extra,
  }
}

export function buildMining(query: URLSearchParams, now = Date.now()): MiningView {
  const item = query.get('item')
  const carriers = query.get('carriers') === 'true'
  const limit = (key: string) => (query.get(key) === null ? Infinity : Number(query.get(key)))
  const reserves = query.get('reserves')?.split(',') ?? []
  const commodities: MiningCommodityView[] = COMMODITIES.map(([symbol, name]) => ({ symbol, name, hotspots: symbol !== 'osmium' }))
  const chosen = COMMODITIES.find(([symbol]) => symbol === item)
  const empty: MiningView = {
    state: 'ready',
    commodities,
    item: null,
    name: null,
    hotspots: false,
    ship: 'Type-9 Heavy',
    pad: 'L',
    carriers,
    buyers: [],
    betterCarrier: null,
    rings: [],
    trip: null,
    searchedAt: null,
    reachLy: 500,
    cargo: 720,
  }
  if (!item) return empty
  if (!chosen) return { ...empty, state: 'unknown_item' }
  const [symbol, name, floor] = chosen
  const price = (x: number) => Math.round(floor * x)
  const carrier = buyer('K7Q-B2X', 'Ratraii', 14.3, price(2.6), 3_000, { kind: 'carrier', distLs: 12, access: 'all', marketAt: daysAgo(2, now) })
  const stations = [
    buyer('Jaques Station', 'Colonia', 0, price(1), 12_400, { distLs: 2_190, marketAt: daysAgo(0.1, now) }),
    buyer('Colonia Hub', 'Colonia', 0, price(1), 3_100, { kind: 'outpost', distLs: 3_402, pad: 'M', marketAt: daysAgo(0.3, now) }),
    buyer('Hillary Depot', 'Ratraii', 14.3, price(1.42), 1_666, { distLs: 512, marketAt: daysAgo(1, now) }),
    buyer('Morten-Marrero Prospect', 'Eol Prou LW-L c8-198', 22.8, price(1.05), 640, { kind: 'planetary', distLs: 88, marketAt: daysAgo(48, now) }),
    buyer('Vonarburg Co-operative', 'Kojeara', 31.6, price(1.18), 9_800, { distLs: 1_050, marketAt: daysAgo(4, now) }),
    buyer('Pinzon Hub', 'Tir', 41.2, price(1), 22_000, { distLs: 4_900, marketAt: daysAgo(0.5, now), permit: true }),
  ]
  const wanted = (b: MiningBuyerView) =>
    b.demand >= limit('demand') &&
    (b.distLs ?? 0) <= limit('stationLs') &&
    (b.marketAt === null || now - Date.parse(b.marketAt) <= limit('freshDays') * 86_400_000)
  const buyers = (carriers ? [carrier, ...stations] : [...stations]).filter(wanted).sort((a, b) => b.price - a.price || a.distanceLy - b.distanceLy)
  const sell = (b: MiningBuyerView, ly: number) => ({ station: b.station, systemName: b.systemName, distanceLy: ly, price: b.price })
  const ring = (n: string, systemName: string, distanceLy: number, count: number, extra: Partial<MiningRingView>): MiningRingView => ({
    name: `${systemName} ${n}`,
    body: `${systemName} ${n.split(' ')[0]}`,
    systemName,
    systemAddress: null,
    distanceLy,
    jumps: distanceLy < 0.5 ? 0 : Math.ceil(distanceLy / 30),
    distLs: 1_200,
    type: 'Metallic',
    reserve: 'Pristine',
    count,
    others: [],
    reportedAt: daysAgo(9, now),
    sell: null,
    ...extra,
  })
  const hillary = stations[2]
  const rings =
    symbol === 'osmium'
      ? []
      : [
          ring('4 A Ring', 'Ratraii', 14.3, 2, { others: [{ name: 'Monazite', count: 1 }], sell: sell(hillary, 0) }),
          ring('7 A Ring', 'Kojeara', 31.6, 1, { type: 'Metal Rich', reserve: 'Major', sell: sell(stations[4], 0) }),
          ring('2 B Ring', 'Eol Prou LW-L c8-198', 22.8, 3, { type: 'Icy', reserve: 'Common', distLs: 310, sell: sell(stations[3], 0), reportedAt: daysAgo(120, now) }),
        ]
          .filter((r) => (!reserves.length || reserves.includes(r.reserve ?? '')) && (r.distLs ?? 0) <= limit('ringLs'))
          .sort((a, b) => a.distanceLy - b.distanceLy)
  const nearest = rings.at(0)
  return {
    ...empty,
    item: symbol,
    name,
    hotspots: symbol !== 'osmium',
    buyers,
    betterCarrier: carriers || !wanted(carrier) ? null : carrier,
    rings,
    trip: nearest?.sell
      ? { ring: nearest.name, systemName: nearest.systemName, distanceLy: nearest.distanceLy, sell: nearest.sell, totalLy: nearest.distanceLy + nearest.sell.distanceLy }
      : null,
    searchedAt: daysAgo(0.01, now),
  }
}

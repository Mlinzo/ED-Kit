import type { MiningBuyerView, MiningRingView } from '../../api/types'

export const BUYER_ORDERS = ['price', 'distance', 'demand'] as const
export type BuyerOrder = (typeof BUYER_ORDERS)[number]

const BY: Record<BuyerOrder, (a: MiningBuyerView, b: MiningBuyerView) => number> = {
  price: (a, b) => b.price - a.price || a.distanceLy - b.distanceLy,
  distance: (a, b) => a.distanceLy - b.distanceLy || b.price - a.price,
  demand: (a, b) => b.demand - a.demand || b.price - a.price,
}

/** The buyers in the chosen order (a copy). */
export const orderBuyers = (buyers: readonly MiningBuyerView[], order: BuyerOrder): MiningBuyerView[] => [...buyers].sort(BY[order])

/** A ring as the body to fly to (without the system's name) and the ring's letter ("ABC 1 A Ring":
 *  "ABC 1" and "A", not a body "ABC 1 A"); `ring` is null for a ring named otherwise. */
export function ringParts(ring: Pick<MiningRingView, 'name' | 'body' | 'systemName'>): { body: string; ring: string | null } {
  const system = `${ring.systemName} `
  const body = ring.body.startsWith(system) ? ring.body.slice(system.length) : ring.body
  const letter = ring.name.startsWith(`${ring.body} `) ? /^([A-Z]) Ring$/.exec(ring.name.slice(ring.body.length + 1)) : null
  return { body, ring: letter ? letter[1] : null }
}

/** A body's reserves, the most first (Spansh's names). */
export const RESERVES = ['Pristine', 'Major', 'Common', 'Low', 'Depleted'] as const
export type Reserve = (typeof RESERVES)[number]
/** Choices of how far from the arrival star, Ls (rings and markets). */
export const LS_LIMITS = [1_000, 5_000, 20_000] as const
/** Choices of the least demand, t ('hold': your ship's hold). */
export const DEMAND_LIMITS = [1_000, 5_000, 10_000] as const
/** Choices of how old a market's report may be, days. */
export const FRESH_DAYS = [1, 3, 7, 30] as const

export interface MiningFilters {
  /** None: any. */
  reserves: Reserve[]
  ringLs: number | null
  demand: 'hold' | number | null
  freshDays: number | null
  stationLs: number | null
}

export const NO_FILTERS: MiningFilters = { reserves: [], ringLs: null, demand: null, freshDays: null, stationLs: null }

const oneOf = (value: unknown, allowed: readonly number[]): number | null =>
  typeof value === 'number' && allowed.includes(value) ? value : null

/** Filters kept in the browser, checked: anything unknown is no filter. */
export function parseFilters(text: string | null): MiningFilters {
  let raw: unknown
  try {
    raw = JSON.parse(text ?? 'null')
  } catch {
    return NO_FILTERS
  }
  if (!raw || typeof raw !== 'object') return NO_FILTERS
  const f = raw as Record<string, unknown>
  const reserves = Array.isArray(f.reserves) ? RESERVES.filter((r) => (f.reserves as unknown[]).includes(r)) : []
  return {
    reserves,
    ringLs: oneOf(f.ringLs, LS_LIMITS),
    demand: f.demand === 'hold' ? 'hold' : oneOf(f.demand, DEMAND_LIMITS),
    freshDays: oneOf(f.freshDays, FRESH_DAYS),
    stationLs: oneOf(f.stationLs, LS_LIMITS),
  }
}

export const ringsFiltered = (f: MiningFilters) => f.reserves.length > 0 || f.ringLs !== null
export const buyersFiltered = (f: MiningFilters) => f.demand !== null || f.freshDays !== null || f.stationLs !== null

/** The view's query: the commodity, carriers and the filters set (the hold: your ship's, once known). */
export function miningParams(item: string | null, carriers: boolean, f: MiningFilters, cargo: number | null): Record<string, string> {
  const params: Record<string, string> = {}
  if (item) params.item = item
  if (carriers) params.carriers = 'true'
  if (!item) return params
  if (f.reserves.length) params.reserves = RESERVES.filter((r) => f.reserves.includes(r)).join(',')
  if (f.ringLs !== null) params.ringLs = String(f.ringLs)
  const demand = f.demand === 'hold' ? cargo : f.demand
  if (demand !== null) params.demand = String(demand)
  if (f.freshDays !== null) params.freshDays = String(f.freshDays)
  if (f.stationLs !== null) params.stationLs = String(f.stationLs)
  return params
}

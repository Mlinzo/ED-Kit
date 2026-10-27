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

/** A ring's name without the system's name it starts with: "5 A Ring". */
export function ringLabel(ring: Pick<MiningRingView, 'name' | 'systemName'>): string {
  const prefix = `${ring.systemName} `
  return ring.name.startsWith(prefix) ? ring.name.slice(prefix.length) : ring.name
}

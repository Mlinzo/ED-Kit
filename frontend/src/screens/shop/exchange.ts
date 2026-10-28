// Material traders: which of your materials a trader takes for the one you want, at what rate,
// and how many of it they give. Rates (Elite Dangerous Wiki, Material Trader): one grade lower
// gives 3, one grade higher takes 6, another category takes 6, and these multiply; a trader
// deals in one type (raw, manufactured, encoded) only.

import type { ShopMaterialView } from '../../api/types'

/** Materials of each grade you can hold. */
export const CAPACITY: Readonly<Record<number, number>> = { 1: 300, 2: 250, 3: 200, 4: 150, 5: 100 }

/** A trade: give so many of one material, get so many of another (in lowest terms). */
export interface Rate {
  give: number
  get: number
}

/** One of your materials a trader takes for the wanted one. */
export interface Offer {
  material: ShopMaterialView
  have: number
  rate: Rate
  /** How many of the wanted one all of it gives (0: not enough for one trade, or no room). */
  gives: number
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** What a trader takes of `from` for `to` (both of one type, both traded). */
export function rate(from: ShopMaterialView, to: ShopMaterialView): Rate {
  const step = to.grade - from.grade
  const give = 6 ** Math.max(step, 0) * (from.group === to.group ? 1 : 6)
  const get = 3 ** Math.max(-step, 0)
  const d = gcd(give, get)
  return { give: give / d, get: get / d }
}

/** Room left for a material: its grade's storage minus what you have. */
export const room = (m: ShopMaterialView, stock: Readonly<Record<string, number>>): number =>
  Math.max(0, (CAPACITY[m.grade] ?? 0) - (stock[m.symbol] ?? 0))

/**
 * Your materials a trader takes for `wanted`: the ones giving most first, then the better rate.
 * Empty when no trader takes it (Guardian, Thargoid).
 */
export function offers(wanted: ShopMaterialView, materials: readonly ShopMaterialView[], stock: Readonly<Record<string, number>>): Offer[] {
  if (wanted.group === null) return []
  const space = room(wanted, stock)
  return materials
    .filter((m) => m.type === wanted.type && m.group !== null && m.symbol !== wanted.symbol && (stock[m.symbol] ?? 0) > 0)
    .map((material) => {
      const have = stock[material.symbol]
      const r = rate(material, wanted)
      // Trades come whole: a trader that gives 3 for 1 does not give 2.
      const gives = Math.floor(Math.min(Math.floor(have / r.give) * r.get, space) / r.get) * r.get
      return { material, have, rate: r, gives }
    })
    .sort((a, b) => b.gives - a.gives || a.rate.give / a.rate.get - b.rate.give / b.rate.get || a.material.name.localeCompare(b.material.name))
}

/** How many of `wanted` all your offers give together, within the room for it. */
export const total = (wanted: ShopMaterialView, list: readonly Offer[], stock: Readonly<Record<string, number>>): number =>
  Math.min(
    room(wanted, stock),
    list.reduce((sum, o) => sum + o.gives, 0),
  )

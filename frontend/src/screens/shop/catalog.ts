// The Shop tab's catalog: finding ships and modules by words, and the variants of a module
// (class, rating, mount, missile guidance) as the buttons choose them.

import type { ShopCatalogView, ShopModuleView, ShopShipView, ShopVariantView } from '../../api/types'

export type Pick = { kind: 'ship'; ship: ShopShipView } | { kind: 'module'; module: ShopModuleView; want: Want }

/** Variant attributes asked for; what is missing takes a default. */
export interface Want {
  size?: number
  rating?: string
  mount?: ShopVariantView['mount']
  guidance?: ShopVariantView['guidance']
}

/** Names players use that the words of a name do not give. */
const ALIASES: Record<string, string> = {
  dbx: 'diamondback explorer',
  dbs: 'diamondback scout',
  aspx: 'asp explorer',
  conda: 'anaconda',
  vette: 'federal corvette',
  srv: 'planetary vehicle hangar',
  scoop: 'fuel scoop',
}

const MOUNTS: Record<string, NonNullable<Want['mount']>> = { fix: 'Fixed', gim: 'Gimballed', tur: 'Turreted' }

function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s\-()]+/)
    .filter(Boolean)
}

/** How well one query word fits a name: 0 not at all, 1 inside a word, 2 a word's start, 3 a whole word. */
function fit(word: string, name: string): number {
  const parts = words(name)
  if (parts.includes(word)) return 3
  if (parts.some((p) => p.startsWith(word))) return 2
  const initials = parts.map((p) => p[0]).join('')
  if (word.length >= 2 && initials.startsWith(word)) return 2
  if (word.length >= 3 && name.toLowerCase().includes(word)) return 1
  return 0
}

/** The query split into name words and variant words ("5a", "5", "gimballed"). */
export function parseQuery(query: string): { words: string[]; want: Want } {
  const want: Want = {}
  const rest: string[] = []
  for (const raw of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const word = ALIASES[raw] ?? raw
    const sizeRating = /^(\d)([a-i])$/.exec(word)
    const mount = Object.entries(MOUNTS).find(([prefix]) => word.length >= 3 && word.startsWith(prefix))
    if (sizeRating) {
      want.size = Number(sizeRating[1])
      want.rating = sizeRating[2].toUpperCase()
    } else if (/^\d$/.test(word)) want.size = Number(word)
    else if (mount) want.mount = mount[1]
    else rest.push(...word.split(' '))
  }
  return { words: rest, want }
}

function score(name: string, query: readonly string[]): number {
  let total = 0
  for (const word of query) {
    const f = fit(word, name)
    if (f === 0) return 0
    total += f
  }
  return total
}

function hasVariant(module: ShopModuleView, want: Want): boolean {
  return module.variants.some(
    (v) =>
      (want.size === undefined || v.size === want.size) &&
      (want.rating === undefined || v.rating === want.rating) &&
      (want.mount === undefined || v.mount === want.mount),
  )
}

/** Ships and modules matching the query, the best first. */
export function searchCatalog(catalog: ShopCatalogView, query: string, limit = 12): Pick[] {
  const { words: query_, want } = parseQuery(query)
  if (query_.length === 0) return []
  const variant = want.size !== undefined || want.rating !== undefined || want.mount !== undefined
  const found: { pick: Pick; score: number }[] = []
  if (!variant) {
    for (const ship of catalog.ships) {
      const s = score(ship.name, query_)
      if (s > 0) found.push({ pick: { kind: 'ship', ship }, score: s })
    }
  }
  for (const module of catalog.modules) {
    const s = score(module.name, query_)
    if (s > 0 && hasVariant(module, want)) found.push({ pick: { kind: 'module', module, want }, score: s })
  }
  const nameOf = (p: Pick) => (p.kind === 'ship' ? p.ship.name : p.module.name)
  found.sort((a, b) => b.score - a.score || nameOf(a.pick).length - nameOf(b.pick).length || nameOf(a.pick).localeCompare(nameOf(b.pick)))
  return found.slice(0, limit).map((f) => f.pick)
}

const RATINGS = 'ABCDEFGHI'
const MOUNT_ORDER: readonly ShopVariantView['mount'][] = [null, 'Fixed', 'Gimballed', 'Turreted']
const GUIDANCE_ORDER: readonly ShopVariantView['guidance'][] = [null, 'Dumbfire', 'Seeker']

/**
 * The variant closest to what is wanted. Class counts most, then the mount (a weapon's rating
 * follows from its mount), then the rating and the guidance; ties go to the smallest class, the
 * first mount, the best rating, the first guidance.
 */
export function variantFor(module: ShopModuleView, want: Want = {}): ShopVariantView {
  const score = (v: ShopVariantView) =>
    (want.size === v.size ? 8 : 0) +
    (want.mount !== undefined && want.mount === v.mount ? 4 : 0) +
    (want.rating === v.rating ? 2 : 0) +
    (want.guidance !== undefined && want.guidance === v.guidance ? 1 : 0)
  const rank = (v: ShopVariantView) => [-score(v), v.size, MOUNT_ORDER.indexOf(v.mount), RATINGS.indexOf(v.rating), GUIDANCE_ORDER.indexOf(v.guidance)]
  return [...module.variants].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)]
    const i = ra.findIndex((x, k) => x !== rb[k])
    return i < 0 ? 0 : ra[i] - rb[i]
  })[0]
}

/** The buttons for a module: every class; for the chosen class its mounts, then the ratings, then the guidance. */
export function optionsFor(module: ShopModuleView, chosen: ShopVariantView) {
  const uniq = <T>(values: T[]) => [...new Set(values)]
  const sizes = uniq(module.variants.map((v) => v.size)).sort((a, b) => a - b)
  const sized = module.variants.filter((v) => v.size === chosen.size)
  const mounts = uniq(sized.map((v) => v.mount))
    .filter((m) => m !== null)
    .sort((a, b) => MOUNT_ORDER.indexOf(a) - MOUNT_ORDER.indexOf(b))
  const mounted = sized.filter((v) => v.mount === chosen.mount)
  const ratings = uniq(mounted.map((v) => v.rating)).sort((a, b) => RATINGS.indexOf(a) - RATINGS.indexOf(b))
  const rated = mounted.filter((v) => v.rating === chosen.rating)
  const guidances = uniq(rated.map((v) => v.guidance)).filter((g) => g !== null)
  return { sizes, mounts, ratings, guidances }
}

/** What a stored symbol stands for (null: not in the catalog). */
export function lookup(
  catalog: ShopCatalogView,
  symbol: string,
): { kind: 'ship'; ship: ShopShipView } | { kind: 'module'; module: ShopModuleView; variant: ShopVariantView } | null {
  const ship = catalog.ships.find((s) => s.symbol === symbol)
  if (ship) return { kind: 'ship', ship }
  for (const module of catalog.modules) {
    const variant = module.variants.find((v) => v.symbol === symbol)
    if (variant) return { kind: 'module', module, variant }
  }
  return null
}

export type ShipOrder = 'name' | 'price' | 'size'
export const SHIP_ORDERS: readonly ShipOrder[] = ['price', 'name', 'size']
const PAD_RANK = { S: 0, M: 1, L: 2 }

/** Ships in the order the card flips through: by name, by base price, or by landing pad then price. */
export function orderShips(ships: readonly ShopShipView[], order: ShipOrder): ShopShipView[] {
  const price = (s: ShopShipView) => s.stats?.price ?? Number.MAX_SAFE_INTEGER
  const pad = (s: ShopShipView) => (s.stats?.pad ? PAD_RANK[s.stats.pad] : 3)
  return [...ships].sort((a, b) => {
    if (order === 'price') return price(a) - price(b) || a.name.localeCompare(b.name)
    if (order === 'size') return pad(a) - pad(b) || price(a) - price(b) || a.name.localeCompare(b.name)
    return a.name.localeCompare(b.name)
  })
}

/** The item `step` places away in a list, wrapping round (the first one when `current` is not in it). */
export function neighbour<T>(list: readonly T[], current: T | undefined, step: number): T | undefined {
  if (list.length === 0) return undefined
  const i = current === undefined ? -1 : list.indexOf(current)
  if (i < 0) return list[0]
  return list[(((i + step) % list.length) + list.length) % list.length]
}

/** Flipping to the next module of the same group keeps the variant where the module has it. */
export function nextModule(catalog: ShopCatalogView, module: ShopModuleView, variant: ShopVariantView, step: number): ShopVariantView | undefined {
  const group = catalog.modules.filter((m) => m.category === module.category)
  const next = neighbour(group, module, step)
  return next ? variantFor(next, variant) : undefined
}

// First discoveries / first maps / first footfalls: filtering and grouping by system.
import type { FirstEntry, FirstState } from '../../api/types'

export type MarkKind = 'discovered' | 'mapped' | 'footfall'
export type FirstsFilter = 'all' | MarkKind

export const MARK_KINDS: readonly MarkKind[] = ['discovered', 'mapped', 'footfall']

export function hasMark(e: FirstEntry, kind: MarkKind): boolean {
  if (kind === 'footfall') return e.footfallAt !== null
  return e[kind] !== null
}

/** How many entries carry each mark. */
export function markCounts(entries: readonly FirstEntry[]): Record<MarkKind, number> {
  const out: Record<MarkKind, number> = { discovered: 0, mapped: 0, footfall: 0 }
  for (const e of entries) for (const k of MARK_KINDS) if (hasMark(e, k)) out[k]++
  return out
}

/** State breakdown of one sale-confirmed mark (first discovery or first map). */
export function stateCounts(entries: readonly FirstEntry[], kind: 'discovered' | 'mapped'): Record<FirstState, number> {
  const out: Record<FirstState, number> = { sold: 0, pending: 0, lost: 0 }
  for (const e of entries) {
    const s = e[kind]
    if (s) out[s]++
  }
  return out
}

/** Latest moment of an entry: its footfall or its scan, whichever is newer. */
export function entryTime(e: FirstEntry): number {
  let t = -Infinity
  for (const iso of [e.at, e.footfallAt]) {
    const v = iso ? Date.parse(iso) : NaN
    if (!Number.isNaN(v) && v > t) t = v
  }
  return t
}

export interface SystemGroup {
  key: string
  system: string | null
  /** Newest entry time (ms), -Infinity when unknown. */
  latest: number
  /** Bodies in natural name order (A 2 before A 10). */
  entries: FirstEntry[]
  counts: Record<MarkKind, number>
}

const byName = (a: FirstEntry, b: FirstEntry) =>
  a.body.localeCompare(b.body, 'en', { numeric: true, sensitivity: 'base' })

/** Entries matching the filter, grouped by system, newest system first. */
export function groupFirsts(entries: readonly FirstEntry[], filter: FirstsFilter = 'all'): SystemGroup[] {
  const groups = new Map<string, SystemGroup>()
  for (const e of entries) {
    if (filter !== 'all' && !hasMark(e, filter)) continue
    const key = e.system ?? '\u0000unknown'
    let g = groups.get(key)
    if (!g) {
      g = { key, system: e.system, latest: -Infinity, entries: [], counts: { discovered: 0, mapped: 0, footfall: 0 } }
      groups.set(key, g)
    }
    g.entries.push(e)
    g.latest = Math.max(g.latest, entryTime(e))
    for (const k of MARK_KINDS) if (hasMark(e, k)) g.counts[k]++
  }
  const out = [...groups.values()]
  for (const g of out) g.entries.sort(byName)
  // Stable: systems with the same (or unknown) time keep the backend's newest-first order.
  return out.sort((a, b) => (b.latest === a.latest ? 0 : b.latest > a.latest ? 1 : -1))
}

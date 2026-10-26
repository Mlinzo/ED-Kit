// Filtering and day grouping of the visited systems (pure, unit-tested).
import type { HistoryEntry } from '../../api/types'

export type HistoryFilter = 'all' | 'explored' | 'bio' | 'firsts' | 'unsold' | 'bookmarks'

export const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'explored', 'bio', 'firsts', 'unsold', 'bookmarks']

/** A pass-through jump: nothing scanned beyond the arrival star. */
export function isTransit(e: HistoryEntry): boolean {
  return e.bodiesScanned <= 1 && e.bodiesMapped === 0 && e.speciesAnalysed === 0 && e.bioSignals === 0
}

const MATCH: Record<HistoryFilter, (e: HistoryEntry) => boolean> = {
  all: () => true,
  explored: (e) => !isTransit(e),
  bio: (e) => e.bioSignals > 0 || e.speciesAnalysed > 0,
  firsts: (e) => e.firstDiscoveries + e.firstMapped + e.firstFootfalls > 0,
  unsold: (e) => e.unsoldValue > 0,
  bookmarks: (e) => e.bookmark !== null || e.innerBookmarks > 0,
}

export function matchesFilter(e: HistoryEntry, filter: HistoryFilter): boolean {
  return MATCH[filter](e)
}

/** Case-insensitive search in system names; spaces in the query match any run of spaces. */
export function matchesQuery(e: HistoryEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const name = e.name.toLowerCase()
  return words.every((w) => name.includes(w))
}

export function filterCounts(systems: readonly HistoryEntry[], query: string): Record<HistoryFilter, number> {
  const counts = { all: 0, explored: 0, bio: 0, firsts: 0, unsold: 0, bookmarks: 0 }
  for (const e of systems) {
    if (!matchesQuery(e, query)) continue
    for (const f of HISTORY_FILTERS) if (MATCH[f](e)) counts[f] += 1
  }
  return counts
}

export interface DayGroup {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  /** A visit time on that day (for labels). */
  at: string
  entries: HistoryEntry[]
}

function localDay(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Groups systems (already newest first) by the local day of their last visit. */
export function groupByDay(systems: readonly HistoryEntry[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const e of systems) {
    const t = Date.parse(e.lastVisitAt)
    const day = Number.isNaN(t) ? '' : localDay(t)
    const last = groups.at(-1)
    if (last && last.day === day) last.entries.push(e)
    else groups.push({ day, at: e.lastVisitAt, entries: [e] })
  }
  return groups
}

/** The first `limit` rows of the groups; day groups keep their full `entries` for counts. */
export function limitRows(groups: readonly DayGroup[], limit: number): (DayGroup & { rows: HistoryEntry[] })[] {
  const out: (DayGroup & { rows: HistoryEntry[] })[] = []
  let left = limit
  for (const g of groups) {
    if (left <= 0) break
    const rows = g.entries.slice(0, left)
    left -= rows.length
    out.push({ ...g, rows })
  }
  return out
}

/** "today" / "yesterday" relative to `now`, else null. */
export function relativeDay(day: string, now = Date.now()): 'today' | 'yesterday' | null {
  if (day === localDay(now)) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return day === localDay(yesterday.getTime()) ? 'yesterday' : null
}

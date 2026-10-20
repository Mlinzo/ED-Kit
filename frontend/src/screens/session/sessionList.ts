// Past sessions: figures and sorting (pure, unit-tested).
import type { SessionEntry } from '../../api/types'

export type SessionSort = 'start' | 'played' | 'jumps' | 'bodies' | 'species' | 'codex' | 'earned' | 'perHour'

export interface SortState {
  key: SessionSort
  desc: boolean
}

export const DEFAULT_SORT: SortState = { key: 'start', desc: true }

/** Sessions shorter than this get no "per hour": a few minutes say nothing about a pace. */
export const MIN_PER_HOUR_S = 600

export interface SessionRow {
  s: SessionEntry
  /** The game is running and this is its session. */
  live: boolean
  /** Seconds played; a live session counts up to now. */
  playedS: number
  /** Earned per hour played; null for short sessions. */
  perHour: number | null
}

export function toRows(sessions: readonly SessionEntry[], gameRunning: boolean, now: number): SessionRow[] {
  return sessions.map((s) => {
    const live = s.open && gameRunning
    const since = Math.round((now - Date.parse(s.startedAt)) / 1_000)
    const playedS = live && Number.isFinite(since) ? Math.max(s.durationS, since) : s.durationS
    return { s, live, playedS, perHour: playedS >= MIN_PER_HOUR_S ? (s.value * 3_600) / playedS : null }
  })
}

const VALUE: Record<SessionSort, (r: SessionRow) => number | null> = {
  start: (r) => Date.parse(r.s.startedAt),
  played: (r) => r.playedS,
  jumps: (r) => r.s.jumps,
  bodies: (r) => r.s.bodiesScanned,
  species: (r) => r.s.speciesAnalysed,
  codex: (r) => r.s.codex.length,
  earned: (r) => r.s.value,
  perHour: (r) => r.perHour,
}

/** Sorted copy; ties go newest first, and sessions without a value (per hour) always last. */
export function sortRows(rows: readonly SessionRow[], sort: SortState): SessionRow[] {
  const value = VALUE[sort.key]
  const start = VALUE.start
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1
    } else if (va !== vb) {
      return sort.desc ? vb - va : va - vb
    }
    return (start(b) ?? 0) - (start(a) ?? 0)
  })
}

/** A click on a column: its natural order first (biggest, or newest), a second click reverses it. */
export function nextSort(current: SortState, key: SessionSort): SortState {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: true }
}

export function totals(rows: readonly SessionRow[]): { playedS: number; earned: number } {
  let playedS = 0
  let earned = 0
  for (const r of rows) {
    playedS += r.playedS
    earned += r.s.value
  }
  return { playedS, earned }
}

/** Whole hours and the minutes left over (a minute at least). */
export function splitDuration(seconds: number): { h: number; m: number } {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return { h: Math.floor(minutes / 60), m: minutes % 60 }
}

// The route plotted in the game: what the Route tab's panel and the System tab's strip show.
import type { NavHopView, NavRouteView, StarKind } from '../../api/types'

/** The hops the jump list shows: where you are and everything ahead (not the passed ones). */
export function aheadHops(view: NavRouteView): NavHopView[] {
  const from = view.hereIndex ?? view.hops.findIndex((h) => h.status === 'ahead')
  return from < 0 ? [] : view.hops.slice(from)
}

/** A chance from which a system ahead is worth naming: more likely undiscovered than not. */
export const LIKELY_FIRST = 0.5

/** Systems ahead that nobody has likely discovered yet, the likeliest first. */
export function likelyFirsts(view: NavRouteView): NavHopView[] {
  return view.hops
    .filter((h) => h.status === 'ahead' && (h.discovery?.probability ?? 0) >= LIKELY_FIRST)
    .sort((a, b) => (b.discovery?.probability ?? 0) - (a.discovery?.probability ?? 0))
}

/** Systems ahead with your notes. */
export function notedAhead(view: NavRouteView): NavHopView[] {
  return view.hops.filter((h) => h.status === 'ahead' && h.note)
}

export function destination(view: NavRouteView): NavHopView | null {
  return view.hops.at(-1) ?? null
}

/** Warnings that need attention now (fuel), before the advisory ones (stars ahead). */
const SEVERITY: Record<string, number> = {
  fuel_short: 0,
  refuel_here: 0,
  dry_stretch: 1,
  fuel_tight: 2,
  neutron_next: 3,
  white_dwarf_next: 3,
  off_route: 4,
}

export function sortedWarnings(view: NavRouteView): string[] {
  return [...view.warnings].sort((a, b) => (SEVERITY[a] ?? 9) - (SEVERITY[b] ?? 9))
}

/** Fuel trouble ahead: the strip and the panel turn amber / red. */
export function fuelTone(view: NavRouteView): 'danger' | 'warn' | 'ok' {
  if (view.warnings.includes('fuel_short') || view.warnings.includes('refuel_here') || view.warnings.includes('dry_stretch')) return 'danger'
  if (view.warnings.includes('fuel_tight')) return 'warn'
  return 'ok'
}

/** Text colour of a star kind (and its dot). */
export const KIND_COLOR: Record<StarKind, string> = {
  scoopable: '#fcd34d',
  neutron: '#7dd3fc',
  white_dwarf: '#c7d2fe',
  black_hole: '#a1a1aa',
  other: '#71717a',
}

/** A chance as a whole percentage ("< 1%" for tiny ones). */
export function percent(p: number): string {
  if (p > 0 && p < 0.01) return '< 1%'
  return `${Math.round(p * 100)}%`
}

/** How much a chance stands out: likely firsts glow, known systems stay quiet. */
export function chanceTone(p: number | null): 'high' | 'mid' | 'low' {
  if (p === null) return 'low'
  if (p >= 0.5) return 'high'
  if (p >= 0.2) return 'mid'
  return 'low'
}

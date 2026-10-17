// The route plotted in the game: what the Route tab's panel and the System tab's strip show.
import type { NavHopView, NavRouteView, StarKind } from '../../api/types'

/** Ahead hops shown before "show all". */
export const AHEAD_SHOWN = 12

/** The hops the panel lists: where you are and the next ones; everything when expanded. */
export function shownHops(view: NavRouteView, expanded: boolean): NavHopView[] {
  if (expanded) return view.hops
  const from = view.hereIndex ?? view.hops.findIndex((h) => h.status === 'ahead')
  if (from < 0) return []
  const end = from + (view.hereIndex !== null ? 1 : 0) + AHEAD_SHOWN
  return view.hops.slice(from, end)
}

/** Some rows are hidden (passed, or far ahead). */
export function hasHidden(view: NavRouteView): boolean {
  return shownHops(view, false).length < view.hops.length
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

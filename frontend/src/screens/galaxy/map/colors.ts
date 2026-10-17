import type { DotKind } from './geometry'

/** Visited systems: grey, emerald where you earned, amber where you were first. */
export const DOT_COLOR: Record<DotKind, string> = {
  plain: '#71717a',
  earned: '#34d399',
  firsts: '#fcd34d',
}
export const DEATH_COLOR = '#fb7185'
export const ROUTE_COLOR = '#7dd3fc'
export const PLOTTED_COLOR = '#c4b5fd'
export const LANDMARK_COLOR = '#e4e4e7'
export const PATH_OLD = '#1e3a5f'
export const PATH_NEW = '#38bdf8'

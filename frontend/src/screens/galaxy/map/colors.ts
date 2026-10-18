import type { DotKind } from './geometry'

/** Visited systems: grey, emerald where you earned, amber where you were first. */
export const DOT_COLOR: Record<DotKind, string> = {
  plain: '#71717a',
  earned: '#34d399',
  firsts: '#fcd34d',
}
export const DEATH_COLOR = '#fb7185'
/** The planned route: a fine pale dash, the plan rather than a path. */
export const ROUTE_COLOR = '#e4e4e7'
export const PLOTTED_COLOR = '#f0abfc'
export const LANDMARK_COLOR = '#e4e4e7'
/** Your path fades from indigo (earliest) to sky (latest): still visible where it starts. */
export const PATH_OLD = '#5b5bd6'
export const PATH_NEW = '#38bdf8'
export const START_COLOR = '#f4f4f5'
/** The light running along the path, from the earliest jumps to the latest. */
export const FLOW_COLOR = '#e0f2fe'
/** Codex regions: pale borders, a sky tint where you have been, brighter where you are. */
export const REGION_LINE = '#94a3b8'
export const REGION_VISITED = '#38bdf8'
export const REGION_SELECTED = '#7dd3fc'
/** Other players (EDDN): violet, apart from everything of yours. */
export const LIVE_COLOR = '#c4b5fd'
/** Engineers: orange rings, filled once unlocked. */
export const ENGINEER_COLOR = '#fb923c'

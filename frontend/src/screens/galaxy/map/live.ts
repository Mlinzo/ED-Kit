// Other players on the galaxy map (EDDN, app.eddn): where someone was in the last minutes, bigger
// where several were, fading with age. Pure, so it is tested without WebGL.

import type { LiveSystemView, LiveView } from '../../../api/types'
import type { Vec3 } from '../../route/map/geometry'
import { at } from './geometry'

export interface LivePoint {
  key: string
  pos: Vec3
  /** Dot diameter, CSS px. */
  size: number
  /** 1 just now, fading to MIN_ALPHA at the window's end. */
  alpha: number
  system: LiveSystemView
}

const SIZE = { one: 5, step: 2.2, max: 13 }
const MIN_ALPHA = 0.28

/** Hover keys of live systems ("live:<address>"), apart from your own systems' addresses. */
export const liveKey = (address: string) => `live:${address}`

export function liveSize(players: number): number {
  return Math.min(SIZE.max, SIZE.one + SIZE.step * Math.log2(Math.max(1, players)))
}

export function liveAlpha(ageS: number, windowS: number): number {
  const t = windowS > 0 ? Math.min(1, Math.max(0, ageS / windowS)) : 0
  return 1 - (1 - MIN_ALPHA) * t
}

/** Draw order: the oldest first, the freshest on top (and picked first). */
export function buildLivePoints(view: LiveView): LivePoint[] {
  const windowS = view.windowMin * 60
  return view.systems
    .map((s) => ({ key: liveKey(s.address), pos: at(s), size: liveSize(s.players), alpha: liveAlpha(s.ageS, windowS), system: s }))
    .sort((a, b) => b.system.ageS - a.system.ageS)
}

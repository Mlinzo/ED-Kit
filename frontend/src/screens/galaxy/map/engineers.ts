// Engineers on the galaxy map: where each workshop is drawn. Pure, so it is tested without WebGL.

import type { GalaxyEngineerView } from '../../../api/types'
import type { Vec3 } from '../../route/map/geometry'
import { at } from './geometry'

export interface EngineerPoint {
  key: string
  pos: Vec3
  /** Marker diameter, CSS px. */
  size: number
  engineer: GalaxyEngineerView
}

export const engineerKey = (name: string) => `eng:${name}`

export function buildEngineerPoints(engineers: readonly GalaxyEngineerView[]): EngineerPoint[] {
  return engineers.map((e) => ({ key: engineerKey(e.name), pos: at(e), size: e.progress === 'unlocked' ? 11 : 10, engineer: e }))
}

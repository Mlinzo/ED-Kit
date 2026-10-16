import type { BodyVisual } from '../../api/types'
import { PLANET_SWATCH, mixHex, planetFamily, starLook } from './palette'

/** Representative CSS colour of a body (labels, dots, fallbacks). */
export function bodyColor(visual: BodyVisual, kind: 'star' | 'planet'): string {
  if (kind === 'star') {
    const look = starLook(visual)
    if (look.family === 'black_hole') return '#ff9d4d'
    return mixHex(look.mid, look.glow, 0.35)
  }
  return PLANET_SWATCH[planetFamily(visual.planetClass)]
}

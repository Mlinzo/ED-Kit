// Procedural body visuals for the 3D system map (react-three-fiber).
//
// CONTRACT (used by src/map/**; keep stable):
//   <BodyMesh visual kind radius seed dim selected hovered priority />  — a self-contained body at
//     the origin: planet sphere / star with glow / rings / atmosphere rim, spinning by itself.
//   Lighting: the map keeps a fixed pool of PointLights (decay 0) on its main stars plus a faint
//   ambient light, so planet materials are lit by standard three.js lights (no hard-coded light dir).
//   <PlanetSurface visual seed />  — the planet alone and still at unit radius, north up (+y): the
//     Surface globe draws its marks on it.
//   bodyColor(visual, kind) in ./colors — representative CSS colour (labels, dots, fallbacks).
//
// Tuned for the default R3F canvas (ACES filmic tone mapping, sRGB output) with star
// PointLights of intensity ~3 (≈π gives full albedo on a lit face) and ambient ~0.1–0.2.
// Only the body sphere (and planet rings) are raycastable; glows, shells and the reticle are not.
// Planet surfaces are baked on the GPU into cached 512x256 textures (a few per frame), so a body
// can appear one or two frames after it mounts.

import type {} from '@react-three/fiber' // registers <mesh/> etc. in JSX
import type { BodyVisual } from '../../api/types'
import { hashString } from './palette'
import { Planet } from './Planet'

export { PlanetSurface } from './Planet'
import { Star } from './Star'

export interface BodyMeshProps {
  visual: BodyVisual
  kind: 'star' | 'planet'
  /** Scene-space radius of the body sphere (rings and glow may extend beyond it). */
  radius: number
  /** Stable per-body seed (e.g. bodyId) so procedural surfaces differ between bodies. */
  seed?: number
  /** Uninteresting body: render desaturated and dark. */
  dim?: boolean
  selected?: boolean
  hovered?: boolean
  /** Order of the surface bakes when many bodies appear at once (higher first). */
  priority?: number
}

export function BodyMesh({
  visual,
  kind,
  radius,
  seed,
  dim = false,
  selected = false,
  hovered = false,
  priority = 0,
}: BodyMeshProps) {
  const s = seed ?? hashString(`${visual.planetClass}|${visual.starType}|${visual.radiusM}|${visual.massEm}`)
  if (kind === 'star') {
    return <Star visual={visual} radius={radius} seed={s} dim={dim} selected={selected} hovered={hovered} />
  }
  return (
    <Planet
      visual={visual}
      radius={radius}
      seed={s}
      dim={dim}
      selected={selected}
      hovered={hovered}
      priority={priority}
    />
  )
}

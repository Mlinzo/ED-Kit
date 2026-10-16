// Star lights. The map keeps a fixed pool of point lights: three.js compiles the light count into
// every lit material, so adding a light when a star is scanned would recompile all of them (a
// visible hitch). Lights go to the stars that light the most bodies; the planets of any further
// star are lit by the others (rare: few systems have more than four stars).

import type { MapNode, SystemLayout } from './layout'

/** Point lights in the pool (unused ones are switched off, never removed). */
export const LIGHT_POOL = 4
export const STAR_LIGHT_INTENSITY = 2.8

function bodiesUnder(node: MapNode): number {
  let n = 0
  for (const c of node.children) n += (c.body ? 1 : 0) + bodiesUnder(c)
  return n
}

/** Stars that get a light, most important first: bodies they light, then size, then id. */
export function litStars(layout: SystemLayout, max = LIGHT_POOL): MapNode[] {
  const stars = [...layout.nodes.values()].filter((n) => n.kind === 'star')
  const weight = new Map(stars.map((s) => [s.id, bodiesUnder(s)]))
  stars.sort((a, b) => weight.get(b.id)! - weight.get(a.id)! || b.size - a.size || a.id - b.id)
  return stars.slice(0, max)
}

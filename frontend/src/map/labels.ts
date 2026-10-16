// Label priorities and placement: shows as many labels as fit without overlapping each other or
// covering bodies, most important first, trying above / below / right / left of each body.
// Runs a few times per second and writes straight to the DOM (no re-renders).

import { Vector3, type Camera } from 'three'
import type { MapRegistry } from './context'
import type { MapNode, SystemLayout } from './layout'
import { worldPerPixel } from './three-utils'

export const PRIORITY = { hovered: 10_000, selected: 9_000, current: 8_000 } as const

/** Higher wins. Hovered / selected labels are always shown. */
export function labelPriority(node: MapNode, s: { hovered: boolean; selected: boolean; current: boolean }): number {
  if (s.hovered) return PRIORITY.hovered
  if (s.selected) return PRIORITY.selected
  if (s.current) return PRIORITY.current
  const value = Math.min(400, Math.log10(1 + (node.body?.totalValue ?? 0)) * 25)
  // Everything worth doing there is done: still labelled (it shows what was collected), but it
  // gives way to bodies that still need a visit when the map is crowded.
  if (node.body?.done && node.kind === 'planet') return 2_500 + value
  if (node.interest === 'high') return 5_000 + value
  // Component stars of a multiple system ("A", "B") are landmarks; a lone star's label is just
  // the system name, already in the header.
  if (node.kind === 'star' && (node.body?.shortName.length ?? 0) <= 3) return 4_500 + value
  if (node.kind === 'star') return 4_000 + value
  if (node.interest === 'medium') return 3_000 + value
  if (node.kind === 'placeholder') return 1_000
  return 2_000 + value
}

/** Which bodies get a label at all (others only while hovered or selected). */
export function wantsLabel(node: MapNode): boolean {
  return node.kind === 'star' || node.kind === 'placeholder' || node.interest !== 'low'
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

interface Screen {
  x: number
  y: number
  /** On-screen radius of the body sphere, CSS px. */
  r: number
  visible: boolean
}

const world = new Vector3()
const ndc = new Vector3()
const GAP = 6
const PAD = 3

function project(registry: MapRegistry, node: MapNode, camera: Camera, width: number, height: number): Screen | null {
  const group = registry.groups.get(node.id)
  if (!group) return null
  world.setFromMatrixPosition(group.matrixWorld)
  const dist = camera.position.distanceTo(world)
  ndc.copy(world).project(camera)
  // Drawn size: magnified on screen (sizing.ts); rings count, though flatter than the body.
  const scale = registry.sizer.solver?.scaleOf(node.id)
  const drawn = scale ? scale.world * scale.body * Math.min(scale.vis, 1.8) : 1
  return {
    x: ((ndc.x + 1) / 2) * width,
    y: ((1 - ndc.y) / 2) * height,
    r: (node.size * drawn) / worldPerPixel(camera, dist, height),
    visible: ndc.z < 1,
  }
}

/**
 * Candidate offsets (top-left corner relative to the anchor) for a w×h label `lift` px away:
 * above / below / right / left first, then the diagonals, then the same a bit farther out.
 */
function candidates(w: number, h: number, lift: number): [number, number][] {
  const out: [number, number][] = []
  for (const d of [lift, lift + 14]) {
    const k = d * 0.75
    out.push(
      [-w / 2, -d - h], // above
      [-w / 2, d], // below
      [d, -h / 2], // right
      [-d - w, -h / 2], // left
      [k, -k - h], // above right
      [-k - w, -k - h], // above left
      [k, k], // below right
      [-k - w, k], // below left
    )
  }
  return out
}

/** How far (px) a label may be pushed back inside the map at its edges. */
const MAX_NUDGE = 40

/** Offset along one axis keeping a `size` px label (plus padding) inside [0, limit]. */
function clampOffset(anchor: number, offset: number, size: number, limit: number): number {
  const lo = PAD - anchor
  const hi = limit - PAD - size - anchor
  return lo > hi ? offset : Math.min(hi, Math.max(lo, offset))
}

export function cullLabels(
  registry: MapRegistry,
  layout: SystemLayout,
  camera: Camera,
  width: number,
  height: number,
): void {
  // Bodies are obstacles: a label must not hide a body at least as important as its own.
  // Its own body is excluded below.
  const obstacles: { id: number; rect: Rect; priority: number }[] = []
  for (const node of layout.nodes.values()) {
    if (node.size <= 0) continue
    const s = project(registry, node, camera, width, height)
    if (!s || !s.visible) continue
    const r = node.kind === 'star' ? s.r * 1.15 + 2 : Math.max(s.r, 2.5) + 1.5
    // Stars (the landmarks, and their glow) block every ordinary label.
    const priority =
      node.kind === 'star' ? PRIORITY.current : labelPriority(node, { hovered: false, selected: false, current: false })
    obstacles.push({ id: node.id, priority, rect: { x0: s.x - r, x1: s.x + r, y0: s.y - r, y1: s.y + r } })
  }

  // Reads first (positions, element sizes), writes after: no layout thrashing.
  const items: { node: MapNode; el: HTMLElement; priority: number; s: Screen; w: number; h: number }[] = []
  for (const { node, el, priority } of registry.labels.values()) {
    const s = project(registry, node, camera, width, height)
    if (!s) continue
    items.push({ node, el, priority, s, w: el.offsetWidth, h: el.offsetHeight })
  }
  items.sort((a, b) => b.priority - a.priority)

  const placed: Rect[] = []
  for (const it of items) {
    const lift = Math.max(it.s.r, 2.5) + GAP
    const always = it.priority >= PRIORITY.selected
    let chosen: [number, number] | null = null
    let fallback: { at: [number, number]; rect: Rect } | null = null
    const onScreen = it.s.x >= 0 && it.s.x <= width && it.s.y >= 0 && it.s.y <= height
    if (it.s.visible && onScreen) {
      for (const [cx, cy] of candidates(it.w, it.h, lift)) {
        // Near the edges, slide the label back inside rather than giving up on it.
        const dx = clampOffset(it.s.x, cx, it.w, width)
        const dy = clampOffset(it.s.y, cy, it.h, height)
        if (Math.abs(dx - cx) > MAX_NUDGE || Math.abs(dy - cy) > MAX_NUDGE) continue
        const rect = { x0: it.s.x + dx - PAD, y0: it.s.y + dy - PAD, x1: it.s.x + dx + it.w + PAD, y1: it.s.y + dy + it.h + PAD }
        // Never slide a label over its own body.
        const r = Math.max(it.s.r, 2.5)
        if (overlaps(rect, { x0: it.s.x - r, y0: it.s.y - r, x1: it.s.x + r, y1: it.s.y + r })) continue
        fallback ??= { at: [dx, dy], rect }
        const blocked =
          placed.some((p) => overlaps(p, rect)) ||
          obstacles.some((o) => o.id !== it.node.id && o.priority >= it.priority && overlaps(o.rect, rect))
        if (!blocked) {
          chosen = [dx, dy]
          placed.push(rect)
          break
        }
      }
      if (!chosen && always) {
        chosen = fallback?.at ?? [-it.w / 2, -lift - it.h]
        if (fallback) placed.push(fallback.rect)
      }
    }
    if (chosen) {
      it.el.style.setProperty('--tx', `${chosen[0].toFixed(1)}px`)
      it.el.style.setProperty('--ty', `${chosen[1].toFixed(1)}px`)
    }
    const hidden = chosen ? 'false' : 'true'
    if (it.el.dataset.hidden !== hidden) it.el.dataset.hidden = hidden
  }
}

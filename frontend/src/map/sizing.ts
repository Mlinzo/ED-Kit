// On-screen magnification of the not-to-scale map ("zoom where there is room").
//
// In the whole-system view of a wide system the layout leaves planets a few pixels across, so their
// procedural surfaces cannot be seen. Every frame each body may be drawn bigger, up to a floor that
// depends on its kind, layout size (stars > giants > rocky bodies > moons) and interest, as long as
// nothing touches on screen:
//  - zoom: the node's whole subsystem (body, moon orbits, moons) is magnified around it, so a
//    planet keeps its moons outside of it; its footprint must stay clear of every other body and
//    subsystem, of its ancestors' bodies, and inside the view;
//  - body: a body with moons (and a root) may also grow alone inside its clearance, the free
//    room before its first moon orbit, which never touches anything.
// Solved top-down (a node's zoom moves its moons); nodes of one depth share the free room between
// them by how much they want. Growth eases in, shrinking is immediate (never a frame of overlap).

import { Vector3, type PerspectiveCamera } from 'three'
import type { Interest } from '../api/types'
import { localPosition, type MapNode, type SystemLayout } from './layout'
import { ringOuterRadius } from './visuals/recipe'

/** Current magnification of a node (read by labels, hit areas, halos). */
export interface NodeScale {
  /** World scale of the node's group: its own zoom times its ancestors'. */
  world: number
  /** Extra scale of the body alone. */
  body: number
  /** Drawn radius (rings, atmosphere) in body radii. */
  vis: number
}

/**
 * Floor of the on-screen body radius (CSS px) at the smallest and the largest layout size of the
 * kind, for a map about 620 px tall (scaled with the map, within limits).
 */
const FLOOR: Record<'star' | Interest | 'placeholder', [number, number]> = {
  star: [11, 14.5],
  high: [8, 12],
  medium: [5.5, 9],
  low: [4, 7],
  placeholder: [3.5, 5.5],
}
const SIZE_RANGE = { star: [1.25, 2.6], planet: [0.22, 1.1] } as const
const VIEW_REF_PX = 620
const VIEW_FACTOR = { min: 0.72, max: 1.25 }
/** Upper bound of a subsystem's zoom. */
export const MAX_ZOOM = 6
/** Share of the distance between two footprints' centres they may fill, and a minimum gap (px). */
const FILL = 0.9
const GAP_PX = 1.5
/** Distance (px) kept from the edges of the view. */
const EDGE_PX = 6
const GROW_RATE = 5
/**
 * Share of its clearance a body may grow into alone: the rest stays free for its inner moons
 * (or planets) to grow towards it.
 */
const BODY_ROOM_SHARE = 0.5
/** A moon never asks to be bigger than this share of what its planet asks for (hierarchy first). */
const MOON_FLOOR_RATIO = 0.9

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Desired body radius (CSS px) before the view factor. */
export function floorPx(node: MapNode, current: boolean): number {
  if (node.size <= 0) return 0
  if (node.kind === 'placeholder') {
    const [a, b] = FLOOR.placeholder
    return node.refKind === 'Star' ? b : a
  }
  const isStar = node.kind === 'star'
  const [lo, hi] = isStar ? SIZE_RANGE.star : SIZE_RANGE.planet
  const t = clamp((node.size - lo) / (hi - lo), 0, 1)
  let interest: Interest = node.interest
  // Everything worth doing there is done: it gives way to bodies that still need a visit.
  if (node.body?.done && interest === 'high') interest = 'medium'
  if (current && interest === 'low') interest = 'medium'
  const [a, b] = FLOOR[isStar ? 'star' : interest]
  return a + (b - a) * t
}

/** Floors grow a little with the map and shrink on a phone. */
export function viewFactor(width: number, height: number): number {
  return clamp(Math.min(width, height) / VIEW_REF_PX, VIEW_FACTOR.min, VIEW_FACTOR.max)
}

/** Drawn radius of a body in body radii (rings stick out; a little for the atmosphere). */
function visualRatio(node: MapNode): number {
  if (node.kind !== 'planet' || !node.body) return 1
  return Math.max(1.05, ringOuterRadius(node.body.visual) ?? 0)
}

const v = new Vector3()

/** Holds the solver of the current layout, renewed (taking over its values) when the layout changes. */
export class SizerSlot {
  solver: Sizer | null = null

  /** The solver for `layout`, created on first use. */
  for(layout: SystemLayout, systemKey: string): Sizer {
    if (this.solver?.layout !== layout) this.solver = new Sizer(layout, systemKey, this.solver)
    return this.solver
  }

  /** World scale of a node's group (1 before the first frame or if unknown). */
  worldOf(id: number): number {
    return this.solver?.worldOf(id) ?? 1
  }

  /** Body-only magnification of a node (1 before the first frame or if unknown). */
  bodyOf(id: number): number {
    return this.solver?.bodyOf(id) ?? 1
  }
}

/**
 * Per-layout solver state. Keeps the displayed (eased) magnification between frames; a new layout
 * of the same system takes over the previous values by node id, so a refetch does not pulse.
 *
 * Footprints on screen are axis-aligned ellipses: a body is a circle, a subsystem lies flat on the
 * orbit plane and is squashed vertically by the view's tilt. Two footprints are kept apart along
 * the line between their centres (separating axis: their supports along it plus a gap).
 */
export class Sizer {
  readonly nodes: MapNode[]
  /** Node index -> parent index (-1 for roots). */
  private readonly parent: Int32Array
  /** Level boundaries in `nodes` (breadth-first order). */
  private readonly levels: number[]
  private readonly vis: Float64Array
  /** Free room of the body alone (clearance / drawn radius); 1 = none. */
  private readonly bodyMax: Float64Array
  /** Farthest point of the children (orbit radius + their drawn reach), local units. */
  private readonly kidsReach: Float64Array
  private readonly rootX: Float64Array
  private readonly rootZ: Float64Array
  readonly index = new Map<number, number>()

  // Per frame.
  readonly worldX: Float64Array
  readonly worldZ: Float64Array
  /** World scale of each node's group (product of zooms). */
  readonly worldScale: Float64Array
  private readonly sx: Float64Array
  private readonly sy: Float64Array
  private readonly wpp: Float64Array
  private readonly front: Uint8Array
  /** Footprint semi-axes (px) without the node's own zoom. */
  private readonly fa: Float64Array
  private readonly fb: Float64Array
  /** Footprint semi-axes (px) once fixed this frame (0 = not an obstacle). */
  private readonly da: Float64Array
  private readonly db: Float64Array
  private readonly want: Float64Array
  private readonly cap: Float64Array
  /** Desired body radius (px) this frame. */
  private readonly floor: Float64Array
  /** Index of the nearest ancestor that is a planet (through barycentres, not past a star), or -1. */
  private readonly host: Int32Array
  // Displayed (eased) values.
  readonly zoom: Float64Array
  readonly body: Float64Array

  readonly layout: SystemLayout
  /** Identifies the system: magnification carries over between layouts of the same one only. */
  readonly systemKey: string

  constructor(layout: SystemLayout, systemKey: string, previous: Sizer | null = null) {
    this.layout = layout
    this.systemKey = systemKey
    const order: MapNode[] = []
    const levels = [0]
    let level = [...layout.roots]
    while (level.length > 0) {
      order.push(...level)
      levels.push(order.length)
      level = level.flatMap((n) => n.children)
    }
    const n = order.length
    this.nodes = order
    this.levels = levels
    order.forEach((node, i) => this.index.set(node.id, i))
    this.parent = new Int32Array(n)
    this.vis = new Float64Array(n)
    this.bodyMax = new Float64Array(n)
    this.kidsReach = new Float64Array(n)
    this.rootX = new Float64Array(n)
    this.rootZ = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const node = order[i]
      this.parent[i] = node.parent ? this.index.get(node.parent.id)! : -1
      this.vis[i] = visualRatio(node)
      const drawn = node.size * this.vis[i]
      this.bodyMax[i] = drawn > 0 ? 1 + Math.max(0, node.clearance / drawn - 1) * BODY_ROOM_SHARE : 1
      const [x, z] = layout.rootPositions.get(node.id) ?? [0, 0]
      this.rootX[i] = x
      this.rootZ[i] = z
    }
    // Reach of the children at rest (bottom-up: breadth-first order reversed).
    const reach = new Float64Array(n)
    for (let i = n - 1; i >= 0; i--) {
      const node = order[i]
      let k = 0
      for (const c of node.children) k = Math.max(k, c.orbitRadius + reach[this.index.get(c.id)!])
      this.kidsReach[i] = k
      reach[i] = Math.max(node.size * this.vis[i], k)
    }
    this.worldX = new Float64Array(n)
    this.worldZ = new Float64Array(n)
    this.worldScale = new Float64Array(n).fill(1)
    this.sx = new Float64Array(n)
    this.sy = new Float64Array(n)
    this.wpp = new Float64Array(n)
    this.front = new Uint8Array(n)
    this.fa = new Float64Array(n)
    this.fb = new Float64Array(n)
    this.da = new Float64Array(n)
    this.db = new Float64Array(n)
    this.want = new Float64Array(n)
    this.cap = new Float64Array(n)
    this.floor = new Float64Array(n)
    this.host = new Int32Array(n).fill(-1)
    for (let i = 0; i < n; i++) {
      for (let a = this.parent[i]; a >= 0; a = this.parent[a]) {
        const an = order[a]
        if (an.kind === 'barycentre') continue
        if (an.kind === 'planet' || (an.kind === 'placeholder' && an.refKind !== 'Star')) this.host[i] = a
        break
      }
    }
    this.zoom = new Float64Array(n).fill(1)
    this.body = new Float64Array(n).fill(1)
    if (previous && previous.systemKey === systemKey) {
      for (let i = 0; i < n; i++) {
        const j = previous.index.get(order[i].id)
        if (j === undefined) continue
        this.zoom[i] = previous.zoom[j]
        this.body[i] = previous.body[j]
      }
    }
  }

  /** Scale of a node for the scene objects that compensate for it (identity if unknown). */
  scaleOf(id: number): NodeScale {
    const i = this.index.get(id)
    if (i === undefined) return { world: 1, body: 1, vis: 1 }
    return { world: this.worldScale[i], body: this.body[i], vis: this.vis[i] }
  }

  /** World scale of a node's group (1 if unknown). */
  worldOf(id: number): number {
    const i = this.index.get(id)
    return i === undefined ? 1 : this.worldScale[i]
  }

  /** Body-only magnification of a node (1 if unknown). */
  bodyOf(id: number): number {
    const i = this.index.get(id)
    return i === undefined ? 1 : this.body[i]
  }

  /** Body radius (px) the node asked for in the last frame (0 if unknown). */
  floorOf(id: number): number {
    const i = this.index.get(id)
    return i === undefined ? 0 : this.floor[i]
  }

  private isAncestor(a: number, i: number): boolean {
    for (let p = this.parent[i]; p >= 0; p = this.parent[p]) if (p === a) return true
    return false
  }

  /**
   * One frame: positions at `nowMs`, projection through `camera` into a `width` x `height` view,
   * new targets, eased display values (`dt` seconds since the last frame; 0 jumps to the targets).
   */
  solve(camera: PerspectiveCamera, width: number, height: number, nowMs: number, dt: number, currentId: number | null) {
    camera.updateMatrixWorld()
    const pxPerUnitAt1 = height / (2 * Math.tan(((camera.fov ?? 40) * Math.PI) / 360))
    const camY = Math.abs(camera.position.y)
    const k = viewFactor(width, height)
    const ease = dt <= 0 ? 1 : 1 - Math.exp(-Math.min(dt, 0.25) * GROW_RATE)
    const { nodes, parent, fa, fb } = this

    for (let L = 0; L + 1 < this.levels.length; L++) {
      const from = this.levels[L]
      const to = this.levels[L + 1]

      // Positions, projection, wishes against everything already fixed.
      for (let i = from; i < to; i++) {
        const node = nodes[i]
        const p = parent[i]
        const parentScale = p >= 0 ? this.worldScale[p] : 1
        if (p < 0) {
          this.worldX[i] = this.rootX[i]
          this.worldZ[i] = this.rootZ[i]
        } else {
          const [lx, lz] = localPosition(node, nowMs)
          this.worldX[i] = this.worldX[p] + parentScale * lx
          this.worldZ[i] = this.worldZ[p] + parentScale * lz
        }
        v.set(this.worldX[i], 0, this.worldZ[i]).applyMatrix4(camera.matrixWorldInverse)
        const dist = v.length()
        const front = -v.z > camera.near
        this.front[i] = front ? 1 : 0
        const wpp = Math.max(1e-9, dist / pxPerUnitAt1)
        this.wpp[i] = wpp
        v.applyMatrix4(camera.projectionMatrix)
        const x = ((v.x + 1) / 2) * width
        const y = ((1 - v.y) / 2) * height
        this.sx[i] = x
        this.sy[i] = y

        const leaf = node.children.length === 0
        const natural = (node.size * parentScale) / wpp // body radius, px, at no magnification
        let floor = floorPx(node, node.id === currentId) * k
        // An interesting moon of a dull giant pops within the hierarchy, not above its planet.
        if (this.host[i] >= 0) floor = Math.min(floor, this.floor[this.host[i]] * MOON_FLOOR_RATIO)
        this.floor[i] = floor
        let b = 1
        let z = 1
        if (natural > 0 && front) {
          if (!leaf || p < 0) b = clamp(floor / natural, 1, this.bodyMax[i])
          if (p >= 0) z = clamp(floor / (natural * b), 1, MAX_ZOOM)
        }
        this.body[i] = b < this.body[i] ? b : this.body[i] + (b - this.body[i]) * ease

        // Footprint at zoom 1: the body (a sphere: a circle; rings flatter) and the subsystem,
        // flat on the orbit plane (squashed by the tilt of the view).
        const tilt = dist > 0 ? Math.min(1, camY / dist) : 1
        const r = (node.size * b * parentScale) / wpp
        const vis = this.vis[i]
        const reach = (this.kidsReach[i] * parentScale) / wpp
        fa[i] = Math.max(r * vis, reach)
        fb[i] = Math.max(vis > 1.2 ? r * Math.max(1.05, vis * 0.65) : r * vis, reach * tilt)

        // Clear of the ancestors' bodies. A body grown alone that would cover a moon seen in
        // front of or behind it (the layout only keeps them apart on the orbit plane) gives way.
        for (let a = p; a >= 0 && fa[i] > 0; a = parent[a]) {
          const an = nodes[a]
          if (an.size <= 0) continue
          const ra = (an.size * this.vis[a] * this.body[a] * this.worldScale[a]) / this.wpp[a]
          const fit = this.fit(i, a, ra, ra)
          z = Math.min(z, fit)
          if (fit <= 1 && this.body[a] > 1) {
            const room = this.between(i, a) - Math.hypot(fa[i] * this.ux, fb[i] * this.uy)
            this.body[a] = Math.max(1, Math.min(this.body[a], (this.body[a] * room) / ra))
          }
        }
        if (z > 1 && fa[i] > 0) {
          // Inside the view.
          z = Math.min(z, Math.max(1, (Math.min(x, width - x) - EDGE_PX) / fa[i]))
          z = Math.min(z, Math.max(1, (Math.min(y, height - y) - EDGE_PX) / fb[i]))
          // Clear of everything fixed at shallower depths (footprints contain their subsystems).
          for (let m = 0; m < from && z > 1; m++) {
            if (this.da[m] <= 0 || this.isAncestor(m, i)) continue
            z = Math.min(z, this.fit(i, m, this.da[m], this.db[m]))
          }
        }
        this.want[i] = z
        this.cap[i] = z
      }

      // Nodes of this depth share the room between them, in proportion to what they want; one
      // that stays as it is (a barycentre, a body big enough) is an obstacle like a fixed one.
      for (let i = from; i < to; i++) {
        for (let j = i + 1; j < to; j++) {
          const wi = this.want[i] > 1
          const wj = this.want[j] > 1
          if (!wi && !wj) continue
          if (!wj || !wi) {
            const [g, o] = wi ? [i, j] : [j, i]
            if (fa[o] > 0) this.cap[g] = Math.min(this.cap[g], this.fit(g, o, fa[o], fb[o]))
            continue
          }
          const room = this.between(i, j)
          if (room === Number.POSITIVE_INFINITY) continue
          const hi = Math.hypot(fa[i] * this.ux, fb[i] * this.uy)
          const hj = Math.hypot(fa[j] * this.ux, fb[j] * this.uy)
          const free = room - hi - hj
          const ei = hi * (this.want[i] - 1)
          const ej = hj * (this.want[j] - 1)
          if (ei + ej <= free) continue
          if (free <= 0) {
            this.cap[i] = 1
            this.cap[j] = 1
            continue
          }
          this.cap[i] = Math.min(this.cap[i], 1 + (free * ei) / (ei + ej) / hi)
          this.cap[j] = Math.min(this.cap[j], 1 + (free * ej) / (ei + ej) / hj)
        }
      }

      // Display (ease up, drop at once) and fix this depth.
      for (let i = from; i < to; i++) {
        const z = this.cap[i]
        this.zoom[i] = z < this.zoom[i] ? z : this.zoom[i] + (z - this.zoom[i]) * ease
        const p = parent[i]
        this.worldScale[i] = (p >= 0 ? this.worldScale[p] : 1) * this.zoom[i]
        this.da[i] = this.front[i] ? fa[i] * this.zoom[i] : 0
        this.db[i] = this.front[i] ? fb[i] * this.zoom[i] : 0
      }
    }
  }

  /** Unit direction (screen) from i to j, written to ux / uy (no allocation in the hot loops). */
  private ux = 1
  private uy = 0

  /** Room (px) two footprints at i and j may fill along the line between them; sets ux / uy. */
  private between(i: number, j: number): number {
    this.ux = 1
    this.uy = 0
    if (!this.front[i] || !this.front[j]) return Number.POSITIVE_INFINITY
    const dx = this.sx[j] - this.sx[i]
    const dy = this.sy[j] - this.sy[i]
    const d = Math.hypot(dx, dy)
    if (d < 1e-6) return -GAP_PX
    this.ux = dx / d
    this.uy = dy / d
    return d * FILL - GAP_PX
  }

  /**
   * Largest zoom (>= 1) of node i keeping its footprint clear of a fixed ellipse (semi-axes a, b)
   * around node j. Two sufficient conditions, the better one wins: separation along the line
   * between the centres, and i's footprint (as a circle) against a lower bound of the distance
   * from its centre to the ellipse, which suits a big flat subsystem next to a small body.
   */
  private fit(i: number, j: number, a: number, b: number): number {
    const room = this.between(i, j)
    if (room === Number.POSITIVE_INFINITY) return MAX_ZOOM
    const hi = Math.hypot(this.fa[i] * this.ux, this.fb[i] * this.uy)
    if (hi <= 0) return MAX_ZOOM
    let z = (room - Math.hypot(a * this.ux, b * this.uy)) / hi
    const lo = Math.min(a, b)
    if (lo > 0 && this.fa[i] > 0) {
      // The point lies on the ellipse scaled by lambda; similar ellipses are >= (lambda - 1) * minor apart.
      const lambda = Math.hypot((this.sx[i] - this.sx[j]) / a, (this.sy[i] - this.sy[j]) / b)
      z = Math.max(z, ((lambda - 1) * lo * FILL - GAP_PX) / this.fa[i])
    }
    return Math.max(1, z)
  }
}

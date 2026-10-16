// Orbit tree + not-to-scale orrery layout for the 3D system map. Pure TypeScript, no three.js.
//
// Tree: every body / barycentre hangs under its immediate parent (`parents[0]`, skipping `Ring`
// belt-cluster parents). Parents that are referenced but unknown become placeholders ("?");
// unknown `Null` parents are barycentres (they are never scanned as bodies anyway).
//
// Layout: a node owns a disc of radius `extent` around itself that contains its body and its
// whole subsystem. Children of a body orbit on concentric, non-overlapping annuli (sorted by
// real distance), so siblings can sit at any angle without touching. A barycentre places its
// components (the stars or planets sharing one orbital period) on opposite sides with a combined
// separation of at least the sum of their discs, and circumbinary children outside of them.

import type { BodyView, Interest, OrbitView, ParentKind, ParentRef, SystemView } from '../api/types'

export type MapNodeKind = 'star' | 'planet' | 'barycentre' | 'placeholder'

export interface KeplerOrbit {
  epochMs: number
  /** null = no period: the body stays at its epoch angle. */
  periodS: number | null
  meanAnomalyRad: number
  eccentricity: number
  /** Longitude of periapsis in the flattened plane: ascending node + argument of periapsis. */
  longitudeRad: number
}

export type Phase = { kind: 'kepler'; orbit: KeplerOrbit } | { kind: 'fixed'; angle: number }

export type NodeRole = 'root' | 'orbit' | 'component'

export interface MapNode {
  id: number
  kind: MapNodeKind
  /** What a placeholder was referenced as (Star / Planet); null otherwise. */
  refKind: ParentKind | null
  body: BodyView | null
  /** The body's orbit, or the barycentre's (once scanned). */
  orbit: OrbitView | null
  parent: MapNode | null
  /** Components first (barycentres), then orbiting children by distance. */
  children: MapNode[]
  role: NodeRole
  /** Scene radius of the body sphere; 0 for barycentres. */
  size: number
  /** Free radius around the body (glow, rings) before the first child orbit. */
  clearance: number
  /** Radius of the disc around this node containing its body and whole subsystem. */
  extent: number
  /** Distance from the parent (0 for roots and lone barycentre components). */
  orbitRadius: number
  phase: Phase
  /** Added to the phase angle: components of one barycentre share the leader's phase. */
  angleOffset: number
  interest: Interest
  /** Highest interest in this node's subtree (drives orbit brightness). */
  subtreeInterest: Interest
  depth: number
}

export interface SystemLayout {
  roots: MapNode[]
  nodes: Map<number, MapNode>
  /** Fixed positions (x, z) of the roots, side by side, centred on the origin. */
  rootPositions: Map<number, [number, number]>
  /** Radius of a circle around the origin containing everything. */
  radius: number
}

const LS_M = 299_792_458
const SOLAR_MASS_EM = 332_946
const TAU = Math.PI * 2
const DEG = Math.PI / 180
/** Two children with periods this close (relative) orbit the barycentre as a pair. */
const PERIOD_MATCH = 0.01

const STAR_SIZE = { min: 1.25, max: 2.6, base: 1.6, perDecade: 0.5, pivot: 8.5, unknown: 1.6 }
const PLANET_SIZE = { min: 0.22, max: 1.1, base: 0.25, perDecade: 0.36, pivot: 5.3, unknown: 0.45 }
const PLACEHOLDER_SIZE = { star: 1.3, planet: 0.42 }
/** A moon is at most this fraction of the planet it orbits. */
const MOON_RATIO = 0.72
const CLEARANCE = { star: 1.9, planet: 1.22, ringsDefault: 2.4, ringsMin: 1.6, ringsMax: 3.2 }
const GAP = { factor: 0.4, min: 0.15 }
const ROOT_GAP = 6

const INTEREST_RANK: Record<Interest, number> = { low: 0, medium: 1, high: 2 }

export function maxInterest(a: Interest, b: Interest): Interest {
  return INTEREST_RANK[a] >= INTEREST_RANK[b] ? a : b
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mod = (v: number, m: number) => ((v % m) + m) % m
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/* ------------------------------------------------------------------------------------------ */
/* Phase                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Deterministic, well-spread angle for bodies without orbit data (golden angle). */
export function fallbackAngle(id: number): number {
  return mod(id * 137.50776405, 360) * DEG
}

export function toKepler(orbit: OrbitView | null | undefined): KeplerOrbit | null {
  if (!orbit || !finite(orbit.meanAnomalyDeg)) return null
  const epochMs = orbit.epoch ? Date.parse(orbit.epoch) : Number.NaN
  const periodS = finite(orbit.periodS) && orbit.periodS > 0 && Number.isFinite(epochMs) ? orbit.periodS : null
  const deg = (v: number | null) => (finite(v) ? v : 0)
  return {
    epochMs: Number.isFinite(epochMs) ? epochMs : 0,
    periodS,
    meanAnomalyRad: orbit.meanAnomalyDeg * DEG,
    eccentricity: clamp(deg(orbit.eccentricity), 0, 0.95),
    longitudeRad: (deg(orbit.ascendingNodeDeg) + deg(orbit.periapsisDeg)) * DEG,
  }
}

/** True longitude (radians) of a Keplerian orbit at `nowMs`, flattened into one plane. */
export function keplerAngle(o: KeplerOrbit, nowMs: number): number {
  const elapsedS = (nowMs - o.epochMs) / 1_000
  const m = mod(o.meanAnomalyRad + (o.periodS ? (TAU * elapsedS) / o.periodS : 0), TAU)
  const e = o.eccentricity
  // Kepler's equation M = E - e sin E (Newton).
  let ea = e < 0.8 ? m : Math.PI
  for (let i = 0; i < 12; i++) {
    const d = (ea - e * Math.sin(ea) - m) / (1 - e * Math.cos(ea))
    ea -= d
    if (Math.abs(d) < 1e-10) break
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(ea / 2), Math.sqrt(1 - e) * Math.cos(ea / 2))
  return mod(o.longitudeRad + nu, TAU)
}

export function phaseAngle(phase: Phase, nowMs: number): number {
  return phase.kind === 'kepler' ? keplerAngle(phase.orbit, nowMs) : phase.angle
}

/** Angle of a node around its parent at `nowMs`. */
export function nodeAngle(node: MapNode, nowMs: number): number {
  return mod(phaseAngle(node.phase, nowMs) + node.angleOffset, TAU)
}

/** Position (x, z) of a node relative to its parent. Angles grow counter-clockwise seen from +Y. */
export function localPosition(node: MapNode, nowMs: number): [number, number] {
  if (node.orbitRadius === 0) return [0, 0]
  const a = nodeAngle(node, nowMs)
  return [node.orbitRadius * Math.cos(a), -node.orbitRadius * Math.sin(a)]
}

/** Orbits smaller than the body itself (a heavy binary component barely wobbling) are not drawn. */
export function hasVisibleOrbit(node: MapNode): boolean {
  return node.parent !== null && node.orbitRadius > node.size * 1.6 + 0.05
}

/** World positions (x, z) of every node at `nowMs`. */
export function worldPositions(layout: SystemLayout, nowMs: number): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>()
  const visit = (node: MapNode, px: number, pz: number) => {
    const [lx, lz] = node.parent ? localPosition(node, nowMs) : [0, 0]
    const x = px + lx
    const z = pz + lz
    out.set(node.id, [x, z])
    for (const c of node.children) visit(c, x, z)
  }
  for (const root of layout.roots) {
    const [x, z] = layout.rootPositions.get(root.id) ?? [0, 0]
    visit(root, x, z)
  }
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* Tree                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const withoutRings = (refs: readonly ParentRef[] | null | undefined): ParentRef[] =>
  (refs ?? []).filter((r) => r.kind !== 'Ring')

type Source = Pick<SystemView, 'bodies' | 'barycentres'>

export function layoutSystem(system: Source): SystemLayout {
  const bodies = new Map(system.bodies.map((b) => [b.bodyId, b]))
  const barys = new Map(system.barycentres.map((b) => [b.bodyId, b]))
  const parentOf = new Map<number, number>()
  const refKind = new Map<number, ParentKind>()

  const chains: { self: number; chain: ParentRef[] }[] = []
  for (const b of system.bodies) chains.push({ self: b.bodyId, chain: withoutRings(b.parents) })
  for (const b of system.barycentres) chains.push({ self: b.bodyId, chain: withoutRings(b.parents) })

  // 1. Each record's own immediate parent is authoritative.
  for (const { self, chain } of chains) {
    if (chain.length > 0) parentOf.set(self, chain[0].bodyId)
  }
  // Bodies from journals without Parents: fall back to parentId.
  for (const b of system.bodies) {
    if (!parentOf.has(b.bodyId) && b.parentId != null && b.parentId !== b.bodyId && b.parents.length === 0) {
      parentOf.set(b.bodyId, b.parentId)
    }
  }
  // 2. Chains also tell us the ancestry of unscanned ancestors.
  for (const { chain } of chains) {
    chain.forEach((ref, i) => {
      if (!refKind.has(ref.bodyId)) refKind.set(ref.bodyId, ref.kind)
      const up = chain[i + 1]
      if (up && !parentOf.has(ref.bodyId)) parentOf.set(ref.bodyId, up.bodyId)
    })
  }
  for (const [id, p] of parentOf) if (p === id) parentOf.delete(id)

  const ids = new Set<number>([...bodies.keys(), ...barys.keys(), ...refKind.keys(), ...parentOf.values()])

  // 3. Break cycles (corrupt data): cut the link that closes the loop.
  for (const start of ids) {
    const path = new Set<number>()
    let cur: number | undefined = start
    while (cur !== undefined && !path.has(cur)) {
      path.add(cur)
      cur = parentOf.get(cur)
    }
    if (cur !== undefined) parentOf.delete(cur)
  }

  // 4. Nodes.
  const nodes = new Map<number, MapNode>()
  for (const id of ids) {
    const body = bodies.get(id) ?? null
    const declared = refKind.get(id) ?? null
    let kind: MapNodeKind
    if (body) kind = body.kind
    else if (barys.has(id) || declared === 'Null' || declared === null) kind = 'barycentre'
    else kind = 'placeholder'
    const interest: Interest = body?.interest ?? 'low'
    nodes.set(id, {
      id,
      kind,
      refKind: kind === 'placeholder' ? declared : null,
      body,
      orbit: body?.orbit ?? barys.get(id)?.orbit ?? null,
      parent: null,
      children: [],
      role: 'root',
      size: 0,
      clearance: 0,
      extent: 0,
      orbitRadius: 0,
      phase: { kind: 'fixed', angle: fallbackAngle(id) },
      angleOffset: 0,
      interest,
      subtreeInterest: interest,
      depth: 0,
    })
  }
  for (const [id, p] of parentOf) {
    const node = nodes.get(id)
    const parent = nodes.get(p)
    if (!node || !parent) continue
    node.parent = parent
    parent.children.push(node)
  }
  // Barycentres with no body under them (scanned, but nothing known orbits them yet) are noise:
  // they would take an orbit slot or sit alone beside the system.
  const hasContent = (n: MapNode): boolean => n.kind !== 'barycentre' || n.children.some(hasContent)
  for (const n of [...nodes.values()]) {
    if (hasContent(n)) continue
    nodes.delete(n.id)
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n)
  }

  const roots = [...nodes.values()].filter((n) => !n.parent)
  const estLs = makeDistanceEstimator()

  // 5. Top-down: depth, sizes, child order.
  const down = (node: MapNode, depth: number) => {
    node.depth = depth
    node.size = bodySize(node)
    node.clearance = clearanceOf(node)
    sortChildren(node, estLs)
    for (const c of node.children) down(c, depth + 1)
  }
  for (const r of roots) down(r, 0)

  // 6. Bottom-up: radii, extents, phases, interest.
  const up = (node: MapNode) => {
    for (const c of node.children) up(c)
    for (const c of node.children) node.subtreeInterest = maxInterest(node.subtreeInterest, c.subtreeInterest)
    if (node.kind === 'barycentre') layoutBarycentre(node)
    else layoutBody(node)
  }
  for (const r of roots) up(r)

  // 7. Roots side by side: main system (largest) first, then by id.
  const count = (n: MapNode): number => 1 + n.children.reduce((a, c) => a + count(c), 0)
  roots.sort((a, b) => count(b) - count(a) || a.id - b.id)
  const rootPositions = new Map<number, [number, number]>()
  let x = 0
  roots.forEach((r, i) => {
    if (i > 0) x += roots[i - 1].extent + ROOT_GAP + r.extent
    rootPositions.set(r.id, [x, 0])
  })
  let radius = 0
  if (roots.length > 0) {
    const left = -roots[0].extent
    const right = x + roots[roots.length - 1].extent
    const shift = (left + right) / 2
    for (const r of roots) {
      const [rx] = rootPositions.get(r.id)!
      rootPositions.set(r.id, [rx - shift, 0])
      radius = Math.max(radius, Math.abs(rx - shift) + r.extent)
    }
  }

  return { roots, nodes, rootPositions, radius }
}

/* ------------------------------------------------------------------------------------------ */
/* Sizes                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function radiusM(body: BodyView): number | null {
  const r = body.visual?.radiusM ?? (body.radiusKm != null ? body.radiusKm * 1_000 : null)
  return r != null && r > 0 ? r : null
}

function logScale(r: number | null, s: typeof STAR_SIZE): number {
  if (r == null) return s.unknown
  return clamp(s.base + s.perDecade * (Math.log10(r) - s.pivot), s.min, s.max)
}

/** Nearest ancestor that is a planet (through barycentres), stopping at stars. */
function planetAncestor(node: MapNode): MapNode | null {
  for (let p = node.parent; p; p = p.parent) {
    if (p.kind === 'star' || (p.kind === 'placeholder' && p.refKind === 'Star')) return null
    if (p.kind === 'planet' || p.kind === 'placeholder') return p
  }
  return null
}

function bodySize(node: MapNode): number {
  let size: number
  if (node.kind === 'barycentre') return 0
  if (node.kind === 'star') size = logScale(radiusM(node.body!), STAR_SIZE)
  else if (node.kind === 'planet') size = logScale(radiusM(node.body!), PLANET_SIZE)
  else size = node.refKind === 'Star' ? PLACEHOLDER_SIZE.star : PLACEHOLDER_SIZE.planet
  if (node.kind !== 'star') {
    const host = planetAncestor(node)
    if (host) size = Math.min(size, host.size * MOON_RATIO)
  }
  return size
}

function clearanceOf(node: MapNode): number {
  if (node.kind === 'barycentre') return 0
  if (node.kind === 'star' || (node.kind === 'placeholder' && node.refKind === 'Star')) {
    return node.size * CLEARANCE.star
  }
  const body = node.body
  const r = body ? radiusM(body) : null
  const rings = body?.visual?.rings ?? []
  if (rings.length > 0) {
    const outer = Math.max(0, ...rings.map((ring) => ring.outerM ?? 0))
    const ratio = r && outer > r ? clamp(outer / r, CLEARANCE.ringsMin, CLEARANCE.ringsMax) : CLEARANCE.ringsDefault
    return node.size * ratio
  }
  return node.size * CLEARANCE.planet
}

/** Spacing between neighbouring orbits around `node`. */
function gapOf(node: MapNode): number {
  const scale = node.kind === 'barycentre' ? Math.max(0, ...node.children.map((c) => c.size)) || 1 : node.size
  return Math.max(GAP.min, GAP.factor * scale)
}

/* ------------------------------------------------------------------------------------------ */
/* Ordering                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function makeDistanceEstimator() {
  const cache = new Map<number, number | null>()
  const est = (node: MapNode): number | null => {
    if (cache.has(node.id)) return cache.get(node.id)!
    const own = node.body?.distanceLs
    let d: number | null = finite(own) ? own : null
    if (d == null) {
      for (const c of node.children) {
        const cd = est(c)
        if (cd != null) d = d == null ? cd : Math.min(d, cd)
      }
    }
    cache.set(node.id, d)
    return d
  }
  return est
}

function smaOf(node: MapNode): number | null {
  const a = node.orbit?.semiMajorAxisM
  return finite(a) && a > 0 ? a : null
}

function periodOf(node: MapNode): number | null {
  const p = node.orbit?.periodS
  return finite(p) && p > 0 ? p : null
}

function sortChildren(node: MapNode, estLs: (n: MapNode) => number | null) {
  const parentLs = estLs(node)
  const key = (c: MapNode): number => {
    const sma = smaOf(c)
    if (sma != null) return sma
    const d = estLs(c)
    if (d != null && parentLs != null) return Math.abs(d - parentLs) * LS_M
    return Number.POSITIVE_INFINITY
  }
  const keys = new Map(node.children.map((c) => [c.id, key(c)]))
  node.children.sort((a, b) => {
    const ka = keys.get(a.id)!
    const kb = keys.get(b.id)!
    if (ka !== kb) return ka < kb ? -1 : 1
    return a.id - b.id
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Radii                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function ownPhase(node: MapNode): Phase {
  const orbit = toKepler(node.orbit)
  return orbit ? { kind: 'kepler', orbit } : { kind: 'fixed', angle: fallbackAngle(node.id) }
}

/** Children orbiting on consecutive annuli starting at `inner`; returns the outer edge. */
function stackOrbits(children: MapNode[], inner: number, gap: number): number {
  let edge = inner
  for (const c of children) {
    c.role = 'orbit'
    c.orbitRadius = edge + gap + c.extent
    c.phase = ownPhase(c)
    c.angleOffset = 0
    edge = c.orbitRadius + c.extent
  }
  return edge
}

function layoutBody(node: MapNode) {
  const edge = stackOrbits(node.children, node.clearance, gapOf(node))
  node.extent = Math.max(node.clearance, edge, node.size)
}

function mass(node: MapNode): number | null {
  const v = node.body?.visual
  if (!v) return null
  if (v.stellarMass != null && v.stellarMass > 0) return v.stellarMass * SOLAR_MASS_EM
  if (v.massEm != null && v.massEm > 0) return v.massEm
  return null
}

/** Components of a barycentre: the children that share the innermost child's orbital period. */
function splitComponents(children: MapNode[]): [MapNode[], MapNode[]] {
  if (children.length <= 1) return [children, []]
  const leader = children[0]
  const pl = periodOf(leader)
  if (pl != null) {
    const comps = children.filter((c) => {
      const p = periodOf(c)
      return c === leader || (p != null && Math.abs(p - pl) / pl < PERIOD_MATCH)
    })
    const othersKnown = children.every((c) => c === leader || periodOf(c) != null)
    if (comps.length >= 2 || othersKnown) return [comps, children.filter((c) => !comps.includes(c))]
  }
  return [children.slice(0, 2), children.slice(2)]
}

function layoutBarycentre(node: MapNode) {
  const [comps, outer] = splitComponents(node.children)
  const gap = gapOf(node)
  let edge = 0

  // Shared phase: the first component with orbit data leads; the rest are spread evenly.
  const k = comps.length
  const step = k > 0 ? TAU / k : 0
  let phase: Phase = { kind: 'fixed', angle: fallbackAngle(node.id) }
  for (let i = 0; i < k; i++) {
    const own = ownPhase(comps[i])
    if (own.kind === 'kepler') {
      phase = own
      // Component i sits at offset i*step; shift so that this one keeps its real angle.
      comps.forEach((c, j) => (c.angleOffset = (j - i) * step))
      break
    }
    comps.forEach((c, j) => (c.angleOffset = j * step))
  }
  for (const c of comps) {
    c.role = 'component'
    c.phase = phase
  }

  if (k === 1) {
    comps[0].orbitRadius = 0
    comps[0].angleOffset = 0
    edge = comps[0].extent
  } else if (k === 2) {
    const [a, b] = comps
    const total = a.extent + b.extent + gap
    // Share of the separation on a's side: real orbit sizes, else masses, else the bigger disc inside.
    const sa = smaOf(a)
    const sb = smaOf(b)
    const ma = mass(a)
    const mb = mass(b)
    let q: number
    if (sa != null && sb != null) q = sa / (sa + sb)
    else if (ma != null && mb != null) q = mb / (ma + mb)
    else q = b.extent / (a.extent + b.extent || 1)
    a.orbitRadius = total * q
    b.orbitRadius = total * (1 - q)
    edge = Math.max(a.orbitRadius + a.extent, b.orbitRadius + b.extent)
  } else if (k > 2) {
    let r = 0
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const m = Math.min(j - i, k - (j - i))
        r = Math.max(r, (comps[i].extent + comps[j].extent + gap) / (2 * Math.sin((Math.PI * m) / k)))
      }
    }
    for (const c of comps) c.orbitRadius = r
    edge = Math.max(...comps.map((c) => r + c.extent))
  }

  edge = stackOrbits(outer, edge, gap)
  node.extent = Math.max(edge, gap)
}

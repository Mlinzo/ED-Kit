// Shared geometries, a ref-counted resource cache, and the 1D ring texture generator.

import {
  AddEquation,
  ClampToEdgeWrapping,
  CustomBlending,
  OneFactor,
  ZeroFactor,
  ConeGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  PlaneGeometry,
  RGBAFormat,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  UnsignedByteType,
  type Texture,
} from 'three'
import { hash01, hexToRgb } from './palette'
import type { RingBand } from './recipe'

// Unit-sized geometries shared by every body (scaled per mesh).
export const SPHERE = new SphereGeometry(1, 64, 40)
/** Level of detail for bodies that are small on screen (see useDetail). */
export const SPHERE_MID = new SphereGeometry(1, 32, 20)
/** For the outer atmosphere halo and black hole cores (nothing close underneath). */
export const SPHERE_LOW = new SphereGeometry(1, 40, 26)
/** A planet seen up close (the Surface globe): a smooth outline when it fills the screen. */
export const SPHERE_FINE = new SphereGeometry(1, 160, 100)
export const QUAD = new PlaneGeometry(2, 2)

const ringGeos = new Map<string, RingGeometry>()
/** Flat ring in the XY plane between inner and outer radius (cached by radii). */
export function ringGeometry(inner: number, outer: number): RingGeometry {
  const key = `${inner.toFixed(3)}:${outer.toFixed(3)}`
  let g = ringGeos.get(key)
  if (!g) {
    g = new RingGeometry(inner, outer, 160, 1)
    ringGeos.set(key, g)
  }
  return g
}

let jet: ConeGeometry | null = null
/** Open cone with its apex at the origin, opening along +Y up to y = 1. */
export function jetGeometry(): ConeGeometry {
  if (!jet) {
    jet = new ConeGeometry(0.16, 1, 28, 1, true)
    jet.rotateX(Math.PI) // apex down
    jet.translate(0, 0.5, 0)
  }
  return jet
}

/**
 * Additive colour that leaves destination alpha untouched, so glows also composite correctly
 * on a transparent canvas (plain AdditiveBlending would write opaque black where they fade out).
 */
export const ADDITIVE = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const

/** Raycast stub for decorative meshes (glows, shells): never intercept map clicks. */
export function noRaycast() {}

// ---------------------------------------------------------------------------------------------
// Ref-counted cache for renderer-independent resources (CPU textures).

interface Shared {
  value: { dispose(): void }
  refs: number
  timer: ReturnType<typeof setTimeout> | null
}
const sharedCache = new Map<string, Shared>()

function scheduleSharedDispose(key: string, s: Shared) {
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    s.timer = null
    if (s.refs > 0) return
    if (sharedCache.get(key) === s) sharedCache.delete(key)
    s.value.dispose()
  }, 4000)
}

export function acquireShared<T extends { dispose(): void }>(key: string, create: () => T): T {
  let s = sharedCache.get(key)
  if (!s) {
    s = { value: create(), refs: 0, timer: null }
    sharedCache.set(key, s)
    scheduleSharedDispose(key, s)
  }
  return s.value as T
}

export function retainShared(key: string) {
  const s = sharedCache.get(key)
  if (!s) return
  s.refs++
  if (s.timer) {
    clearTimeout(s.timer)
    s.timer = null
  }
}

export function releaseShared(key: string) {
  const s = sharedCache.get(key)
  if (!s) return
  s.refs = Math.max(0, s.refs - 1)
  if (s.refs === 0) scheduleSharedDispose(key, s)
}

// ---------------------------------------------------------------------------------------------
// Ring texture: 1024 x 1, sRGB colour + density alpha, over [inner, outer] planet radii.

function valueNoise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = hash01(i + seed * 7919, 3)
  const b = hash01(i + 1 + seed * 7919, 3)
  return a + (b - a) * u
}

function fbm1(x: number, seed: number, octaves = 4): number {
  let s = 0
  let a = 0.5
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    s += a * valueNoise1(x, seed + i * 13)
    norm += a
    x *= 2.13
    a *= 0.5
  }
  return s / norm
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function ringTextureKey(bands: RingBand[], inner: number, outer: number, seed: number): string {
  return `ring:${seed}:${inner.toFixed(3)}:${outer.toFixed(3)}:${bands
    .map((b) => `${b.inner.toFixed(3)}-${b.outer.toFixed(3)}-${b.color}`)
    .join('|')}`
}

export function createRingTexture(bands: RingBand[], inner: number, outer: number, seed: number): Texture {
  const W = 1024
  const data = new Uint8Array(W * 4)
  const cols = bands.map((b) => hexToRgb(b.color))
  // Colour carried into gaps so filtering never fades ring edges toward black.
  let last: [number, number, number] = cols[0] ?? [180, 170, 160]
  for (let x = 0; x < W; x++) {
    const r = inner + ((outer - inner) * (x + 0.5)) / W
    let alpha = 0
    let cr = 0
    let cg = 0
    let cb = 0
    let wsum = 0
    bands.forEach((b, i) => {
      if (r < b.inner || r > b.outer) return
      const t = (r - b.inner) / (b.outer - b.inner)
      const width = b.outer - b.inner
      const edge = smooth(0, 0.025 / Math.max(width, 0.05), t) * smooth(1, 1 - 0.02 / Math.max(width, 0.05), t)
      const broad = fbm1(r * 3.5, seed + i * 31)
      const coarse = fbm1(r * 14, seed + i * 31 + 2)
      const fine = fbm1(r * 60, seed + i * 31 + 5, 3)
      const gap = 1 - 0.8 * smooth(0.72, 0.8, valueNoise1(r * 5 + i * 3.3, seed + 101))
      const innerFade = 0.4 + 0.6 * smooth(0, 0.35, t)
      const d = Math.min(1, 1.3 * edge * (0.3 + 0.7 * broad) * (0.75 + 0.35 * coarse) * (0.88 + 0.16 * fine) * gap * innerFade)
      const k = 0.82 + 0.25 * broad + 0.1 * (fine - 0.5)
      alpha = 1 - (1 - alpha) * (1 - Math.min(1, d))
      cr += cols[i][0] * k * d
      cg += cols[i][1] * k * d
      cb += cols[i][2] * k * d
      wsum += d
    })
    const o = x * 4
    if (wsum > 0) last = [Math.min(255, cr / wsum), Math.min(255, cg / wsum), Math.min(255, cb / wsum)]
    data[o] = last[0]
    data[o + 1] = last[1]
    data[o + 2] = last[2]
    data[o + 3] = Math.round(Math.min(0.92, alpha) * 255)
  }
  const tex = new DataTexture(data, W, 1, RGBAFormat, UnsignedByteType)
  tex.colorSpace = SRGBColorSpace
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

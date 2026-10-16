// Turns journal facts (BodyVisual) into a planet "recipe": bake parameters for the surface and
// cloud textures, atmosphere, rings, material tweaks and motion. Pure data, no three.js.

import type { BodyVisual } from '../../api/types'
import {
  GAS_PALETTES,
  compositionTint,
  hash01,
  mixHex,
  planetFamily,
  ringTint,
  scaleHex,
  surfaceKind,
  type PlanetFamily,
  type SurfaceKind,
} from './palette'

/** Bake parameter: '#rrggbb' colour, number, or vector. */
export type Param = string | number | number[]
export type Params = Record<string, Param>

export interface RingBand {
  /** Radii in planet radii. */
  inner: number
  outer: number
  color: string
}

export interface PlanetRecipe {
  family: PlanetFamily
  kind: SurfaceKind
  surface: { program: SurfaceKind; params: Params }
  clouds: Params | null
  atmosphere: { tint: string; strength: number; scale: number; haze: number } | null
  rings: { inner: number; outer: number; bands: RingBand[]; seed: number } | null
  material: {
    roughness: number
    metalness: number
    bump: number
    /** Height (texture alpha) below which the surface is liquid and glossy; -1 = no oceans. */
    sea: number
    /** Lava channel glow (night side) 0..1 and colour. */
    lava: number
    lavaColor: string
    /** Self-glow of hot gas giants 0..1 and colour. */
    glow: number
    glowColor: string
  }
  /** Spin in rad/s (negative = retrograde). */
  spin: number
  tilt: number
  tiltAzimuth: number
}

/** Lava channels are carved below this texture height (see the rocky bake shader). */
export const LAVA_LEVEL = 0.16

/**
 * How dense an atmosphere looks, 0 (a trace, ~0.001 atm) .. 1 (~30 atm and more), from the surface
 * pressure on a log scale; null when the pressure is unknown or there is no atmosphere.
 */
export function atmosphereDensity(pressureAtm: number | null | undefined): number | null {
  if (pressureAtm == null || !Number.isFinite(pressureAtm) || pressureAtm <= 0) return null
  return Math.min(1, Math.max(0, (Math.log10(pressureAtm) + 3) / 4.5))
}

/** Surface pressure (atm) from which a rocky or icy world is veiled in haze. */
const HAZE_PRESSURE_ATM = 3

const RAD = Math.PI / 180

function pick<T>(list: T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))]
}

function jitter(hex: string, r: number, amount = 0.1): string {
  return scaleHex(hex, 1 - amount + 2 * amount * r)
}

function seedVec(seed: number): number[] {
  return [hash01(seed, 1) * 97 - 48, hash01(seed, 2) * 97 - 48, hash01(seed, 3) * 97 - 48]
}

/** Rotation speed: gentle, log-compressed; tidally locked bodies turn slower. */
export function spinFromPeriod(periodS: number | null, tidalLock: boolean | null): number {
  const base = 0.06
  if (periodS == null || !Number.isFinite(periodS) || periodS === 0) return base
  const hours = Math.abs(periodS) / 3600
  let w = 0.55 / Math.sqrt(Math.max(1, hours))
  w = Math.min(0.32, Math.max(0.018, w))
  if (tidalLock) w *= 0.5
  return Math.sign(periodS) * w
}

function hasMagma(volcanism: string | null): boolean {
  const v = (volcanism ?? '').toLowerCase()
  return v.includes('magma') || v.includes('lava')
}

function rockyParams(f: PlanetFamily, v: BodyVisual, seed: number) {
  const r = (n: number) => hash01(seed, n)
  const T = v.temperatureK ?? 200
  const comp = v.composition ?? {}
  const ice = comp.Ice ?? (f === 'icy' ? 0.85 : f === 'rocky_ice' ? 0.35 : 0)
  const metal = comp.Metal ?? (f === 'metal_rich' ? 0.6 : f === 'hmc' ? 0.3 : 0.12)

  let palette: string[]
  let craters = 0.85
  let rough = 0.5
  let maria = 0.4
  let cracks = 0
  let crackCol = '#8a6a55'
  let iceCol = '#eef3f8'
  let roughness = 0.92
  let metalness = 0
  let bump = 0.05

  switch (f) {
    case 'metal_rich':
      palette = pick(
        [
          ['#211e1c', '#45403b', '#6b625a', '#5c4a3e'],
          ['#24201f', '#4a3f38', '#75655a', '#7a5a44'],
          ['#1f2022', '#43444a', '#6c6b6c', '#5a5550'],
        ],
        r(10),
      )
      craters = 0.65
      rough = 0.85
      maria = 0.2
      roughness = 0.58
      metalness = 0.35
      bump = 0.056
      break
    case 'hmc':
      palette = pick(
        [
          ['#2c2420', '#5f5046', '#9a8572', '#7d5d47'],
          ['#2f221c', '#6a4636', '#a67c5e', '#8a5a3e'],
          ['#28292d', '#56575b', '#8f8b85', '#6e5e52'],
          ['#30281f', '#685843', '#a28b6e', '#7a6a50'],
        ],
        r(10),
      )
      craters = 0.75
      rough = 0.7
      maria = 0.3
      roughness = 0.86
      metalness = 0.08
      break
    case 'icy':
      palette = pick(
        [
          ['#93a6b8', '#c4d2df', '#eef3f8', '#b5c4d3'],
          ['#a3aab2', '#cfd5da', '#f2f4f5', '#c9c1b5'],
          ['#8ea3bd', '#bccde0', '#e9f1f9', '#a9bfd8'],
        ],
        r(10),
      )
      craters = 0.45
      rough = 0.25
      maria = 0.15
      cracks = 0.45 + 0.5 * r(11)
      crackCol = pick(['#9a6f58', '#a5806a', '#8a6250', '#7f95b0'], r(12))
      roughness = 0.6
      bump = 0.03
      break
    case 'rocky_ice':
      palette = pick(
        [
          ['#5f584f', '#968c7e', '#cfccc5', '#bfc8d0'],
          ['#55524f', '#8b8782', '#c9cbcd', '#a99d8c'],
        ],
        r(10),
      )
      craters = 0.75
      rough = 0.45
      maria = 0.3
      cracks = 0.2
      crackCol = '#7d7468'
      roughness = 0.8
      break
    default:
      palette = pick(
        [
          ['#46423e', '#7a746d', '#a69f96', '#8a7560'],
          ['#55362a', '#955c3e', '#c18a5f', '#7b4a35'],
          ['#463a31', '#7c6856', '#a8937c', '#6f5a48'],
          ['#4f4a44', '#8b8072', '#b6aa97', '#9a7d5c'],
        ],
        r(10),
      )
      break
  }
  palette = palette.map((c, i) => jitter(c, r(20 + i), 0.07))

  // Composition: metal darkens, ice whitens.
  if (f !== 'icy' && ice > 0.05) {
    const t = Math.min(0.6, ice * 0.8)
    palette = palette.map((c, i) => mixHex(c, ['#9fb0c0', '#c4d2df', '#eef3f8', '#b5c4d3'][i], t))
  }
  if (metal > 0.3 && f !== 'metal_rich') palette = palette.map((c) => scaleHex(c, 1 - (metal - 0.3) * 0.5))

  // Temperature: cold -> frost and caps; very hot -> scorched.
  let frost = 0
  let caps = 1.2
  if (f !== 'icy') {
    if (T < 90) {
      frost = 0.55
      caps = 0.72
    } else if (T < 170) {
      frost = 0.25
      caps = 0.84
    } else if (T < 240) caps = 0.93
  } else {
    caps = 0.86
    iceCol = '#f7fbff'
  }
  if (f === 'rocky_ice') caps = Math.min(caps, 0.86 - ice * 0.15)
  if (T > 700) {
    const k = Math.min(1, (T - 700) / 1200)
    palette = palette.map((c, i) => mixHex(c, ['#1c1614', '#3a2c26', '#5a463a', '#5a2e1e'][i], 0.25 + 0.4 * k))
  }

  let lava = 0
  if (hasMagma(v.volcanism)) lava = T > 400 ? 1 : 0.65
  else if ((v.volcanism ?? '').toLowerCase().includes('silicate')) lava = 0.4
  if (T > 1100) lava = Math.max(lava, Math.min(1, (T - 1100) / 900 + 0.35))
  if (f === 'icy') lava = 0

  const params: Params = {
    uSeed: seedVec(seed),
    uC0: palette[0],
    uC1: palette[1],
    uC2: palette[2],
    uC3: palette[3],
    uIceCol: iceCol,
    uCrackCol: crackCol,
    uIce: f === 'icy' ? 1 : f === 'rocky_ice' ? Math.max(0.3, ice) : 0,
    uCaps: caps,
    uCraters: craters,
    uCracks: cracks,
    uRough: rough,
    uMaria: maria,
    uFrost: frost,
    uLava: lava,
    uLavaLevel: LAVA_LEVEL,
  }
  return { params, roughness, metalness, bump, lava }
}

function gasParams(f: PlanetFamily, seed: number) {
  const r = (n: number) => hash01(seed, n)
  const pal = GAS_PALETTES[f] ?? GAS_PALETTES.sudarsky1!
  const calm = f === 'sudarsky2' || f === 'helium' || f === 'helium_rich'
  const water = f === 'water_giant' || f === 'water_giant_life'
  let stormCol = r(30) < 0.5 ? mixHex(pal[1], '#b8503a', 0.5) : pal[4]
  if (f === 'sudarsky3' || water) stormCol = r(30) < 0.5 ? pal[0] : pal[4]
  if (calm) stormCol = pal[4]
  if (f === 'sudarsky5') stormCol = '#ffe7b0'

  const storms: number[][] = []
  const count = calm ? 1 : 1 + Math.floor(r(31) * 3)
  for (let i = 0; i < 3; i++) {
    if (i >= count) {
      storms.push([0, 0, 0.01, 0])
      continue
    }
    const lat = (r(40 + i) * 2 - 1) * 0.75
    const lon = r(50 + i) * Math.PI * 2
    const size = i === 0 ? 0.12 + r(60) * 0.1 : 0.05 + r(60 + i) * 0.06
    const calmish = water || f === 'sudarsky3'
    const strength = (i === 0 ? 0.9 : 0.6) * (calmish ? 0.45 : 1) * (r(70 + i) < 0.5 ? 1 : -1)
    storms.push([lat, lon, size, strength])
  }
  return {
    uSeed: seedVec(seed),
    uP0: pal[0],
    uP1: pal[1],
    uP2: pal[2],
    uP3: pal[3],
    uP4: pal[4],
    uBands: (calm ? 7 : 9) + r(80) * (calm ? 5 : 8),
    uTurb: calm ? 0.3 + r(81) * 0.2 : water || f === 'sudarsky3' ? 0.35 + r(81) * 0.25 : 0.75 + r(81) * 0.4,
    uContrast: calm ? 0.45 : f === 'sudarsky3' || water ? 0.55 : 1.0,
    uStorm0: storms[0],
    uStorm1: storms[1],
    uStorm2: storms[2],
    uStormCol: stormCol,
    uLife: f === 'water_giant_life' || f === 'gg_water_life' ? 1 : f === 'gg_ammonia_life' ? 0.6 : 0,
    uLifeCol: f === 'gg_ammonia_life' ? '#8a4f78' : '#4fae6a',
  } satisfies Params
}

function terraParams(f: PlanetFamily, v: BodyVisual, seed: number, terraformed: boolean) {
  const r = (n: number) => hash01(seed, n)
  const T = v.temperatureK ?? 280
  const base = {
    uSeed: seedVec(seed),
    uDeep: '#06224e',
    uShallow: '#1a6c9e',
    uLandLow: '#2e6a22',
    uLandHigh: '#5e7c32',
    uDesert: '#c9a35c',
    uTundra: '#8a8a72',
    uRock: '#6e5f50',
    uIceCol: '#f4f8fb',
    uSea: 0.55 + r(90) * 0.08,
    uCaps: T < 250 ? 0.7 : T > 320 ? 0.97 : 0.84,
    uVeg: 1,
  }
  if (f === 'ww') {
    return {
      ...base,
      uDeep: '#071d4c',
      uShallow: '#1a5d9c',
      uLandLow: '#56664c',
      uLandHigh: '#7a7a62',
      uDesert: '#9a8a68',
      uSea: 0.82 + r(90) * 0.08,
      uVeg: 0.2,
      uCaps: T < 260 ? 0.72 : T > 340 ? 1.2 : 0.88,
    }
  }
  if (f === 'aw') {
    return {
      ...base,
      uDeep: '#3a2212',
      uShallow: '#6e4424',
      uLandLow: '#9a6538',
      uLandHigh: '#c08a50',
      uDesert: '#d9ae6c',
      uTundra: '#a07e5e',
      uRock: '#6a4630',
      uIceCol: '#efe0c0',
      uSea: 0.3 + r(90) * 0.12,
      uVeg: 0,
      uCaps: 0.82,
    }
  }
  if (terraformed) {
    return { ...base, uSea: 0.42 + r(90) * 0.1, uVeg: 0.6, uLandLow: '#4f6a34', uDesert: '#a8865a' }
  }
  return base
}

interface RawBand {
  inner: number
  outer: number
  color: string
}

/** Ring bands in planet radii (real proportions when known), innermost first; null without rings. */
function rawBands(v: BodyVisual): RawBand[] | null {
  const rings = v.rings ?? []
  if (rings.length === 0) return null
  const R = v.radiusM && v.radiusM > 0 ? v.radiusM : null
  const raw = rings.map((ring, i) => {
    let inner = R && ring.innerM ? ring.innerM / R : 1.45 + i * 0.5
    let outer = R && ring.outerM ? ring.outerM / R : inner + 0.6
    if (!(outer > inner)) outer = inner + 0.4
    inner = Math.max(inner, 1.0)
    return { inner, outer, color: ringTint(ring.ringClass) }
  })
  raw.sort((a, b) => a.inner - b.inner)
  return raw
}

const RING_MIN_INNER = 1.25

/** Outer edge of the drawn rings (squeezed, see ringBands), quantized so bodies share geometries. */
function ringOuter(raw: RawBand[]): number {
  const lo = raw[0].inner
  const hi = Math.max(...raw.map((b) => b.outer))
  return Math.round(Math.min(2.7, Math.max(1.9, RING_MIN_INNER + (hi - lo) * 0.9)) * 20) / 20
}

/** Outer radius of a planet's drawn rings in planet radii, or null without rings (map sizing). */
export function ringOuterRadius(v: BodyVisual): number | null {
  const raw = rawBands(v)
  return raw ? ringOuter(raw) : null
}

function ringBands(v: BodyVisual, seed: number): PlanetRecipe['rings'] {
  const raw = rawBands(v)
  if (!raw) return null
  // Not to scale: squeeze into a pleasant band 1.25..2.7 radii, keeping relative proportions.
  const lo = raw[0].inner
  const hi = Math.max(...raw.map((b) => b.outer))
  const minIn = RING_MIN_INNER
  const maxOut = ringOuter(raw)
  const map = (x: number) => minIn + ((x - lo) / Math.max(1e-6, hi - lo)) * (maxOut - minIn)
  const bands = raw.map((b) => ({ inner: map(b.inner), outer: map(b.outer), color: b.color }))
  return { inner: minIn, outer: maxOut, bands, seed }
}

export function planetRecipe(v: BodyVisual, seed: number): PlanetRecipe {
  const family = planetFamily(v.planetClass)
  const kind = surfaceKind(family)
  const T = v.temperatureK ?? 200
  const atmoType = (v.atmosphereType ?? '').trim()
  const hasAtmo = atmoType !== '' && atmoType.toLowerCase() !== 'none'
  const terraState = (v.terraformState ?? '').toLowerCase()
  const terraformable = terraState === 'terraformable'
  const terraformed = terraState === 'terraformed' || terraState === 'terraforming'
  const r = (n: number) => hash01(seed, n)

  const material: PlanetRecipe['material'] = {
    roughness: 0.92,
    metalness: 0,
    bump: 0,
    sea: -1,
    lava: 0,
    lavaColor: '#ff5a1e',
    glow: 0,
    glowColor: '#ff7a2a',
  }
  let surface: PlanetRecipe['surface']
  let clouds: Params | null = null
  let atmosphere: PlanetRecipe['atmosphere'] = null

  if (kind === 'rocky' && terraformed) {
    const p = terraParams('elw', v, seed, true)
    surface = { program: 'terra', params: p }
    material.sea = 0.12
    material.bump = 0.012
    material.roughness = 0.88
  } else if (kind === 'rocky') {
    const p = rockyParams(family, v, seed)
    surface = { program: 'rocky', params: p.params }
    material.roughness = p.roughness
    material.metalness = p.metalness
    material.bump = p.bump
    material.lava = p.lava
  } else if (kind === 'terra') {
    const p = terraParams(family, v, seed, false)
    surface = { program: 'terra', params: p }
    material.sea = 0.12
    material.bump = family === 'aw' ? 0.01 : 0.014
    material.roughness = 0.9
  } else {
    surface = { program: 'gas', params: gasParams(family, seed) }
    material.roughness = 0.95
    if (family === 'sudarsky5') {
      material.glow = 0.55
      material.glowColor = '#ff8a3a'
    } else if (family === 'sudarsky4') {
      material.glow = 0.22
      material.glowColor = '#c2502a'
    }
  }

  // Pressure (when known) tells thin from thick atmospheres; otherwise hot ones are taken as thick.
  const pressure = v.surfacePressureAtm
  const density = hasAtmo ? atmosphereDensity(pressure) : null
  const tint = compositionTint(v.atmosphereComposition, atmoType)

  // Clouds
  if (family === 'elw' || (kind === 'rocky' && terraformed)) {
    clouds = { uSeed: seedVec(seed + 7), uCover: 0.34 + r(100) * 0.1, uCol: '#ffffff', uBanding: 0.12 }
  } else if (family === 'ww') {
    clouds = { uSeed: seedVec(seed + 7), uCover: 0.44 + r(100) * 0.12, uCol: '#f2f7ff', uBanding: 0.25 }
  } else if (family === 'aw') {
    clouds = { uSeed: seedVec(seed + 7), uCover: 0.42 + r(100) * 0.12, uCol: '#ead09c', uBanding: 0.75 }
  } else if (kind === 'rocky' && hasAtmo && pressure != null && pressure >= HAZE_PRESSURE_ATM) {
    // A dense atmosphere veils the surface: the denser, the more (Venus-like when hot).
    const k = Math.min(1, (Math.log10(pressure / HAZE_PRESSURE_ATM) + 0.1) / 2.2)
    clouds = {
      uSeed: seedVec(seed + 7),
      uCover: 0.55 + 0.42 * k,
      uCol: mixHex(tint, T > 550 ? '#f2e6cc' : '#eef2f6', 0.55),
      uBanding: 0.75,
    }
  } else if (kind === 'rocky' && hasAtmo && pressure == null && T > 550 && family !== 'icy') {
    // Pressure unknown: hot, non-landable-looking worlds read as thick Venus-like hazes.
    clouds = {
      uSeed: seedVec(seed + 7),
      uCover: 0.95,
      uCol: mixHex(tint, '#f2e6cc', 0.55),
      uBanding: 0.75,
    }
  }

  // Atmosphere rim
  if (kind === 'gas') {
    const pal = GAS_PALETTES[family] ?? GAS_PALETTES.sudarsky1!
    atmosphere = { tint: mixHex(pal[3], '#9cc4ff', 0.35), strength: 0.55, scale: 1.07, haze: 0.25 }
  } else if (family === 'elw' || terraformed) {
    atmosphere = { tint: '#5aa2ff', strength: 1.15, scale: 1.065, haze: 0.35 }
  } else if (family === 'ww') {
    atmosphere = { tint: '#6fb2ff', strength: 1.1, scale: 1.065, haze: 0.55 }
  } else if (family === 'aw') {
    atmosphere = { tint: '#e2b26e', strength: 1.0, scale: 1.065, haze: 0.5 }
  } else if (hasAtmo && density != null) {
    // A trace is a faint thin line at the limb; a thick one a wide, hazy glow.
    atmosphere = {
      tint,
      strength: 0.3 + 0.95 * density,
      scale: 1.025 + 0.05 * density,
      haze: 0.06 + 0.6 * density,
    }
  } else if (hasAtmo) {
    const thick = clouds != null
    atmosphere = {
      tint,
      strength: thick ? 1.0 : 0.6,
      scale: thick ? 1.06 : 1.04,
      haze: thick ? 0.5 : 0.18,
    }
  }
  if (terraformable) {
    // A faint "habitable" teal sheen marks terraform candidates.
    atmosphere = atmosphere
      ? { ...atmosphere, tint: mixHex(atmosphere.tint, '#4fe3c4', 0.4), strength: atmosphere.strength + 0.25 }
      : { tint: '#4fe3c4', strength: 0.55, scale: 1.04, haze: 0.15 }
  }

  const rings = ringBands(v, seed)

  let spin = spinFromPeriod(v.rotationPeriodS, v.tidalLock)
  let tilt = v.axialTiltRad ?? (r(110) - 0.5) * 0.5
  if (!Number.isFinite(tilt)) tilt = 0
  let tiltAzimuth = r(120) * Math.PI * 2
  if (rings) {
    const t = viewFriendlyTilt(tilt, r(120), 6, 28)
    tilt = t.tilt
    tiltAzimuth = t.azimuth
    if (t.flipped) spin = -spin // the spin axis now points the other way
  }

  return { family, kind, surface, clouds, atmosphere, rings, material, spin, tilt, tiltAzimuth }
}

/**
 * Tilt for a disc (planet rings, star belts, dust and accretion discs) on the map: the real
 * angle between the disc's axis and the orbit plane's normal is folded into 0..90° and squeezed
 * into minDeg..maxDeg, and the axis leans toward +Z, where the map's default camera sits (30–45°
 * above the plane). Seen from there a disc opens by roughly the camera elevation plus a bit, so
 * it never collapses into a line (it still can when the user orbits to the far side).
 * Use with an axis (cos azimuth, 0, sin azimuth) rotated by `tilt`.
 */
export function viewFriendlyTilt(
  tiltRad: number | null,
  r: number,
  minDeg: number,
  maxDeg: number,
): { tilt: number; azimuth: number; flipped: boolean } {
  let t = Math.abs(tiltRad ?? 0) % Math.PI
  if (!Number.isFinite(t)) t = 0
  const flipped = t > Math.PI / 2
  if (flipped) t = Math.PI - t
  const tilt = (minDeg + (t / (Math.PI / 2)) * (maxDeg - minDeg)) * RAD
  // azimuth 0 tilts the axis toward +Z; ±65° keeps the lean mostly toward the camera.
  const azimuth = (r - 0.5) * 2 * 65 * RAD
  return { tilt, azimuth, flipped }
}

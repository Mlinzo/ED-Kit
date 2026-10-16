// Body classification and colour palettes. Pure data: no three.js here, because colors.ts
// (used by DOM labels) imports it and must stay out of the 3D chunk.

import type { BodyVisual } from '../../api/types'

// ---------------------------------------------------------------------------------------------
// Colour helpers (sRGB hex)

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export function scaleHex(a: string, k: number): string {
  const [r, g, b] = hexToRgb(a)
  return rgbToHex([r * k, g * k, b * k])
}

// ---------------------------------------------------------------------------------------------
// Deterministic pseudo-random numbers from a seed

export function hash01(seed: number, salt = 0): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt + 0x632be5ab, 0x85ebca6b)) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39) >>> 0
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Stable numeric hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------------------------
// Planets

export type PlanetFamily =
  | 'metal_rich'
  | 'hmc'
  | 'rocky'
  | 'icy'
  | 'rocky_ice'
  | 'elw'
  | 'ww'
  | 'aw'
  | 'water_giant'
  | 'water_giant_life'
  | 'gg_water_life'
  | 'gg_ammonia_life'
  | 'sudarsky1'
  | 'sudarsky2'
  | 'sudarsky3'
  | 'sudarsky4'
  | 'sudarsky5'
  | 'helium_rich'
  | 'helium'
  | 'unknown'

export function planetFamily(planetClass: string | null | undefined): PlanetFamily {
  const c = (planetClass ?? '').toLowerCase()
  if (!c) return 'unknown'
  if (c.startsWith('metal rich')) return 'metal_rich'
  if (c.startsWith('high metal')) return 'hmc'
  if (c.startsWith('rocky ice')) return 'rocky_ice'
  if (c.startsWith('rocky')) return 'rocky'
  if (c.startsWith('icy')) return 'icy'
  if (c.startsWith('earth')) return 'elw'
  if (c.startsWith('water world')) return 'ww'
  if (c.startsWith('ammonia world')) return 'aw'
  if (c.startsWith('water giant with life')) return 'water_giant_life'
  if (c.startsWith('water giant')) return 'water_giant'
  if (c.includes('water based life')) return 'gg_water_life'
  if (c.includes('ammonia based life')) return 'gg_ammonia_life'
  if (c.includes('helium rich')) return 'helium_rich'
  if (c.includes('helium')) return 'helium'
  const m = /sudarsky class (i{1,3}|iv|v)\b/.exec(c)
  if (m) {
    const roman: Record<string, PlanetFamily> = {
      i: 'sudarsky1',
      ii: 'sudarsky2',
      iii: 'sudarsky3',
      iv: 'sudarsky4',
      v: 'sudarsky5',
    }
    return roman[m[1]] ?? 'sudarsky1'
  }
  if (c.includes('gas giant')) return 'sudarsky1'
  return 'unknown'
}

export type SurfaceKind = 'rocky' | 'gas' | 'terra'

export function surfaceKind(f: PlanetFamily): SurfaceKind {
  switch (f) {
    case 'elw':
    case 'ww':
    case 'aw':
      return 'terra'
    case 'metal_rich':
    case 'hmc':
    case 'rocky':
    case 'icy':
    case 'rocky_ice':
    case 'unknown':
      return 'rocky'
    default:
      return 'gas'
  }
}

/** Representative surface colour per family (labels, dots, fallbacks). */
export const PLANET_SWATCH: Record<PlanetFamily, string> = {
  metal_rich: '#8a7f76',
  hmc: '#9a8270',
  rocky: '#a08f7d',
  icy: '#d6e4f0',
  rocky_ice: '#c9c2b6',
  elw: '#3f8fd0',
  ww: '#2f6fd6',
  aw: '#c7a46a',
  water_giant: '#55aecb',
  water_giant_life: '#3fa39a',
  gg_water_life: '#b9c7a0',
  gg_ammonia_life: '#d99a63',
  sudarsky1: '#d9b48a',
  sudarsky2: '#eadcae',
  sudarsky3: '#4a74cf',
  sudarsky4: '#7a6250',
  sudarsky5: '#f0a24e',
  helium_rich: '#b3bdd6',
  helium: '#dcc4ba',
  unknown: '#9ca3af',
}

/** Gas giant palettes: five stops from band-dark to band-light (sRGB). */
export const GAS_PALETTES: Partial<Record<PlanetFamily, string[]>> = {
  sudarsky1: ['#6e4a32', '#a8724a', '#d6a77a', '#ecd8b8', '#f6efe2'],
  // Class II: creamy water-cloud yellow-white; III: deep cloudless blue.
  sudarsky2: ['#a08a5c', '#c6ae7c', '#e0cc9c', '#efe3c2', '#faf4e2'],
  sudarsky3: ['#14286a', '#22449c', '#3866c4', '#6b92dc', '#b0c6ee'],
  sudarsky4: ['#231a16', '#3e2f27', '#5e4936', '#7f6448', '#a08566'],
  sudarsky5: ['#5a1d0c', '#9c3d14', '#d8702a', '#f3a74d', '#ffd98c'],
  // Helium-rich: cool blue-grey; helium: warm rosy ivory (both read pale, but apart).
  helium_rich: ['#5e6984', '#8490ad', '#aab5cf', '#d0d7e7', '#edf0f7'],
  helium: ['#9a7c78', '#bc9c94', '#d8bfb3', '#ebdcd1', '#f8efe8'],
  gg_water_life: ['#6f7d5f', '#8fa889', '#bccba5', '#e0dcc0', '#f2eedf'],
  gg_ammonia_life: ['#55304a', '#94505a', '#cd7d5c', '#eaa982', '#f6d8bc'],
  // Water giants: softer aqua, apart from the deep blue of class III.
  water_giant: ['#1b5674', '#2c80a2', '#52a8c8', '#8ccce0', '#d0ecf4'],
  water_giant_life: ['#13465e', '#1f6f82', '#33978f', '#69bd9a', '#bfe5cf'],
}

/** Atmosphere rim tint by journal AtmosphereType. */
export function atmosphereTint(type: string | null | undefined): string {
  const t = (type ?? '').toLowerCase()
  if (!t || t === 'none') return '#000000'
  if (t.includes('earthlike') || t === 'oxygen' || t === 'nitrogen') return '#64a8ff'
  if (t.includes('nitrogen')) return '#7d95ff'
  if (t.includes('ammonia')) return '#d9bf7c'
  if (t.includes('water')) return '#8fc8ff'
  if (t.includes('carbondioxide')) return '#e9bf8c'
  if (t.includes('sulphur')) return '#eed36a'
  if (t.includes('methane')) return '#78d8cf'
  if (t.includes('argon')) return '#b3a4ff'
  if (t.includes('neon')) return '#ff9c8a'
  if (t.includes('helium')) return '#ffe0c0'
  if (t.includes('silicate') || t.includes('metallic')) return '#ff9a52'
  return '#a4c4ff'
}

/** Scattering tint of one atmospheric gas (journal AtmosphereComposition names). */
function gasTint(gas: string): string | null {
  const g = gas.toLowerCase()
  if (g.includes('oxygen')) return '#64a8ff'
  if (g.includes('nitrogen')) return '#7d95ff'
  if (g.includes('carbondioxide')) return '#e9bf8c'
  if (g.includes('sulphur') || g.includes('sulfur')) return '#eed36a'
  if (g.includes('ammonia')) return '#d9bf7c'
  if (g.includes('methane')) return '#78d8cf'
  if (g.includes('water')) return '#8fc8ff'
  if (g.includes('argon')) return '#b3a4ff'
  if (g.includes('neon')) return '#ff9c8a'
  if (g.includes('helium')) return '#ffe0c0'
  if (g.includes('hydrogen')) return '#c9b8ff'
  if (g.includes('silicate') || g.includes('iron')) return '#ff9a52'
  return null
}

/**
 * Atmosphere tint from its composition (gas -> percent), weighted by share; falls back to the
 * atmosphere type when the composition is unknown ("thick argon rich" can be 97 % nitrogen).
 */
export function compositionTint(
  composition: Record<string, number> | null | undefined,
  type: string | null | undefined,
): string {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (const [gas, pct] of Object.entries(composition ?? {})) {
    const tint = gasTint(gas)
    if (!tint || !Number.isFinite(pct) || pct <= 0) continue
    const [cr, cg, cb] = hexToRgb(tint)
    r += cr * pct
    g += cg * pct
    b += cb * pct
    w += pct
  }
  return w > 0 ? rgbToHex([r / w, g / w, b / w]) : atmosphereTint(type)
}

/** Ring colour by eRingClass. */
export function ringTint(ringClass: string | null | undefined): string {
  const c = (ringClass ?? '').toLowerCase()
  if (c.includes('icy')) return '#dce7f2'
  if (c.includes('metalrich')) return '#8f6c55'
  if (c.includes('metalic') || c.includes('metallic')) return '#9a8c80'
  if (c.includes('rocky')) return '#b39b7f'
  return '#b8ab9a'
}

// ---------------------------------------------------------------------------------------------
// Stars

export type StarFamily =
  | 'main'
  | 'brown'
  | 'proto'
  | 'white_dwarf'
  | 'neutron'
  | 'black_hole'
  | 'wolf_rayet'
  | 'carbon'
  | 'giant'
  | 'exotic'

export interface StarLook {
  family: StarFamily
  /** Hot centre of the disc / mid disc / darkened limb (sRGB). */
  core: string
  mid: string
  limb: string
  glow: string
  /** Body sphere radius relative to the slot radius (white dwarfs and neutron stars are "tiny"). */
  coreScale: number
  /** Brightness multiplier of the disc (HDR; > 1 burns toward white under tone mapping). */
  intensity: number
  /** Glow billboard half-size in body radii, and its strength. */
  glowSize: number
  glowStrength: number
  /** Surface texture: granulation frequency / contrast, spots, zonal bands (brown dwarfs). */
  granScale: number
  granAmp: number
  spots: number
  bands: number
  /** Corona rays and diffraction spikes strength. */
  rays: number
  spikes: number
  jets: boolean
  /** Protoplanetary dust disc colour, or null. */
  disk: string | null
  /** Wind-blown nebula shell colour (Wolf-Rayet), or null. */
  nebula: string | null
  /** Black hole flavour. */
  supermassive: boolean
}

interface MainSeq {
  base: string
  glow: string
  intensity: number
  glowSize: number
}

const MAIN: Record<string, MainSeq> = {
  O: { base: '#6a8cff', glow: '#4a6cff', intensity: 1.55, glowSize: 3.4 },
  B: { base: '#92b0ff', glow: '#7096ff', intensity: 1.5, glowSize: 3.2 },
  A: { base: '#e2eaff', glow: '#b8caff', intensity: 1.45, glowSize: 3.1 },
  F: { base: '#fff0cc', glow: '#ffe09a', intensity: 1.4, glowSize: 3.0 },
  G: { base: '#ffd77a', glow: '#ffbe48', intensity: 1.35, glowSize: 3.0 },
  K: { base: '#ffa850', glow: '#ff8a2e', intensity: 1.3, glowSize: 2.9 },
  M: { base: '#ff7040', glow: '#ff4e22', intensity: 1.2, glowSize: 2.8 },
}
const MAIN_ORDER = ['O', 'B', 'A', 'F', 'G', 'K', 'M']

function baseLook(family: StarFamily, base: string, glow: string): StarLook {
  return {
    family,
    core: mixHex(base, '#ffffff', 0.32),
    mid: base,
    limb: mixHex(scaleHex(base, 0.75), glow, 0.6),
    glow,
    coreScale: 1,
    intensity: 1.35,
    glowSize: 3,
    glowStrength: 1,
    granScale: 7,
    granAmp: 0.35,
    spots: 0,
    bands: 0,
    rays: 0.35,
    spikes: 0,
    jets: false,
    disk: null,
    nebula: null,
    supermassive: false,
  }
}

function isGiantLuminosity(lum: string | null | undefined): boolean {
  if (!lum) return false
  return /^(I|II|III)(?!V)/.test(lum) && !lum.startsWith('IV')
}

export function starLook(visual: BodyVisual): StarLook {
  const code = visual.starType ?? 'G'
  const sub = visual.starSubclass

  // Black holes
  if (code === 'H' || code === 'SupermassiveBlackHole') {
    const l = baseLook('black_hole', '#ffb766', '#ff8a3a')
    l.supermassive = code === 'SupermassiveBlackHole'
    return l
  }
  // Neutron star
  if (code === 'N') {
    const l = baseLook('neutron', '#d7e6ff', '#8fb6ff')
    l.core = '#ffffff'
    l.coreScale = 0.42
    l.intensity = 2.2
    l.glowSize = 6.5
    l.glowStrength = 1.1
    l.granAmp = 0.05
    l.rays = 0.2
    l.spikes = 0.7
    l.jets = true
    return l
  }
  // White dwarfs (D, DA, DAB, DB, DO, DQ, DC, DX, ... with V/Z suffixes)
  if (code.startsWith('D')) {
    const l = baseLook('white_dwarf', '#e6efff', '#a9c8ff')
    l.core = '#ffffff'
    l.coreScale = 0.6
    l.intensity = 2.0
    l.glowSize = 5.0
    l.glowStrength = 1.05
    l.granAmp = 0.06
    l.rays = 0.25
    l.spikes = 0.45
    return l
  }
  // Wolf-Rayet (W, WN, WNC, WC, WO)
  if (code.startsWith('W')) {
    const l = baseLook('wolf_rayet', '#9ec0ff', '#6f9bff')
    l.intensity = 1.6
    l.glowSize = 3.6
    l.glowStrength = 1.25
    l.granScale = 5
    l.granAmp = 0.45
    l.rays = 0.6
    l.nebula = code === 'WC' || code === 'WO' ? '#ff7fb8' : '#b388ff'
    return l
  }
  // Carbon stars and S/MS types
  if (code.startsWith('C') || code === 'MS' || code === 'S') {
    const sType = code === 'MS' || code === 'S'
    const l = baseLook('carbon', sType ? '#ff7a44' : '#e83a1c', sType ? '#e04a1e' : '#a8160e')
    l.core = mixHex(l.mid, '#ffcf9a', sType ? 0.5 : 0.35)
    l.limb = sType ? '#8a2410' : '#4e0804'
    l.intensity = 1.15
    l.glowSize = 3.2
    l.granScale = 3.2
    l.granAmp = 0.6
    l.spots = sType ? 0.35 : 0.75
    l.rays = 0.25
    return l
  }
  // Brown dwarfs
  if (code === 'L' || code === 'T' || code === 'Y') {
    const colours: Record<string, [string, string]> = {
      L: ['#e0522f', '#a8231c'],
      T: ['#b83a74', '#7c1d5e'],
      Y: ['#7a3a5c', '#4b1b3f'],
    }
    const [base, glow] = colours[code]
    const l = baseLook('brown', base, glow)
    l.core = mixHex(base, '#ffc9a8', 0.35)
    l.limb = scaleHex(glow, 0.7)
    l.intensity = code === 'L' ? 1.1 : code === 'T' ? 0.95 : 0.8
    l.glowSize = 2.4
    l.glowStrength = code === 'Y' ? 0.45 : 0.6
    l.granScale = 4
    l.granAmp = 0.25
    l.bands = 1
    l.rays = 0
    return l
  }
  // Young stars with dust discs
  if (code === 'TTS' || code === 'AeBe') {
    const l =
      code === 'TTS' ? baseLook('proto', '#ffab62', '#ff7e36') : baseLook('proto', '#d6e2ff', '#9fb9ff')
    l.intensity = code === 'TTS' ? 1.25 : 1.45
    l.glowSize = 3.0
    l.granAmp = 0.4
    l.spots = code === 'TTS' ? 0.5 : 0
    l.disk = code === 'TTS' ? '#c98a5a' : '#c9d2e6'
    return l
  }
  // Giants and supergiants (journal codes like M_RedGiant, B_BlueWhiteSuperGiant)
  const giantCode = code.includes('Giant')
  const letter = giantCode ? code.charAt(0) : code
  const ms = MAIN[letter]
  if (giantCode || (ms && isGiantLuminosity(visual.luminosity))) {
    const m = ms ?? MAIN.K
    const l = baseLook('giant', m.base, m.glow)
    const supergiant = code.includes('Super') || /^(I|Ia|Ib|Iab|Ia0)$/.test(visual.luminosity ?? '')
    l.intensity = m.intensity * 0.95
    l.glowSize = m.glowSize + (supergiant ? 1.0 : 0.5)
    l.glowStrength = supergiant ? 1.3 : 1.15
    l.granScale = 2.6
    l.granAmp = 0.65
    l.spots = letter === 'M' || letter === 'K' ? 0.5 : 0.15
    l.rays = 0.5
    return l
  }
  if (ms) {
    // Interpolate toward the next cooler class by subclass (0 hottest .. 9 coolest).
    const i = MAIN_ORDER.indexOf(letter)
    const next = MAIN[MAIN_ORDER[Math.min(i + 1, MAIN_ORDER.length - 1)]]
    const t = sub != null ? Math.max(0, Math.min(9, sub)) / 10 : 0.4
    const base = mixHex(ms.base, next.base, t * 0.7)
    const glow = mixHex(ms.glow, next.glow, t * 0.7)
    const l = baseLook('main', base, glow)
    l.intensity = ms.intensity
    l.glowSize = ms.glowSize
    l.spots = letter === 'K' ? 0.25 : letter === 'M' ? 0.4 : 0
    l.granAmp = letter === 'O' || letter === 'B' ? 0.22 : 0.35
    return l
  }
  // Exotic / unknown
  const l = baseLook('exotic', '#c79bff', '#8f5cff')
  l.rays = 0.5
  return l
}

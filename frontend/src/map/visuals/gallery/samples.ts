// Sample bodies for the visual QA gallery (dev only).

import type { BodyVisual, RingView } from '../../../api/types'

export interface Sample {
  label: string
  kind: 'star' | 'planet'
  visual: BodyVisual
  seed: number
  dim?: boolean
  selected?: boolean
  hovered?: boolean
  /** Camera distance in body radii. */
  fit?: number
}

export interface Section {
  id: string
  title: string
  items: Sample[]
}

function v(p: Partial<BodyVisual>): BodyVisual {
  return {
    planetClass: null,
    starType: null,
    starSubclass: null,
    luminosity: null,
    atmosphereType: '',
    terraformState: '',
    volcanism: '',
    temperatureK: null,
    surfacePressureAtm: null,
    atmosphereComposition: {},
    massEm: null,
    radiusM: 6_000_000,
    stellarMass: null,
    axialTiltRad: 0.25,
    rotationPeriodS: 86_400,
    tidalLock: false,
    composition: {},
    rings: [],
    ...p,
  }
}

const ring = (ringClass: string, innerM: number, outerM: number): RingView => ({
  name: null,
  ringClass,
  innerM,
  outerM,
})

let seedCounter = 11
function planet(label: string, p: Partial<BodyVisual>, extra: Partial<Sample> = {}): Sample {
  return { label, kind: 'planet', visual: v(p), seed: seedCounter++ * 7, ...extra }
}
function star(label: string, starType: string, extra: Partial<BodyVisual> = {}, s: Partial<Sample> = {}): Sample {
  return { label, kind: 'star', visual: v({ starType, ...extra }), seed: seedCounter++ * 13, fit: 10, ...s }
}

const PLANETS: Sample[] = [
  planet('Metal rich body', {
    planetClass: 'Metal rich body',
    temperatureK: 1450,
    volcanism: 'major metallic magma volcanism',
    composition: { Metal: 0.66, Rock: 0.34 },
  }),
  planet('High metal content body', {
    planetClass: 'High metal content body',
    temperatureK: 380,
    composition: { Metal: 0.32, Rock: 0.68 },
  }),
  planet('Rocky body', { planetClass: 'Rocky body', temperatureK: 210, composition: { Rock: 0.86, Metal: 0.14 } }),
  planet('Icy body', { planetClass: 'Icy body', temperatureK: 55, composition: { Ice: 0.82, Rock: 0.16, Metal: 0.02 } }),
  planet('Rocky ice body', {
    planetClass: 'Rocky ice body',
    temperatureK: 120,
    composition: { Ice: 0.42, Rock: 0.5, Metal: 0.08 },
  }),
  planet('Earthlike body', { planetClass: 'Earthlike body', temperatureK: 288, atmosphereType: 'EarthLike' }),
  planet('Water world', { planetClass: 'Water world', temperatureK: 305, atmosphereType: 'Water' }),
  planet('Ammonia world', { planetClass: 'Ammonia world', temperatureK: 190, atmosphereType: 'Ammonia' }),
  planet('Water giant', { planetClass: 'Water giant', temperatureK: 170, radiusM: 25_000_000 }),
  planet('Water giant with life', { planetClass: 'Water giant with life', temperatureK: 180 }),
  planet('Gas giant with water based life', { planetClass: 'Gas giant with water based life', temperatureK: 260 }),
  planet('Gas giant with ammonia based life', { planetClass: 'Gas giant with ammonia based life', temperatureK: 140 }),
  planet('Sudarsky class I gas giant', { planetClass: 'Sudarsky class I gas giant', temperatureK: 120 }),
  planet('Sudarsky class II gas giant', { planetClass: 'Sudarsky class II gas giant', temperatureK: 230 }),
  planet('Sudarsky class III gas giant', { planetClass: 'Sudarsky class III gas giant', temperatureK: 600 }),
  planet('Sudarsky class IV gas giant', { planetClass: 'Sudarsky class IV gas giant', temperatureK: 1100 }),
  planet('Sudarsky class V gas giant', { planetClass: 'Sudarsky class V gas giant', temperatureK: 1700 }),
  planet('Helium rich gas giant', { planetClass: 'Helium rich gas giant', temperatureK: 150 }),
  planet('Helium gas giant', { planetClass: 'Helium gas giant', temperatureK: 140 }),
  planet('Unknown class (fallback)', { planetClass: null }),
]

const VARIANTS: Sample[] = [
  planet('HMC · volcanic 950 K', {
    planetClass: 'High metal content body',
    temperatureK: 950,
    volcanism: 'major silicate magma volcanism',
  }),
  planet('HMC · terraformable · CO2', {
    planetClass: 'High metal content body',
    temperatureK: 240,
    atmosphereType: 'CarbonDioxide',
    terraformState: 'Terraformable',
  }),
  planet('Rocky · thick CO2 720 K', {
    planetClass: 'Rocky body',
    temperatureK: 720,
    atmosphereType: 'CarbonDioxide',
  }),
  planet('Rocky · frozen 45 K', { planetClass: 'Rocky body', temperatureK: 45 }),
  planet('Rocky · terraformed', {
    planetClass: 'Rocky body',
    temperatureK: 285,
    atmosphereType: 'EarthLike',
    terraformState: 'Terraformed',
  }),
  planet('Icy · thin neon', { planetClass: 'Icy body', temperatureK: 30, atmosphereType: 'Neon' }),
  planet('Rocky · thin SO2', {
    planetClass: 'Rocky body',
    temperatureK: 330,
    atmosphereType: 'SulphurDioxide',
  }),
  planet('Icy · thin argon (bio)', { planetClass: 'Icy body', temperatureK: 53, atmosphereType: 'Argon' }),
  planet('Metal rich · cold', { planetClass: 'Metal rich body', temperatureK: 160 }),
  planet('Water world · cold', { planetClass: 'Water world', temperatureK: 240, atmosphereType: 'Water' }),
]

const R = 60_000_000
const RINGED: Sample[] = [
  planet(
    'Sudarsky I · icy rings',
    {
      planetClass: 'Sudarsky class I gas giant',
      temperatureK: 110,
      radiusM: R,
      axialTiltRad: 0.42,
      rings: [ring('eRingClass_Icy', R * 1.35, R * 2.3)],
    },
    { fit: 7 },
  ),
  planet(
    'Sudarsky II · icy + rocky',
    {
      planetClass: 'Sudarsky class II gas giant',
      temperatureK: 220,
      radiusM: R,
      axialTiltRad: 0.3,
      rings: [ring('eRingClass_Rocky', R * 1.3, R * 1.7), ring('eRingClass_Icy', R * 1.75, R * 2.6)],
    },
    { fit: 7 },
  ),
  planet(
    'Sudarsky III · rocky',
    {
      planetClass: 'Sudarsky class III gas giant',
      temperatureK: 500,
      radiusM: R,
      axialTiltRad: -0.5,
      rings: [ring('eRingClass_Rocky', R * 1.5, R * 2.4)],
    },
    { fit: 7 },
  ),
  planet(
    'Water giant · metallic',
    {
      planetClass: 'Water giant',
      temperatureK: 160,
      radiusM: R,
      axialTiltRad: 0.35,
      rings: [ring('eRingClass_Metalic', R * 1.4, R * 2.2)],
    },
    { fit: 7 },
  ),
  planet(
    'Helium rich · metal rich',
    {
      planetClass: 'Helium rich gas giant',
      temperatureK: 150,
      radiusM: R,
      axialTiltRad: 0.6,
      rings: [ring('eRingClass_MetalRich', R * 1.3, R * 2.0)],
    },
    { fit: 7 },
  ),
  planet(
    'HMC · icy ring',
    {
      planetClass: 'High metal content body',
      temperatureK: 140,
      radiusM: 3_000_000,
      axialTiltRad: 0.2,
      rings: [ring('eRingClass_Icy', 4_500_000, 7_800_000)],
    },
    { fit: 7 },
  ),
]

const STARS: Sample[] = [
  star('O', 'O', { starSubclass: 6 }),
  star('B', 'B', { starSubclass: 3 }),
  star('A', 'A', { starSubclass: 2 }),
  star('F', 'F', { starSubclass: 5 }),
  star('G', 'G', { starSubclass: 2 }),
  star('K', 'K', { starSubclass: 4 }),
  star('M', 'M', { starSubclass: 3 }),
  star('L (brown dwarf)', 'L', { starSubclass: 4 }),
  star('T (brown dwarf)', 'T', { starSubclass: 5 }),
  star('Y (brown dwarf)', 'Y', { starSubclass: 2 }),
  star('TTS (T Tauri)', 'TTS'),
  star('AeBe (Herbig)', 'AeBe'),
  star('WN (Wolf-Rayet)', 'WN'),
  star('WC (Wolf-Rayet)', 'WC'),
  star('C (carbon)', 'C'),
  star('CN (carbon)', 'CN'),
  star('MS', 'MS'),
  star('S', 'S'),
  star('DA (white dwarf)', 'DA'),
  star('N (neutron)', 'N'),
  star('H (black hole)', 'H', {}, { fit: 7 }),
  star('Supermassive BH', 'SupermassiveBlackHole', {}, { fit: 8 }),
  star('M_RedGiant', 'M_RedGiant'),
  star('K_OrangeGiant', 'K_OrangeGiant'),
  star('B_BlueWhiteSuperGiant', 'B_BlueWhiteSuperGiant'),
  star('A_BlueWhiteSuperGiant', 'A_BlueWhiteSuperGiant'),
  star('F_WhiteSuperGiant', 'F_WhiteSuperGiant'),
  star('M_RedSuperGiant', 'M_RedSuperGiant'),
  star('K III (luminosity)', 'K', { starSubclass: 1, luminosity: 'III' }),
  star('X (exotic)', 'X'),
  star('K · 2 belts', 'K', { starSubclass: 6, rings: [ring('eRingClass_Rocky', 1, 2), ring('eRingClass_Icy', 3, 4)] }),
]

const SELECTION: Sample[] = [
  planet('Selected', { planetClass: 'Earthlike body', temperatureK: 290, atmosphereType: 'EarthLike' }, { selected: true }),
  planet('Hovered', { planetClass: 'High metal content body', temperatureK: 300 }, { hovered: true }),
  planet('Dim + selected', { planetClass: 'Rocky body', temperatureK: 200 }, { dim: true, selected: true }),
  star('Selected star', 'G', { starSubclass: 4 }, { selected: true }),
  planet(
    'Selected ringed',
    {
      planetClass: 'Sudarsky class I gas giant',
      radiusM: R,
      axialTiltRad: 0.4,
      rings: [ring('eRingClass_Icy', R * 1.4, R * 2.3)],
    },
    { selected: true, fit: 7 },
  ),
]

// Surface pressure and composition tell thin from thick atmospheres (real Triviatii values).
const ATMOSPHERES: Sample[] = [
  planet('Icy · neon 0.001 atm', {
    planetClass: 'Icy body',
    temperatureK: 48,
    atmosphereType: 'Neon',
    surfacePressureAtm: 0.0013,
    atmosphereComposition: { Neon: 100 },
  }),
  planet('Icy · argon 0.019 atm', {
    planetClass: 'Icy body',
    temperatureK: 53,
    atmosphereType: 'Argon',
    surfacePressureAtm: 0.019,
    atmosphereComposition: { Argon: 100 },
  }),
  planet('Icy · helium 0.24 atm', {
    planetClass: 'Icy body',
    temperatureK: 23,
    atmosphereType: 'Helium',
    surfacePressureAtm: 0.24,
    atmosphereComposition: { Helium: 99.5, Hydrogen: 0.5 },
  }),
  planet('Icy · "argon rich" 5 atm (98 % N2)', {
    planetClass: 'Icy body',
    temperatureK: 160,
    atmosphereType: 'ArgonRich',
    surfacePressureAtm: 5.1,
    atmosphereComposition: { Nitrogen: 98, Argon: 1.8, Methane: 0.1 },
  }),
  planet('HMC · "argon rich" 25 atm', {
    planetClass: 'High metal content body',
    temperatureK: 196,
    atmosphereType: 'ArgonRich',
    surfacePressureAtm: 25.5,
    atmosphereComposition: { Nitrogen: 97.2, Argon: 2.8 },
  }),
  planet('Icy · 666 atm', {
    planetClass: 'Icy body',
    temperatureK: 169,
    atmosphereType: 'ArgonRich',
    surfacePressureAtm: 666,
    atmosphereComposition: { Nitrogen: 99.1, Argon: 0.9 },
  }),
  planet('Rocky · CO2 0.05 atm', {
    planetClass: 'Rocky body',
    temperatureK: 230,
    atmosphereType: 'CarbonDioxide',
    surfacePressureAtm: 0.05,
    atmosphereComposition: { CarbonDioxide: 99, SulphurDioxide: 1 },
  }),
  planet('Rocky · hot CO2 90 atm', {
    planetClass: 'Rocky body',
    temperatureK: 740,
    atmosphereType: 'CarbonDioxide',
    surfacePressureAtm: 92,
    atmosphereComposition: { CarbonDioxide: 96.5, Nitrogen: 3.5 },
  }),
]

const dimmed = (items: Sample[]) => items.map((s) => ({ ...s, dim: true, label: `${s.label} · dim` }))

export const SECTIONS: Section[] = [
  { id: 'planets', title: 'Planet classes', items: PLANETS },
  { id: 'planets-dim', title: 'Planet classes · dim', items: dimmed(PLANETS) },
  { id: 'variants', title: 'Variants (temperature, volcanism, atmosphere, terraforming)', items: VARIANTS },
  { id: 'atmospheres', title: 'Atmospheres by surface pressure', items: ATMOSPHERES },
  { id: 'rings', title: 'Rings', items: RINGED },
  { id: 'stars', title: 'Stars', items: STARS },
  { id: 'stars-dim', title: 'Stars · dim', items: dimmed(STARS) },
  { id: 'selection', title: 'Selection / hover', items: SELECTION },
]

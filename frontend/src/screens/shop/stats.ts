// How the Shop cards show module figures (EDSY attributes: unit and decimals as EDSY gives them)
// and which icon stands for a kind of module (EDSY module types).

import {
  Anchor,
  Armchair,
  Atom,
  BatteryCharging,
  BatteryPlus,
  Bomb,
  Box,
  Car,
  ChevronsUp,
  CloudFog,
  Crosshair,
  Drone,
  Factory,
  Fuel,
  Gauge,
  Magnet,
  Network,
  Package,
  Pickaxe,
  Plane,
  Puzzle,
  Radar,
  RadioTower,
  Rocket,
  ScanLine,
  ScanSearch,
  Shield,
  ShieldAlert,
  ShieldHalf,
  ShieldPlus,
  Snowflake,
  Sun,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { t } from '../../i18n'
import { formatNumber } from '../../lib/format'

type Unit = 't' | 'ly' | 's' | 'mw' | 'mj' | 'mjs' | 'km' | 'm' | 'pct' | 'perS' | 'tPerS' | ''

/** Unit and decimals of each figure a card may show. */
const FORMAT: Record<string, [Unit, number]> = {
  fsdoptmass: ['t', 1],
  maxfuel: ['t', 2],
  jumpbst: ['ly', 2],
  fuelcap: ['t', 0],
  emgcylife: ['s', 0],
  pwrcap: ['mw', 2],
  heateff: ['', 2],
  wepcap: ['mj', 1],
  wepchg: ['mjs', 2],
  engcap: ['mj', 1],
  engchg: ['mjs', 2],
  syscap: ['mj', 1],
  syschg: ['mjs', 2],
  maxrng: ['km', 1],
  engoptmass: ['t', 0],
  engoptmul: ['pct', 0],
  genoptmass: ['t', 0],
  genmaxmass: ['t', 0],
  genoptmul: ['pct', 0],
  shieldbst: ['pct', 1],
  kinres: ['pct', 1],
  thmres: ['pct', 1],
  expres: ['pct', 1],
  hullrnf: ['', 0],
  dmgprot: ['pct', 0],
  shieldrnfps: ['mjs', 1],
  scbdur: ['s', 0],
  spinup: ['s', 0],
  dps: ['', 1],
  damage: ['', 1],
  maximumrng: ['m', 0],
  rof: ['perS', 1],
  ammoclip: ['', 0],
  ammomax: ['', 0],
  distdraw: ['mj', 2],
  thmload: ['', 1],
  afmrepcap: ['', 0],
  maxlimpet: ['', 0],
  lpactrng: ['m', 0],
  cargocap: ['t', 0],
  scooprate: ['tPerS', 3],
  cabincap: ['', 0],
  bins: ['', 0],
  vslots: ['', 0],
  scanrng: ['m', 0],
  hsdur: ['s', 0],
}

function unitText(unit: Unit): string {
  return unit === '' ? '' : unit === 'pct' ? '%' : ` ${t.units[unit]}`
}

/** "1 050 t", "−20%", "7.1 /s". */
export function formatStat(key: string, value: number): string {
  const [unit, digits] = FORMAT[key] ?? ['', 1]
  // Whole numbers without a tail of zeros: "1 050 t", not "1 050.0 t".
  const text = formatNumber(Math.abs(value), Number.isInteger(value) ? 0 : digits)
  return `${value < 0 ? '−' : ''}${text}${unitText(unit)}`
}

/** The figures to list: the ones a card knows how to show, in the order the catalog gives. */
export function shownStats(stats: Record<string, number>): [string, number][] {
  return Object.entries(stats).filter(([key]) => key in FORMAT && key in t.shop.stat)
}

const ICONS: Record<string, LucideIcon> = {
  cfsd: Zap,
  cfsdo: Zap,
  cpp: Atom,
  ct: Gauge,
  cls: Wind,
  cpd: Network,
  cs: Radar,
  cft: Fuel,
  isg: Shield,
  usb: ShieldPlus,
  iscb: BatteryPlus,
  ihrp: ShieldHalf,
  imahrp: ShieldHalf,
  imrp: Box,
  isrp: ShieldPlus,
  ifs: Sun,
  iafmu: Wrench,
  icr: Package,
  ipc: Armchair,
  ipvh: Car,
  ifh: Plane,
  iss: ScanSearch,
  ifa: Anchor,
  ir: Factory,
  ifsdi: Magnet,
  ifsdb: ChevronsUp,
  iex: BatteryCharging,
  ucl: CloudFog,
  uec: RadioTower,
  uhsl: Snowflake,
  upd: ShieldAlert,
  ucs: ScanLine,
  ufsws: ScanLine,
  ukws: ScanLine,
  upwa: ScanLine,
  uex: ScanLine,
  hmr: Rocket,
  htp: Rocket,
  hexxm: Rocket,
  hextp: Rocket,
  hmtm: Rocket,
  hm: Bomb,
  hmtl: Pickaxe,
}

/** The icon of a kind of module: limpet controllers a drone, other weapons a crosshair. */
export function moduleIcon(type: string | null): LucideIcon {
  if (!type) return Puzzle
  if (ICONS[type]) return ICONS[type]
  if (type.endsWith('lc')) return Drone
  if (type.startsWith('h')) return Crosshair
  return Puzzle
}

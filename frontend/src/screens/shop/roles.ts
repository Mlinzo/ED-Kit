// What each ship is for, by journal symbol: the Elite Dangerous Wiki's "Type" (2026-10-21), split
// where it names two ("Combat Explorer"). The Asp Explorer, "Multirole" there, counts as an
// explorer as well: its name says so.

export type Role = 'combat' | 'multirole' | 'explorer' | 'freighter' | 'passenger' | 'miner'
export const ROLES: readonly Role[] = ['combat', 'multirole', 'explorer', 'freighter', 'passenger', 'miner']
export type RoleFilter = Role | 'all'
export const ROLE_FILTERS: readonly RoleFilter[] = ['all', ...ROLES]

export const SHIP_ROLES: Readonly<Record<string, readonly Role[]>> = {
  adder: ['multirole'],
  anaconda: ['multirole'],
  anacondamkii: ['multirole'],
  asp: ['multirole', 'explorer'],
  asp_scout: ['multirole'],
  belugaliner: ['passenger'],
  cobramkiii: ['multirole'],
  cobramkiv: ['multirole', 'combat'],
  cobramkv: ['multirole'],
  corsair: ['multirole'],
  cutter: ['multirole'],
  diamondback: ['combat', 'explorer'],
  diamondbackxl: ['combat', 'explorer'],
  dolphin: ['passenger'],
  eagle: ['combat'],
  empire_courier: ['multirole'],
  empire_eagle: ['combat'],
  empire_trader: ['multirole'],
  explorer_nx: ['explorer'],
  federation_corvette: ['combat'],
  federation_dropship: ['combat', 'freighter'],
  federation_dropship_mkii: ['combat'],
  federation_gunship: ['combat'],
  ferdelance: ['combat'],
  hauler: ['freighter'],
  independant_trader: ['combat', 'freighter'],
  krait_light: ['multirole'],
  krait_mkii: ['combat', 'multirole'],
  lakonminer: ['miner'],
  mamba: ['combat'],
  mandalay: ['explorer'],
  mediumtransport01: ['passenger'],
  orca: ['passenger'],
  panthermkii: ['freighter'],
  python: ['multirole'],
  python_nx: ['combat'],
  sidewinder: ['multirole'],
  smallcombat01_nx: ['combat'],
  type6: ['freighter'],
  type7: ['freighter'],
  type8: ['freighter'],
  type9: ['freighter'],
  type9_military: ['combat', 'freighter'],
  typex: ['combat'],
  typex_2: ['combat'],
  typex_3: ['combat'],
  viper: ['combat'],
  viper_mkiv: ['combat'],
  vulture: ['combat'],
}

/** Whether a ship passes the filter (a ship missing from the table passes only "all"). */
export const fitsRole = (symbol: string, filter: RoleFilter) => filter === 'all' || (SHIP_ROLES[symbol]?.includes(filter) ?? false)

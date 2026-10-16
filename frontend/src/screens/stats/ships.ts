// Journal ship / suit / vehicle symbols ("python_nx", "federation_gunship") to display names.

const SHIPS: Record<string, string> = {
  adder: 'Adder',
  anaconda: 'Anaconda',
  asp: 'Asp Explorer',
  asp_scout: 'Asp Scout',
  belugaliner: 'Beluga Liner',
  cobramkiii: 'Cobra Mk III',
  cobramkiv: 'Cobra Mk IV',
  cobramkv: 'Cobra Mk V',
  corsair: 'Corsair',
  cutter: 'Imperial Cutter',
  diamondback: 'Diamondback Scout',
  diamondbackxl: 'Diamondback Explorer',
  dolphin: 'Dolphin',
  eagle: 'Eagle',
  empire_courier: 'Imperial Courier',
  empire_eagle: 'Imperial Eagle',
  empire_trader: 'Imperial Clipper',
  explorer_nx: 'Caspian Explorer',
  federation_corvette: 'Federal Corvette',
  federation_dropship: 'Federal Dropship',
  federation_dropship_mkii: 'Federal Assault Ship',
  federation_gunship: 'Federal Gunship',
  ferdelance: 'Fer-de-Lance',
  hauler: 'Hauler',
  independant_trader: 'Keelback',
  krait_light: 'Krait Phantom',
  krait_mkii: 'Krait Mk II',
  lakonminer: 'Type-11 Prospector',
  mamba: 'Mamba',
  mandalay: 'Mandalay',
  orca: 'Orca',
  panthermkii: 'Panther Clipper Mk II',
  python: 'Python',
  python_nx: 'Python Mk II',
  sidewinder: 'Sidewinder',
  type6: 'Type-6 Transporter',
  type7: 'Type-7 Transporter',
  type8: 'Type-8 Transporter',
  type9: 'Type-9 Heavy',
  type9_military: 'Type-10 Defender',
  typex: 'Alliance Chieftain',
  typex_2: 'Alliance Crusader',
  typex_3: 'Alliance Challenger',
  viper: 'Viper Mk III',
  viper_mkiv: 'Viper Mk IV',
  vulture: 'Vulture',
  // Ship-launched fighters
  empire_fighter: 'GU-97',
  federation_fighter: 'F63 Condor',
  independent_fighter: 'Taipan',
  gdn_hybrid_fighter_v1: 'Trident',
  gdn_hybrid_fighter_v2: 'Javelin',
  gdn_hybrid_fighter_v3: 'Lance',
  // Surface vehicles
  testbuggy: 'Scarab',
  combat_multicrew_srv_01: 'Scorpion',
  // Thargoids
  scout: 'Thargoid Scout',
  scout_nq: 'Thargoid Scout',
  scout_q: 'Thargoid Scout',
  scout_hq: 'Thargoid Scout',
  thargonswarm: 'Thargon Swarm',
}

/** Suit families: player suits by their in-game names, NPC suits by role. */
const SUITS: Record<string, string> = {
  flight: 'Flight Suit',
  utility: 'Maverick Suit',
  exploration: 'Artemis Suit',
  tactical: 'Dominator Suit',
  assault: 'Assault Suit',
  lightassault: 'Light Assault Suit',
  close: 'Close Combat Suit',
  ranged: 'Ranged Suit',
}

const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|x)$/

function titleWord(word: string): string {
  const mk = /^mk(i{1,3}|iv|vi{0,3})$/.exec(word)
  if (mk) return `Mk ${mk[1].toUpperCase()}`
  if (ROMAN.test(word)) return word.toUpperCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** "$Federation_Gunship_Name;" / "Federation_Gunship" -> "federation_gunship". */
function normalize(symbol: string): string {
  return symbol
    .trim()
    .replace(/^\$/, '')
    .replace(/;$/, '')
    .replace(/_name$/i, '')
    .toLowerCase()
}

/** Display name for a journal ship/suit symbol; unknown symbols are title-cased. */
export function shipName(symbol: string | null | undefined): string | null {
  if (!symbol) return null
  const key = normalize(symbol)
  if (!key) return null
  const known = SHIPS[key]
  if (known) return known
  const suit = /^([a-z]+?)suit(?:_ai)?(?:_class\d+)?$/.exec(key)
  if (suit) return SUITS[suit[1]] ?? `${titleWord(suit[1])} Suit`
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(titleWord)
    .join(' ')
}

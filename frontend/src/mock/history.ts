// Demo history for ?mock=1: the route that led to the demo system, newest first.
// Mostly quick pass-through jumps with a few systems worth a stop, like a real trip.

import type { HistoryEntry, HistoryStar, HistoryView, SystemRef, SystemView } from '../api/types'

const SECTORS = ['Oochoss Brou', 'Oochost Flyoo', 'Phroi Bluae', 'Eord Blao']
const STARS: ReadonlyArray<[string, number, string, string]> = [
  ['M', 4, 'Va', 'red dwarf'],
  ['K', 2, 'Vab', 'yellow-orange star'],
  ['M', 1, 'Va', 'red dwarf'],
  ['F', 6, 'Vab', 'white star'],
  ['L', 3, 'V', 'brown dwarf'],
  ['G', 8, 'Vab', 'white-yellow star'],
  ['DA', 5, 'VII', 'white dwarf'],
  ['N', 0, 'VII', 'neutron star'],
  ['T', 7, 'V', 'brown dwarf'],
  ['A', 1, 'Va', 'blue-white star'],
]

/** Deterministic pseudo-random numbers, so the demo looks the same on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function star(i: number): HistoryStar {
  const [starType, starSubclass, luminosity, name] = STARS[i % STARS.length]
  return { starType, starSubclass, luminosity, subtype: `${starType}${starSubclass} ${luminosity} · ${name}` }
}

/** Stops worth a look along the route: [index in the list, what was found there]. */
const STOPS: Record<number, Partial<HistoryEntry>> = {
  3: { bodiesScanned: 14, bodyCount: 14, allBodiesFound: true, bodiesMapped: 2, bioSignals: 3, speciesAnalysed: 3, firstDiscoveries: 9, firstMapped: 2, firstFootfalls: 1, value: 41_820_400, unsoldValue: 41_820_400, notable: ['ww', 'terraformable'] },
  7: { bodiesScanned: 6, bodyCount: 9, bodiesMapped: 1, firstDiscoveries: 6, firstMapped: 1, value: 3_912_000, unsoldValue: 3_912_000, notable: ['elw'] },
  12: { bodiesScanned: 21, bodyCount: 21, allBodiesFound: true, bodiesMapped: 3, bioSignals: 5, speciesAnalysed: 4, firstDiscoveries: 21, firstMapped: 3, value: 28_440_100, unsoldValue: 28_440_100, notable: ['neutron', 'aw', 'terraformable'] },
  19: { bodiesScanned: 4, bodyCount: 11, bioSignals: 2, value: 52_300, notable: [] },
  26: { bodiesScanned: 9, bodyCount: 9, allBodiesFound: true, bodiesMapped: 2, bioSignals: 2, speciesAnalysed: 2, value: 12_208_900, unsoldValue: 0, notable: ['terraformable'] },
  31: { bodiesScanned: 1, bodyCount: 1, allBodiesFound: true, value: 0, unsoldValue: 0, lostValue: 1_220_400, notable: ['black_hole'] },
}

const COUNT = 38

/** The route, newest first: the demo system leads, then one jump every few minutes back in time. */
export function buildHistory(current: SystemView): HistoryView {
  const random = rng(61)
  const systems: HistoryEntry[] = []
  let at = Date.parse(current.lastVisitAt ?? '2026-10-16T19:40:00Z')
  for (let i = 0; i < COUNT; i++) {
    if (i > 0) {
      // Breaks between sessions: a night and a day off.
      at -= i === 15 ? 14 * 3_600_000 : i === 29 ? 30 * 3_600_000 : (60 + random() * 240) * 1_000
    }
    const iso = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z')
    if (i === 0) {
      systems.push({
        address: current.address ?? '0',
        name: current.name ?? '?',
        firstVisitAt: current.firstVisitAt ?? iso,
        lastVisitAt: iso,
        visits: 1,
        mainStar: { starType: 'F', starSubclass: 6, luminosity: 'Vab', subtype: 'F6 Vab · white star' },
        bodyCount: current.bodyCount,
        allBodiesFound: current.allBodiesFound,
        bodiesScanned: current.scannedCount,
        bodiesMapped: current.bodies.filter((b) => b.mappedByMe).length,
        bioSignals: current.bodies.reduce((n, b) => n + b.signals.bio, 0),
        speciesAnalysed: current.bodies.reduce((n, b) => n + b.bioDone, 0),
        firstDiscoveries: current.bodies.filter((b) => b.source === 'journal' && b.wasDiscovered === false).length,
        firstMapped: 1,
        firstFootfalls: 1,
        value: 64_812_300,
        unsoldValue: 64_812_300,
        lostValue: 0,
        notable: ['ww', 'terraformable'],
      })
      continue
    }
    const sector = SECTORS[Math.floor(i / 10) % SECTORS.length]
    const letters = String.fromCharCode(65 + Math.floor(random() * 26), 65 + Math.floor(random() * 26))
    const name = `${sector} ${letters}-${String.fromCharCode(65 + Math.floor(random() * 26))} ${random() < 0.5 ? 'd' : 'c'}${1 + Math.floor(random() * 30)}-${Math.floor(random() * 120)}`
    const starIndex = Math.floor(random() * STARS.length)
    systems.push({
      address: String(2_870_514_376_571 + i * 7_919),
      name,
      firstVisitAt: iso,
      lastVisitAt: iso,
      visits: i === 12 ? 2 : 1,
      mainStar: star(starIndex),
      bodyCount: random() < 0.6 ? 2 + Math.floor(random() * 20) : null,
      allBodiesFound: false,
      bodiesScanned: 1,
      bodiesMapped: 0,
      bioSignals: 0,
      speciesAnalysed: 0,
      firstDiscoveries: 0,
      firstMapped: 0,
      firstFootfalls: 0,
      value: 1_200 + Math.round(random() * 2_000),
      unsoldValue: i < 26 ? 1_200 : 0,
      lostValue: 0,
      notable: STARS[starIndex][0] === 'N' ? ['neutron'] : STARS[starIndex][0] === 'DA' ? ['white_dwarf'] : [],
      ...STOPS[i],
    })
  }
  return { currentAddress: current.address, systems }
}

function ref(entry: HistoryEntry | undefined): SystemRef | null {
  return entry ? { address: entry.address, name: entry.name } : null
}

/** The demo system's place in the history (it is the latest stop). */
export function withHistory(system: SystemView, history: HistoryView): SystemView {
  return { ...system, prevSystem: ref(history.systems[1]) }
}

/**
 * A past system for ?address=: the demo system's bodies under another name — enough to try
 * the history mode. Returns null for an address that is not in the history.
 */
export function buildPastSystem(current: SystemView, history: HistoryView, address: string): SystemView | null {
  const i = history.systems.findIndex((s) => s.address === address)
  if (i < 0) return null
  const entry = history.systems[i]
  if (i === 0) return current
  const oldName = current.name ?? ''
  const rename = (name: string) => (name.startsWith(oldName) ? entry.name + name.slice(oldName.length) : name)
  return {
    ...current,
    address: entry.address,
    name: entry.name,
    isCurrent: false,
    currentBodyId: null,
    visits: entry.visits,
    firstVisitAt: entry.firstVisitAt,
    lastVisitAt: entry.lastVisitAt,
    prevSystem: ref(history.systems[i + 1]),
    nextSystem: ref(history.systems[i - 1]),
    bodies: current.bodies.map((b) => ({ ...b, name: rename(b.name) })),
  }
}

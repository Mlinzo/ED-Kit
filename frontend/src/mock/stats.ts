// Demo statistics for ?mock=1: a seasoned explorer, ~200 days since the first journal.
// The timeline is simulated (sessions, long expeditions without selling, a death),
// and every total is derived from it so the numbers on the screen agree with each other.
import type { DayStats, DeathView, FirstEntry, FirstState, GenusProgress, StatsView } from '../api/types'

const DAY_MS = 86_400_000
const FIRST_DAY = Date.UTC(2026, 2, 30) // 2026-03-30
const LAST_DAY = Date.UTC(2026, 9, 16) // 2026-10-16

/** Deterministic PRNG (mulberry32) so the demo looks the same on every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

interface Sim {
  timeline: DayStats[]
  earningsCarto: number
  earningsBio: number
  biggestSale: { kind: 'carto' | 'bio'; value: number; date: string }
  valueLost: number
  deaths: number
}

function simulate(): Sim {
  const rand = rng(20_261_016)
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
  const timeline: DayStats[] = []
  let unsoldCarto = 0
  let unsoldBio = 0
  let earningsCarto = 0
  let earningsBio = 0
  let valueLost = 0
  let deaths = 0
  let biggestSale: Sim['biggestSale'] = { kind: 'carto', value: 0, date: '' }
  // Expedition: a long trip out with no stations (no sales), sold in one go on return.
  const expedition = { from: Date.UTC(2026, 5, 10), to: Date.UTC(2026, 6, 4) }
  const deathsOn = ['2026-06-27', '2026-09-03']
  let streak = 0

  for (let t = FIRST_DAY; t <= LAST_DAY; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10)
    const inExpedition = t >= expedition.from && t <= expedition.to
    // Sessions come in streaks: playing yesterday makes playing today likelier.
    const pPlay = inExpedition ? 0.8 : streak > 0 ? 0.68 : 0.38
    const plays = rand() < pPlay || t === LAST_DAY
    if (!plays) {
      streak = 0
      continue
    }
    streak++

    const bioDay = rand() < (inExpedition ? 0.62 : 0.45)
    const jumps = Math.round(between(inExpedition ? 28 : 8, inExpedition ? 78 : 52))
    const distanceLy = Math.round(jumps * between(inExpedition ? 44 : 18, inExpedition ? 62 : 36) * 100) / 100
    const bodiesScanned = Math.round(jumps * between(3.2, 9.5) * (bioDay ? 0.7 : 1))
    const speciesAnalysed = bioDay ? Math.round(between(2, inExpedition ? 14 : 10)) : 0

    unsoldCarto += bodiesScanned * between(18_000, 46_000)
    unsoldBio += speciesAnalysed * between(2_500_000, 9_000_000) * (inExpedition ? 1.6 : 1)

    // A death in the black, mid-expedition: unsold data lost.
    if (deathsOn.length > deaths && date >= deathsOn[deaths]) {
      deaths++
      const lost = Math.round(unsoldCarto * 0.4 + unsoldBio * 0.1)
      valueLost += lost
      unsoldCarto *= 0.6
      unsoldBio *= 0.9
    }

    let earnings = 0
    let dayCarto = 0
    let dayBio = 0
    const sells = !inExpedition && (rand() < 0.3 || t === LAST_DAY)
    if (sells && unsoldCarto + unsoldBio > 0) {
      const carto = Math.round(unsoldCarto)
      const bio = Math.round(unsoldBio)
      earningsCarto += carto
      earningsBio += bio
      earnings = carto + bio
      dayCarto = carto
      dayBio = bio
      if (bio > biggestSale.value) biggestSale = { kind: 'bio', value: bio, date }
      if (carto > biggestSale.value) biggestSale = { kind: 'carto', value: carto, date }
      unsoldCarto = 0
      unsoldBio = 0
    }

    timeline.push({
      date,
      jumps,
      distanceLy,
      bodiesScanned,
      speciesAnalysed,
      earnings,
      earningsCarto: dayCarto,
      earningsBio: dayBio,
    })
  }
  return { timeline, earningsCarto, earningsBio, biggestSale, valueLost, deaths }
}

// Catalogue sizes per genus (sum = 118) and what the demo commander has found.
const GENERA: [genus: string, found: number, total: number][] = [
  ['Aleoida', 5, 5],
  ['Amphora Plant', 0, 1],
  ['Anemone', 3, 8],
  ['Bacterium', 13, 13],
  ['Bark Mound', 1, 1],
  ['Brain Tree', 2, 8],
  ['Cactoida', 4, 5],
  ['Clypeus', 2, 3],
  ['Concha', 4, 4],
  ['Crystalline Shards', 0, 1],
  ['Electricae', 2, 2],
  ['Fonticulua', 6, 6],
  ['Frutexa', 6, 7],
  ['Fumerola', 2, 4],
  ['Fungoida', 4, 4],
  ['Osseus', 5, 6],
  ['Radicoida', 0, 1],
  ['Recepta', 3, 3],
  ['Sinuous Tubers', 1, 8],
  ['Stratum', 7, 8],
  ['Tubus', 4, 5],
  ['Tussock', 12, 15],
]

// First discoveries / maps / footfalls: a few hand-written bodies plus ~45 generated systems,
// so the list has long groups, every mark state and enough rows for "show more".
const SECTORS = ['Phroi Bluae', 'Eord Pruae', 'Byaa Thoi', 'Hypuae Euq', 'Oochorrs', 'Blae Drye', 'Prua Phoe', 'Dryio Flyuae', 'Stuemeae', 'Gria Hypai', 'Wregoe', 'Flyai Aec', 'Schee Flyi', 'Clooku']
const PLANETS: [subtype: string, landable: boolean, mappable: number][] = [
  ['High metal content body', true, 0.35],
  ['Rocky body', true, 0.04],
  ['Icy body', true, 0.03],
  ['Rocky ice body', true, 0.04],
  ['Metal rich body', true, 0.1],
  ['Class I gas giant', false, 0.05],
  ['Class II gas giant', false, 0.2],
  ['Gas giant with water based life', false, 0.3],
  ['Water world', false, 0.9],
  ['Ammonia world', false, 0.9],
  ['Earthlike body', false, 1],
]
const STARS = ['M (Red dwarf) Star', 'K (Yellow-Orange) Star', 'L (Brown dwarf) Star', 'T (Brown dwarf) Star', 'F (White) Star']
const LETTERS = 'abcdefg'

function mockFirsts(): FirstEntry[] {
  const rand = rng(7_311)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const lost = (t: number) => t >= Date.UTC(2026, 7, 29) && t <= Date.UTC(2026, 8, 3, 21)
  const pending = (t: number) => t >= Date.UTC(2026, 9, 14)
  const out: FirstEntry[] = [
    { system: 'Eol Prou RS-T d3-94', body: 'Eol Prou RS-T d3-94 2', shortName: '2', subtype: 'Water world', at: '2026-07-04T19:41:55Z', discovered: 'sold', mapped: 'sold', footfallAt: null },
    { system: 'Eol Prou RS-T d3-94', body: 'Eol Prou RS-T d3-94 5 a', shortName: '5 a', subtype: 'Rocky body', at: '2026-07-04T22:58:12Z', discovered: 'sold', mapped: 'sold', footfallAt: '2026-07-04T23:05:40Z' },
    { system: 'Swoiwns XK-B d13-8', body: 'Swoiwns XK-B d13-8 A 3', shortName: 'A 3', subtype: 'Earthlike body', at: '2026-07-02T21:14:03Z', discovered: 'sold', mapped: 'sold', footfallAt: null },
    { system: 'Oochoss Brou KD-K d8-61', body: 'Oochoss Brou KD-K d8-61 B 3', shortName: 'B 3', subtype: 'Icy body', at: '2026-10-16T19:40:00Z', discovered: 'pending', mapped: null, footfallAt: '2026-10-16T20:02:11Z' },
    { system: 'Eorl Auwsy QF-O d6-14', body: 'Eorl Auwsy QF-O d6-14 B 1', shortName: 'B 1', subtype: 'Ammonia world', at: '2026-09-03T20:31:07Z', discovered: 'lost', mapped: 'lost', footfallAt: null },
  ]
  let t = Date.UTC(2026, 9, 16, 18, 10)
  for (let i = 0; i < 46; i++) {
    t -= Math.round((0.4 + rand() * 6) * DAY_MS)
    const system = `${pick(SECTORS)} ${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}-${String.fromCharCode(65 + Math.floor(rand() * 26))} ${pick(['d', 'c', 'e'])}${1 + Math.floor(rand() * 12)}-${Math.floor(rand() * 400)}`
    // One big system with a long list of bodies; the rest have one to six.
    const count = i === 3 ? 14 : 1 + Math.floor(rand() * rand() * 6)
    const state: FirstState = lost(t) ? 'lost' : pending(t) ? 'pending' : 'sold'
    let at = t
    const used = new Set<string>()
    for (let b = 0; b < count; b++) {
      at += Math.round((2 + rand() * 9) * 60_000)
      const star = rand() < 0.14
      let shortName = star ? pick(['A', 'B', 'C']) : `${pick(['', '', 'A ', 'B '])}${1 + Math.floor(rand() * 9)}${rand() < 0.45 ? ` ${pick([...LETTERS])}` : ''}`
      if (used.has(shortName)) shortName = `${shortName} ${LETTERS[b % LETTERS.length]}`
      if (used.has(shortName)) continue
      used.add(shortName)
      const [subtype, landable, mappable] = star ? [pick(STARS), false, 0] : pick(PLANETS)
      // Some bodies were discovered by someone else but nobody had walked on them yet.
      const footOnly = landable && rand() < 0.08
      const footfall = landable && (footOnly || rand() < 0.14)
      out.push({
        system,
        body: `${system} ${shortName}`,
        shortName,
        subtype,
        at: iso(at),
        discovered: footOnly ? null : state,
        mapped: !footOnly && rand() < mappable ? state : null,
        footfallAt: footfall ? iso(at + Math.round((12 + rand() * 50) * 60_000)) : null,
      })
    }
  }
  const time = (e: FirstEntry) => Math.max(Date.parse(e.at ?? ''), e.footfallAt ? Date.parse(e.footfallAt) : 0)
  return out.sort((a, b) => time(b) - time(a))
}

const DEATHS: DeathView[] = [
  {
    at: '2026-09-03T21:14:09Z',
    system: 'Eorl Auwsy QF-O d6-14',
    body: null,
    context: 'ship',
    killers: [{ name: 'Cmdr Kiranos', ship: 'python_nx', rank: 'Deadly' }],
    lostBioCount: 4,
    lostBioValue: 28_400_000,
    lostCartoBodies: 82,
    lostCartoValue: 8_304_028,
    rebuyOption: 'rebuy',
    rebuyCost: 1_620_591,
  },
  {
    at: '2026-06-27T18:05:56Z',
    system: 'Swoiwns XK-B d13-8',
    body: 'Swoiwns XK-B d13-8 A 6',
    context: 'on_foot',
    killers: [],
    lostBioCount: 7,
    lostBioValue: 112_600_000,
    lostCartoBodies: 0,
    lostCartoValue: 0,
    rebuyOption: 'recover',
    rebuyCost: 0,
  },
  {
    at: '2025-12-30T23:41:18Z',
    system: 'HIP 21991',
    body: 'HIP 21991 3 b',
    context: 'srv',
    killers: [
      { name: 'Ralla Voss', ship: 'federation_gunship', rank: 'Master' },
      { name: 'Teodor Hale', ship: 'viper_mkiv', rank: 'Dangerous' },
    ],
    lostBioCount: 1,
    lostBioValue: 1_470_000,
    lostCartoBodies: 12,
    lostCartoValue: 640_220,
    rebuyOption: 'rebuy',
    rebuyCost: 386_400,
  },
]

export function buildStats(): StatsView {
  const sim = simulate()
  const tl = sim.timeline
  const sum = (f: (d: DayStats) => number) => tl.reduce((a, d) => a + f(d), 0)
  const jumps = sum((d) => d.jumps)
  const distanceLy = Math.round(sum((d) => d.distanceLy) * 100) / 100
  const bodiesScanned = sum((d) => d.bodiesScanned)
  const speciesAnalysed = sum((d) => d.speciesAnalysed)
  const starsScanned = Math.round(bodiesScanned * 0.214)
  const bodiesMapped = Math.round(bodiesScanned * 0.041)
  const systemsVisited = Math.round(jumps * 0.93)

  const genusProgress: GenusProgress[] = GENERA.map(([genus, found, total]) => ({ genus, found, total })).sort(
    (a, b) => b.found - a.found || a.genus.localeCompare(b.genus),
  )
  const uniqueSpecies = genusProgress.reduce((a, g) => a + g.found, 0)

  return {
    deathHistory: DEATHS,
    firstDiscoveriesSold: 5_102,
    firstDiscoveriesPending: 37,
    firstDiscoveriesLost: 12,
    firstMappedSold: 611,
    firstMappedPending: 37,
    firstMappedLost: 12,
    firstFootfallsTotal: 214,
    firsts: mockFirsts(),
    commander: 'Arcturus Vale',
    since: `${tl[0]?.date ?? '2026-03-30'}T18:42:10Z`,
    daysActive: tl.length,
    jumps,
    distanceLy,
    systemsVisited,
    longestJump: { name: 'Eorl Auwsy QF-O d6-14', detail: null, value: 71.42, at: '2026-06-21T22:08:51Z' },
    farthestFromSol: { name: 'Eol Prou RS-T d3-94', detail: null, value: 22_087.6, at: '2026-07-04T19:30:12Z' },
    systemsHonked: Math.round(systemsVisited * 0.88),
    systemsFullyScanned: Math.round(systemsVisited * 0.61),
    bodiesScanned,
    starsScanned,
    planetsScanned: bodiesScanned - starsScanned,
    firstDiscoveries: Math.round(bodiesScanned * 0.31),
    bodiesMapped,
    firstMapped: Math.round(bodiesMapped * 0.79),
    efficientMaps: Math.round(bodiesMapped * 0.88),
    notable: [
      { key: 'ringed', count: 1_842 },
      { key: 'landable_atmo', count: 964 },
      { key: 'terraformable', count: 412 },
      { key: 'ww', count: 87 },
      { key: 'gg_water_life', count: 64 },
      { key: 'white_dwarf', count: 58 },
      { key: 'neutron', count: 41 },
      { key: 'aw', count: 31 },
      { key: 'giant', count: 26 },
      { key: 'elw', count: 23 },
      { key: 'gg_ammonia_life', count: 18 },
      { key: 'blue_star', count: 11 },
      { key: 'carbon', count: 9 },
      { key: 'black_hole', count: 2 },
    ],
    mostValuableBodies: [
      { name: 'Swoiwns XK-B d13-8 A 3', detail: 'Earthlike body', value: 7_942_310, at: '2026-07-02T21:14:03Z' },
      { name: 'Eol Prou RS-T d3-94 2', detail: 'Water world', value: 6_118_402, at: '2026-07-04T19:41:55Z' },
      { name: 'Prue Hypai GR-W e1-3 1', detail: 'Earthlike body', value: 5_406_877, at: '2026-06-14T17:02:40Z' },
      { name: 'Boewnst FG-Y d12 4', detail: 'Water world', value: 3_877_120, at: '2026-08-22T20:33:18Z' },
      { name: 'Eorl Auwsy QF-O d6-14 B 1', detail: 'Ammonia world', value: 3_212_950, at: '2026-06-21T22:31:07Z' },
    ],
    speciesAnalysed,
    uniqueSpecies,
    speciesTotal: 118,
    generaFound: genusProgress.filter((g) => g.found > 0).length,
    generaTotal: genusProgress.length,
    firstFootfalls: 214,
    codexNewEntries: 168,
    genusProgress,
    mostValuableSpecies: [
      { name: 'Fonticulua Fluctus', detail: 'Eol Prou RS-T d3-94 5 a', value: 100_000_000, at: '2026-07-04T23:12:44Z' },
      { name: 'Stratum Tectonicas', detail: 'Swoiwns XK-B d13-8 A 6', value: 95_054_000, at: '2026-07-02T23:50:10Z' },
      { name: 'Concha Biconcavis', detail: 'Prue Hypai GR-W e1-3 4 c', value: 95_054_000, at: '2026-06-14T19:20:31Z' },
      { name: 'Clypeus Speculumi', detail: 'Eorl Auwsy QF-O d6-14 B 3', value: 81_014_000, at: '2026-06-21T23:55:02Z' },
      { name: 'Recepta Deltahedronix', detail: 'Boewnst FG-Y d12 7 b', value: 16_202_800, at: '2026-08-22T22:08:47Z' },
    ],
    earningsCarto: sim.earningsCarto,
    earningsBio: sim.earningsBio,
    biggestSale: { name: sim.biggestSale.kind, detail: null, value: sim.biggestSale.value, at: `${sim.biggestSale.date}T20:05:00Z` },
    deaths: DEATHS.length,
    valueLost: DEATHS.reduce((a, d) => a + d.lostBioValue + d.lostCartoValue, 0),
    timeline: tl,
  }
}

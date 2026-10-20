// Demo past sessions for ?mock=1: evenings of a trip, the newest still going.
// Times are relative to the page load, so the live session's clock looks right.

import type { SessionCodexEntry, SessionEntry, SessionsView } from '../api/types'

const H = 3_600_000

/** [days ago, start hour, hours played, jumps, bodies, mapped, species, codex, carto, bio, lost, deaths] */
type Spec = [number, number, number, number, number, number, number, number, number, number, number, number]

const SPECS: readonly Spec[] = [
  [0, -2.2, 0, 23, 47, 3, 4, 3, 18_452_310, 14_712_000, 0, 0],
  [1, 19.5, 3.4, 41, 112, 6, 5, 4, 24_100_400, 31_900_000, 0, 0],
  [1, 9.2, 0.6, 6, 14, 0, 0, 0, 640_200, 0, 0, 0],
  [2, 20.1, 4.8, 58, 160, 9, 8, 6, 38_420_000, 46_310_000, 0, 0],
  [3, 18.0, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 21.0, 2.1, 12, 30, 2, 6, 2, 6_200_000, 52_800_000, 0, 0],
  [5, 19.4, 5.6, 77, 201, 11, 3, 5, 51_300_000, 12_400_000, 0, 1],
  [6, 20.6, 1.4, 20, 41, 1, 0, 1, 3_100_000, 0, 9_840_000, 0],
  [8, 18.8, 3.0, 35, 88, 4, 7, 4, 19_800_000, 38_600_000, 0, 0],
  [9, 10.0, 6.2, 95, 240, 7, 2, 3, 27_500_000, 8_100_000, 0, 0],
  [11, 20.2, 2.6, 30, 64, 3, 4, 2, 11_900_000, 21_300_000, 0, 0],
  [12, 19.0, 0.8, 9, 18, 1, 0, 1, 2_400_000, 0, 0, 0],
  [14, 17.5, 4.1, 48, 133, 8, 6, 5, 33_700_000, 29_200_000, 0, 0],
]

const CODEX: readonly SessionCodexEntry[] = [
  { name: 'Stratum Tectonicas - Emerald', category: 'bio' },
  { name: 'Bacterium Aurasus - Teal', category: 'bio' },
  { name: 'Ammonia world', category: 'stellar' },
  { name: 'Fonticulua Campestris - Grey', category: 'bio' },
  { name: 'Tussock Pennata - Sienna', category: 'bio' },
  { name: 'Wolf-Rayet star', category: 'stellar' },
  { name: 'Osseus Spiralis - Lime', category: 'bio' },
]

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function buildSessions(now = Date.now()): SessionsView {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const sessions = SPECS.map((spec, i): SessionEntry => {
    const [daysAgo, hour, played, jumps, bodies, mapped, species, codex, carto, bio, lost, deaths] = spec
    const live = i === 0
    // The live session started `-hour` hours ago; the others at a clock hour of their day.
    const start = live ? now + hour * H : midnight.getTime() - daysAgo * 24 * H + hour * H
    const end = live ? now - 4 * 60_000 : start + played * H
    return {
      startedAt: iso(start),
      endedAt: iso(end),
      open: live,
      durationS: Math.round((end - start) / 1_000),
      jumps,
      distanceLy: Math.round(jumps * 17.9 * 10) / 10,
      systems: jumps,
      bodiesScanned: bodies,
      bodiesMapped: mapped,
      speciesAnalysed: species,
      firstDiscoveries: Math.round(bodies * 0.6),
      firstMapped: Math.max(0, mapped - 1),
      firstFootfalls: species > 3 ? 1 : 0,
      cartoValue: carto,
      bioValue: bio,
      value: carto + bio,
      lostValue: lost,
      deaths,
      codex: Array.from({ length: codex }, (_, k) => CODEX[(i * 3 + k) % CODEX.length]),
    }
  })
  return { sessions }
}

// Demo answer of the Shop's engineering goals (?mock=1): one goal, Increased Range on the frame
// shift drive up to grade 5, against a small stock. Goals cannot be changed in the demo.

import type { EngineeringView } from '../api/types'

const daysAgo = (d: number, now: number) => new Date(now - d * 86_400_000).toISOString().replace(/.d{3}Z$/, 'Z')

export function buildEngineering(now = Date.now()): EngineeringView {
  // Grade N counted N rolls (the recipes of EDSY's Increased Range).
  const needs: [string, number, number][] = [
    ['arsenic', 5, 2],
    ['chemicaldistillery', 4, 4],
    ['chemicalmanipulators', 5, 0],
    ['chemicalprocessors', 5, 7],
    ['dataminedwake', 5, 1],
    ['disruptedwakeechoes', 3, 29],
    ['hyperspacetrajectories', 4, 3],
    ['manganese', 4, 12],
    ['phosphorus', 3, 6],
    ['wakesolutions', 3, 3],
  ]
  return {
    goals: [{ id: 1, module: 'cfsd', blueprint: 'cfsd_ir', gradeFrom: 0, gradeTo: 5, experimental: null, count: 1 }],
    needs: needs.map(([symbol, need, have]) => ({ symbol, need, have })),
    stock: Object.fromEntries(needs.filter(([, , have]) => have > 0).map(([symbol, , have]) => [symbol, have])),
    stockAt: daysAgo(0.2, now),
  }
}

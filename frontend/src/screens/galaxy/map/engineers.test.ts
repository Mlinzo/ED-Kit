import { describe, expect, it } from 'vitest'
import type { GalaxyEngineerView } from '../../../api/types'
import { buildEngineerPoints, engineerKey } from './engineers'

const engineer = (name: string, progress: GalaxyEngineerView['progress']): GalaxyEngineerView => ({
  name,
  system: 'Sol',
  address: '10477373803',
  base: "Dekker's Yard",
  kind: 'ship',
  x: 100,
  y: 0,
  z: 200,
  progress,
  rank: progress === 'unlocked' ? 3 : null,
})

describe('engineers', () => {
  it('places each workshop, bigger once unlocked', () => {
    const [known, unlocked] = buildEngineerPoints([engineer('A', 'known'), engineer('B', 'unlocked')])
    expect(known.key).toBe(engineerKey('A'))
    expect(known.pos).toEqual([1, 0, -2])
    expect(unlocked.size).toBeGreaterThan(known.size)
  })
})

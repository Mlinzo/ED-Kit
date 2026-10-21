import { describe, expect, it } from 'vitest'
import outlines from './outlines.json'
import { SKETCHES } from './sketches'

describe('ship sketches', () => {
  it('traces every outline of a known ship, in metres, with a rear view from a sheet', () => {
    for (const symbol of Object.keys(outlines)) {
      const sketch = SKETCHES[symbol]
      expect(sketch, symbol).toBeDefined()
      expect(sketch.traced).toBeDefined()
      const [L, W, H] = sketch.dims
      const s = sketch.top.map(([x]) => x)
      // The half outline runs from the nose to the stern, inside the ship's length and half width.
      expect(Math.min(...s)).toBeLessThan(0.05 * L)
      expect(Math.max(...s)).toBeGreaterThan(0.95 * L)
      expect(Math.max(...sketch.top.map(([, y]) => y))).toBeLessThanOrEqual(W / 2 + 1e-6)
      expect(Math.max(...sketch.side.map(([, z]) => z))).toBeLessThanOrEqual(H + 1e-6)
      if (sketch.traced === 'sheet') expect(sketch.rear?.length).toBeGreaterThan(3)
    }
  })

  it('keeps the hand-drawn shapes where there is no sheet', () => {
    expect(SKETCHES.mandalay.traced).toBeUndefined()
    expect(SKETCHES.mandalay.rear).toBeUndefined()
    expect(Object.keys(SKETCHES)).toHaveLength(48)
  })
})

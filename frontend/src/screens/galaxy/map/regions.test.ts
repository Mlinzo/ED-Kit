import { describe, expect, it } from 'vitest'
import { decodeRegions, regionAt, regionBounds, regionLabels, type RegionMapData } from './regions'

/** 12 x 12 cells of 10 ly from (0, 0): region 1 on the left 4 columns, 2 on the right 8, an empty top row. */
function sample(): RegionMapData {
  const rows = Array.from({ length: 12 }, (_, z) => (z === 11 ? [12, 0] : [4, 1, 8, 2]))
  return { x0: 0, z0: 0, cellLy: 10, size: 12, names: ['One', 'Two'], rows }
}

describe('region grid', () => {
  it('decodes the runs row by row', () => {
    const grid = decodeRegions(sample())
    expect(grid.cells.length).toBe(144)
    expect(grid.cells[0]).toBe(1)
    expect(grid.cells[3]).toBe(1)
    expect(grid.cells[4]).toBe(2)
    expect(grid.cells[11 * 12]).toBe(0)
  })

  it('finds the region of a point', () => {
    const grid = decodeRegions(sample())
    expect(regionAt(grid, 5, 5)).toBe(1)
    expect(regionAt(grid, 45, 5)).toBe(2)
    expect(regionAt(grid, 45, 115)).toBeNull() // the empty row
    expect(regionAt(grid, -1, 5)).toBeNull()
    expect(regionAt(grid, 500, 5)).toBeNull()
  })

  it('names each region well inside it', () => {
    const grid = decodeRegions(sample())
    const labels = regionLabels(grid)
    expect(labels.map((l) => l.id)).toEqual([1, 2])
    for (const l of labels) expect(regionAt(grid, l.x, l.z)).toBe(l.id)
    const two = labels[1]
    // Away from the border with region 1 (x = 40) and from the map's right edge (x = 120).
    expect(two.x).toBeGreaterThan(60)
    expect(two.x).toBeLessThan(100)
  })

  it('bounds a region', () => {
    const grid = decodeRegions(sample())
    expect(regionBounds(grid, 1)).toEqual({ x0: 0, x1: 40, z0: 0, z1: 110 })
    expect(regionBounds(grid, 7)).toBeNull()
  })
})

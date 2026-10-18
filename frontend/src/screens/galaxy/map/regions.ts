// Codex regions on the galaxy map: the grid from /api/regions (app.regionmap: 2048 x 2048 cells
// over the galactic plane, ~49 ly each, run-length encoded by row), decoded once, and where to
// write each region's name. Pure, so it is tested without WebGL.

/** As /api/regions sends it: each row (from the minimum z up) as flat [length, region, ...]. */
export interface RegionMapData {
  x0: number
  z0: number
  cellLy: number
  size: number
  /** Index + 1 is the region number. */
  names: string[]
  rows: number[][]
}

export interface RegionGrid {
  x0: number
  z0: number
  cellLy: number
  size: number
  names: string[]
  /** Region number per cell (0: none), row-major, row 0 at the minimum z. */
  cells: Uint8Array
}

export function decodeRegions(data: RegionMapData): RegionGrid {
  const { size } = data
  const cells = new Uint8Array(size * size)
  data.rows.forEach((row, z) => {
    let x = 0
    for (let i = 0; i + 1 < row.length; i += 2) {
      const end = Math.min(size, x + row[i])
      if (row[i + 1]) cells.fill(row[i + 1], z * size + x, z * size + end)
      x = end
    }
  })
  return { x0: data.x0, z0: data.z0, cellLy: data.cellLy, size, names: data.names, cells }
}

export function regionAt(grid: RegionGrid, x: number, z: number): number | null {
  const px = Math.floor((x - grid.x0) / grid.cellLy)
  const pz = Math.floor((z - grid.z0) / grid.cellLy)
  if (px < 0 || pz < 0 || px >= grid.size || pz >= grid.size) return null
  return grid.cells[pz * grid.size + px] || null
}

export interface RegionLabel {
  id: number
  /** Galactic coordinates of the label (y = 0). */
  x: number
  z: number
}

/**
 * Where to name each region: its point farthest from any other region (chamfer distance over the
 * grid), so the name sits well inside even a crescent-shaped region.
 */
export function regionLabels(grid: RegionGrid): RegionLabel[] {
  const { size, cells } = grid
  const far = 1 << 15
  const dist = new Uint16Array(size * size)
  // A cell next to another region (or the map's edge) is at distance 1 (×3: chamfer 3-4).
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = z * size + x
      const id = cells[i]
      if (!id) continue
      const edge =
        x === 0 || z === 0 || x === size - 1 || z === size - 1 || cells[i - 1] !== id || cells[i + 1] !== id || cells[i - size] !== id || cells[i + size] !== id
      dist[i] = edge ? 3 : far
    }
  }
  const relax = (i: number, j: number, step: number) => {
    const d = dist[j] + step
    if (d < dist[i]) dist[i] = d
  }
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      const i = z * size + x
      if (dist[i] <= 3) continue
      relax(i, i - 1, 3)
      relax(i, i - size, 3)
      relax(i, i - size - 1, 4)
      relax(i, i - size + 1, 4)
    }
  }
  for (let z = size - 2; z > 0; z--) {
    for (let x = size - 2; x > 0; x--) {
      const i = z * size + x
      if (dist[i] <= 3) continue
      relax(i, i + 1, 3)
      relax(i, i + size, 3)
      relax(i, i + size + 1, 4)
      relax(i, i + size - 1, 4)
    }
  }
  const best = new Map<number, { d: number; i: number }>()
  for (let i = 0; i < cells.length; i++) {
    const id = cells[i]
    if (!id) continue
    const b = best.get(id)
    if (!b || dist[i] > b.d) best.set(id, { d: dist[i], i })
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, { i }]) => ({
      id,
      x: grid.x0 + ((i % size) + 0.5) * grid.cellLy,
      z: grid.z0 + (Math.floor(i / size) + 0.5) * grid.cellLy,
    }))
}

/** A region's bounding box in galactic coordinates, or null if it has no cells. */
export function regionBounds(grid: RegionGrid, id: number): { x0: number; x1: number; z0: number; z1: number } | null {
  const { size, cells } = grid
  let minX = size
  let maxX = -1
  let minZ = size
  let maxZ = -1
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== id) continue
    const x = i % size
    const z = (i - x) / size
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (maxX < 0) return null
  return {
    x0: grid.x0 + minX * grid.cellLy,
    x1: grid.x0 + (maxX + 1) * grid.cellLy,
    z0: grid.z0 + minZ * grid.cellLy,
    z1: grid.z0 + (maxZ + 1) * grid.cellLy,
  }
}

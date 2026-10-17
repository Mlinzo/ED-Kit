// The galaxy behind your travels: a sketch, not real stars (no Frontier imagery). A thin disk
// around Sagittarius A* with four trailing log-spiral arms, a bar and a warm bulge, drawn from a
// fixed seed so it looks the same on every load. Galactic coordinates in ly.

import { CORE, DISK_RADIUS_LY } from './geometry'

export interface Backdrop {
  /** x, y, z per point (galactic ly). */
  positions: Float32Array
  /** r, g, b per point (0–1, linear brightness included). */
  colors: Float32Array
  /** Diameter per point, ly. */
  sizes: Float32Array
  count: number
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ARMS = 4
const PITCH = (13 * Math.PI) / 180
const ARM_START_LY = 4_500
const SCALE_LENGTH_LY = 11_000
/** The bar's half length (ly) and its angle in the plane. */
const BAR = { length: 9_000, width: 2_600, angle: (28 * Math.PI) / 180 }

export function buildBackdrop(count = 60_000, seed = 20_261_017): Backdrop {
  const rand = mulberry32(seed)
  const gauss = () => {
    const u = Math.max(rand(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const b = Math.tan(PITCH)

  for (let i = 0; i < count; i++) {
    const roll = rand()
    let x: number
    let z: number
    let r: number
    let warm: number
    if (roll < 0.14) {
      // Bulge and bar: warm, crowded, thick.
      const along = gauss() * BAR.length * 0.5
      const across = gauss() * BAR.width * 0.5
      x = along * Math.cos(BAR.angle) - across * Math.sin(BAR.angle)
      z = along * Math.sin(BAR.angle) + across * Math.cos(BAR.angle)
      r = Math.hypot(x, z)
      warm = 0.85
    } else {
      // Disk: exponential in radius; most stars near an arm, the rest between them.
      do {
        r = -Math.log(Math.max(rand(), 1e-9)) * SCALE_LENGTH_LY + ARM_START_LY * 0.4
      } while (r > DISK_RADIUS_LY)
      let angle: number
      if (rand() < 0.72 && r > ARM_START_LY) {
        const arm = Math.floor(rand() * ARMS)
        const spread = (gauss() * 1_400) / r
        angle = Math.log(r / ARM_START_LY) / b + (arm * 2 * Math.PI) / ARMS + spread
      } else {
        angle = rand() * Math.PI * 2
      }
      x = r * Math.cos(angle)
      z = r * Math.sin(angle)
      warm = Math.max(0, 0.55 - r / 30_000)
    }
    const thickness = 220 + 1_400 * Math.exp(-r / 3_500)
    const y = gauss() * thickness
    positions.set([CORE.x + x, CORE.y + y, CORE.z + z], i * 3)

    // Warm near the core, blue-white out in the arms; mostly faint, a few bright.
    const bright = 0.25 + 0.75 * Math.pow(rand(), 2.4)
    const fade = 0.35 + 0.65 * Math.exp(-r / 26_000)
    const k = bright * fade
    colors.set([k * (0.72 + 0.28 * warm), k * (0.8 + 0.06 * warm), k * (1 - 0.38 * warm)], i * 3)
    sizes[i] = 90 + 140 * rand()
  }
  return { positions, colors, sizes, count }
}

// Small geometry helpers shared by the hand-rolled SVG charts.

const NICE_STEPS = [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]

/**
 * Rounds a maximum up to a clean axis value (1, 1.2, 1.6, 2, 3, 4, 5, 6, 8 × 10^n) whose half
 * is clean too, so a chart can label 0 / half / max. Integer data keeps an integer half.
 */
export function niceMax(value: number, integer = false): number {
  if (!(value > 0)) return integer ? 2 : 1
  const exp = 10 ** Math.floor(Math.log10(value))
  const f = value / exp
  let nice = (NICE_STEPS.find((s) => f <= s + 1e-9) ?? 10) * exp
  if (integer) nice = Math.max(2, Math.ceil(nice / 2) * 2)
  return nice
}

/** A column with rounded data-end (top) and a square base on the baseline. */
export function columnPath(x: number, y: number, w: number, h: number, radius = 4): string {
  if (h <= 0 || w <= 0) return ''
  const r = Math.max(0, Math.min(radius, w / 2, h))
  const b = y + h
  if (r === 0) return `M${x},${b}V${y}H${x + w}V${b}Z`
  return `M${x},${b}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${b}Z`
}

/** Evenly spaced tick indexes for n items in `plotWidth` px, at least `minGap` px apart. */
export function tickIndexes(n: number, plotWidth: number, minGap = 76): number[] {
  if (n <= 0) return []
  if (n === 1) return [0]
  const k = Math.max(2, Math.min(n, Math.floor(plotWidth / minGap) + 1))
  const out = new Set<number>()
  for (let j = 0; j < k; j++) out.add(Math.round((j * (n - 1)) / (k - 1)))
  return [...out]
}

/** Rough text width for 11px Inter tabular figures; good enough to size a gutter. */
export function approxTextWidth(text: string, px = 11): number {
  return text.length * px * 0.6
}

/** Y-axis ticks for a column chart: half and full of a clean maximum. */
export function columnTicks(values: readonly number[]): { max: number; ticks: [number, number] } {
  const max = niceMax(Math.max(0, ...values), values.every((v) => Number.isInteger(v)))
  return { max, ticks: [max / 2, max] }
}

/** Left gutter (px) that fits a column chart's tick labels; share it so small multiples line up. */
export function columnGutter(values: readonly number[], formatTick: (v: number) => string): number {
  return Math.ceil(Math.max(...columnTicks(values).ticks.map((t) => approxTextWidth(formatTick(t))))) + 8
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Turns the sparse per-day timeline into contiguous buckets (day / week / month) for charts.

import type { DayStats } from '../../api/types'
import { locale } from '../../i18n'
import { tidyDate } from '../../lib/when'

export type Granularity = 'day' | 'week' | 'month'

export interface Bucket {
  /** First day of the bucket, YYYY-MM-DD (UTC). */
  start: string
  jumps: number
  distanceLy: number
  bodiesScanned: number
  speciesAnalysed: number
  earnings: number
  /** Split of `earnings` by kind (0 from a backend that does not report it). */
  earningsCarto: number
  earningsBio: number
  /** Days with any activity inside the bucket. */
  activeDays: number
}

const DAY_MS = 86_400_000

function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function toDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

function bucketStart(t: number, g: Granularity): number {
  if (g === 'day') return t
  const d = new Date(t)
  if (g === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  const weekday = (d.getUTCDay() + 6) % 7 // Monday = 0
  return t - weekday * DAY_MS
}

function nextStart(t: number, g: Granularity): number {
  if (g === 'day') return t + DAY_MS
  if (g === 'week') return t + 7 * DAY_MS
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/** Number of buckets the timeline spans at a granularity. */
export function bucketCount(timeline: readonly DayStats[], g: Granularity): number {
  const days = timeline.map((d) => parseDay(d.date)).filter((t) => !Number.isNaN(t))
  if (days.length === 0) return 0
  const first = bucketStart(Math.min(...days), g)
  const last = bucketStart(Math.max(...days), g)
  let n = 0
  for (let t = first; t <= last; t = nextStart(t, g)) n++
  return n
}

/** The finest granularity whose columns get at least `minPitch` px in `plotWidth`. */
export function pickGranularity(timeline: readonly DayStats[], plotWidth: number, minPitch = 6): Granularity {
  for (const g of ['day', 'week'] as const) {
    const n = bucketCount(timeline, g)
    if (n === 0 || plotWidth / n >= minPitch) return g
  }
  return 'month'
}

/** Contiguous buckets from the first to the last active day; gaps become zero buckets. */
export function bucketize(timeline: readonly DayStats[], g: Granularity): Bucket[] {
  const valid = timeline.filter((d) => !Number.isNaN(parseDay(d.date)))
  if (valid.length === 0) return []
  const times = valid.map((d) => parseDay(d.date))
  const first = bucketStart(Math.min(...times), g)
  const last = bucketStart(Math.max(...times), g)
  const index = new Map<number, Bucket>()
  const out: Bucket[] = []
  for (let t = first; t <= last; t = nextStart(t, g)) {
    const b: Bucket = {
      start: toDay(t),
      jumps: 0,
      distanceLy: 0,
      bodiesScanned: 0,
      speciesAnalysed: 0,
      earnings: 0,
      earningsCarto: 0,
      earningsBio: 0,
      activeDays: 0,
    }
    index.set(t, b)
    out.push(b)
  }
  for (const d of valid) {
    const b = index.get(bucketStart(parseDay(d.date), g))
    if (!b) continue
    b.jumps += d.jumps
    b.distanceLy += d.distanceLy
    b.bodiesScanned += d.bodiesScanned
    b.speciesAnalysed += d.speciesAnalysed
    b.earnings += d.earnings
    b.earningsCarto += d.earningsCarto ?? 0
    b.earningsBio += d.earningsBio ?? 0
    if (d.jumps || d.distanceLy || d.bodiesScanned || d.speciesAnalysed || d.earnings) b.activeDays++
  }
  return out
}

/** Running total of daily earnings over contiguous days (for the growth curve). */
export function cumulativeEarnings(timeline: readonly DayStats[]): { start: string; total: number }[] {
  let sum = 0
  return bucketize(timeline, 'day').map((b) => {
    sum += b.earnings
    return { start: b.start, total: sum }
  })
}

const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
const monthYearFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
const longFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const longNoYearFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' })

const stripDot = tidyDate

/** "16 окт" */
export function shortDay(date: string): string {
  const t = parseDay(date.slice(0, 10))
  return Number.isNaN(t) ? date : stripDot(dayFmt.format(t))
}

/** Axis label for a bucket start. */
export function bucketLabel(date: string, g: Granularity): string {
  const t = parseDay(date)
  if (Number.isNaN(t)) return date
  if (g === 'month') {
    const d = new Date(t)
    return stripDot(d.getUTCMonth() === 0 ? monthYearFmt.format(t) : monthFmt.format(t))
  }
  return shortDay(date)
}

/** "16 октября 2026" (or without the year when it is the current one). */
export function longDate(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const sameYear = new Date(t).getUTCFullYear() === new Date(now).getUTCFullYear()
  return tidyDate((sameYear ? longNoYearFmt : longFmt).format(t))
}

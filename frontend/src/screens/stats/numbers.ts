import { formatNumber } from '../../lib/format'

const NARROW_NBSP = / /g

/**
 * Display-size figures (tiles, hero numbers). With proportional digits the narrow thousands
 * space all but vanishes next to a "1" ("121 679" reads as "121679"), so big figures group
 * with a regular no-break space instead.
 */
export function wideGroups(text: string): string {
  return text.replace(NARROW_NBSP, ' ')
}

/** formatNumber for display-size figures. */
export function bigNumber(value: number, fractionDigits = 0): string {
  return wideGroups(formatNumber(value, fractionDigits))
}

/** Share as a whole percent; "<1%" for a tiny non-zero share, "0%" when there is no total. */
export function percent(part: number, total: number): string {
  if (!(total > 0) || !(part > 0)) return '0%'
  const p = (part / total) * 100
  if (p < 1) return '<1%'
  if (p > 99 && part < total) return '>99%'
  return `${Math.min(100, Math.round(p))}%`
}

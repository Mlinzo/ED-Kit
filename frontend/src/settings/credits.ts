/** Short label for a threshold: 0 → "0", 750000 → "750k", 2000000 → "2M". */
export function shortCredits(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`
  return String(value)
}

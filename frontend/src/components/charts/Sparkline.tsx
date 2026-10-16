/**
 * Stat-tile trend: a quiet line in the de-emphasis grey with a soft wash, and the current
 * period marked in the accent. Decorative (the full chart and table carry the values).
 */
export function Sparkline({
  values,
  width,
  height = 32,
  accent,
  line = '#71717a',
  surface = '#111113',
}: {
  values: readonly number[]
  width: number
  height?: number
  accent: string
  line?: string
  surface?: string
}) {
  const n = values.length
  if (width <= 0 || n < 2) return <div style={{ height }} aria-hidden />
  const pad = 5
  const max = Math.max(0, ...values) || 1
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2)
  const y = (v: number) => pad + (height - pad * 2) * (1 - v / max)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = `${d}L${x(n - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <path d={area} fill={line} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={line} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r={3.5} fill={accent} stroke={surface} strokeWidth={2} paintOrder="stroke" />
    </svg>
  )
}

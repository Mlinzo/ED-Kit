import { useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ChartTooltip } from './ChartTooltip'
import { clamp } from './geometry'

export interface AreaChartProps {
  values: readonly number[]
  width: number
  height?: number
  color: string
  ariaLabel: string
  /** Readout for the point under the crosshair. */
  tooltip?: (index: number) => ReactNode
  /** Surface colour behind the chart (ring around the end marker). */
  surface?: string
}

const PAD = 7 // room for the 4px end marker and its 2px surface ring

/**
 * Single-series area: 2px line over a soft wash of the same hue, an end marker,
 * and a crosshair that snaps to the nearest point. No axes: it shows shape, the figure above shows the number.
 */
export function AreaChart({ values, width, height = 72, color, ariaLabel, tooltip, surface = '#111113' }: AreaChartProps) {
  const gradientId = useId()
  const [active, setActive] = useState<number | null>(null)
  const n = values.length
  const max = Math.max(0, ...values) || 1
  const plotW = Math.max(1, width - PAD * 2)
  const x = (i: number) => PAD + (n <= 1 ? plotW : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD + (height - PAD) - (v / max) * (height - PAD)
  const base = height

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = n > 0 ? `${line}L${x(n - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z` : ''

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = (e.clientX - rect.left - PAD) / plotW
    setActive(clamp(Math.round(t * (n - 1)), 0, n - 1))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return
    const cur = active ?? n - 1
    const step = Math.max(1, Math.round(n / 30))
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - step)
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + step)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    setActive(next)
  }

  const last = n - 1
  return (
    <div
      className="focus-ring relative rounded-md outline-offset-4 select-none"
      style={{ touchAction: 'pan-y' }}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={(e) => e.pointerType !== 'touch' && setActive(null)}
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible')) setActive(n > 0 ? n - 1 : null)
      }}
      onBlur={() => setActive(null)}
      onKeyDown={onKeyDown}
    >
      {width > 0 && n > 0 && (
        <svg width={width} height={height + 1} className="block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${CSS.escape(gradientId)})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {active !== null && (
            <line x1={x(active)} x2={x(active)} y1={PAD - 4} y2={base} stroke="#a1a1aa" strokeOpacity={0.5} strokeWidth={1} />
          )}
          <circle
            cx={x(active ?? last)}
            cy={y(values[active ?? last])}
            r={4}
            fill={color}
            stroke={surface}
            strokeWidth={2}
            paintOrder="stroke"
          />
        </svg>
      )}
      {tooltip && active !== null && (
        <ChartTooltip x={x(active)} width={width}>
          {tooltip(active)}
        </ChartTooltip>
      )}
    </div>
  )
}

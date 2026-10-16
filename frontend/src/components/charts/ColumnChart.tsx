import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { ChartTooltip } from './ChartTooltip'
import { clamp, columnGutter, columnPath, columnTicks, tickIndexes } from './geometry'

/** One layer of a stacked column chart. */
export interface ColumnStack {
  color: string
  values: readonly number[]
}

export interface ColumnChartProps {
  /** Column totals: they set the scale (and are the columns themselves unless `stack` is given). */
  values: readonly number[]
  /** Full SVG width in px (measure the container). */
  width: number
  /** Plot height in px; the x-axis band is added below it. */
  height?: number
  /** Column fill (a CSS colour). */
  color: string
  /** Draw each column as stacked segments, bottom layer first; each layer's values should sum to `values`. */
  stack?: readonly ColumnStack[]
  /** Shared hover index (small multiples hover in sync). */
  active: number | null
  onActive: (index: number | null) => void
  /** Y-axis tick text. */
  formatTick: (v: number) => string
  /** X-axis tick text for a column. */
  xLabel: (index: number) => string
  ariaLabel: string
  /** Readout for the hovered column; shown only by the chart under the pointer / focus. */
  tooltip?: (index: number) => ReactNode
  showTooltip?: boolean
  /** Fixed y-axis gutter (px): pass the same value to small multiples so their columns align. */
  gutter?: number
}

const AXIS_BAND = 22
const TOP_PAD = 8
/** Surface gap between stacked segments. */
const SEGMENT_GAP = 2

/**
 * Thin columns from one baseline: 2px surface gap between neighbours, 4px rounded data-end,
 * hairline grid at half and full scale. Hover / arrow keys pick a column.
 */
export function ColumnChart({
  values,
  width,
  height = 96,
  color,
  stack,
  active,
  onActive,
  formatTick,
  xLabel,
  ariaLabel,
  tooltip,
  showTooltip = false,
  gutter: fixedGutter,
}: ColumnChartProps) {
  const n = values.length
  const { max, ticks } = columnTicks(values)
  const gutter = fixedGutter ?? columnGutter(values, formatTick)
  const plotW = Math.max(0, width - gutter)
  const pitch = n > 0 ? plotW / n : 0
  const gap = pitch >= 8 ? 2 : pitch >= 4 ? 1 : 0
  const barW = Math.max(1, Math.min(24, pitch - gap))
  const y = (v: number) => TOP_PAD + height - (v / max) * height
  const base = TOP_PAD + height
  const colX = (i: number) => gutter + i * pitch + (pitch - barW) / 2

  const indexAt = (clientX: number, rect: DOMRect) => {
    if (n === 0) return null
    return clamp(Math.floor((clientX - rect.left - gutter) / pitch), 0, n - 1)
  }
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    onActive(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return
    const cur = active ?? n - 1
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') {
      onActive(null)
      return
    }
    if (next === null) return
    e.preventDefault()
    onActive(next)
  }

  const svgH = TOP_PAD + height + AXIS_BAND
  const xTicks = tickIndexes(n, plotW, 84)

  return (
    <div
      className="focus-ring relative rounded-md outline-offset-4 select-none"
      style={{ touchAction: 'pan-y' }}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      // Touch keeps the readout after the finger lifts; tapping elsewhere blurs and clears it.
      onPointerLeave={(e) => e.pointerType !== 'touch' && onActive(null)}
      // Keyboard focus starts at the latest column; a click/tap keeps the column under the pointer.
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible')) onActive(active ?? (n > 0 ? n - 1 : null))
      }}
      onBlur={() => onActive(null)}
      onKeyDown={onKeyDown}
    >
      {width > 0 && (
        <svg width={width} height={svgH} className="block overflow-visible" aria-hidden>
          {/* Hairline grid + tick labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={gutter} x2={width} y1={y(t)} y2={y(t)} stroke="#27272a" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={gutter - 8} y={y(t) + 4} textAnchor="end" className="fill-zinc-500 text-[11px] tabular-nums">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {/* Active column band */}
          {active !== null && n > 0 && (
            <rect x={gutter + active * pitch} y={TOP_PAD - 4} width={pitch} height={height + 4} rx={4} fill="#ffffff" fillOpacity={0.05} />
          )}
          {values.map((v, i) => {
            const opacity = active === null || active === i ? 1 : 0.55
            const radius = barW >= 6 ? 4 : barW / 2
            if (stack) {
              const segments = stack.map((l) => ({ color: l.color, v: l.values[i] ?? 0 })).filter((sg) => sg.v > 0)
              let acc = 0
              return (
                <g key={i} fillOpacity={opacity} className="transition-[fill-opacity] duration-150">
                  {segments.map((sg, k) => {
                    const bottom = y(acc)
                    acc += sg.v
                    const top = y(acc)
                    // A 2px surface gap under every upper segment, but never thinner than 1px.
                    const gap = k === 0 ? 0 : Math.min(SEGMENT_GAP, Math.max(0, bottom - top - 1))
                    const d = columnPath(colX(i), top, barW, bottom - gap - top, k === segments.length - 1 ? radius : 0)
                    return d ? <path key={k} d={d} fill={sg.color} /> : null
                  })}
                </g>
              )
            }
            const d = columnPath(colX(i), y(v), barW, base - y(v), radius)
            if (!d) return null
            return (
              <path key={i} d={d} fill={color} fillOpacity={opacity} className="transition-[fill-opacity] duration-150" />
            )
          })}
          <line x1={gutter} x2={width} y1={base + 0.5} y2={base + 0.5} stroke="#3f3f46" strokeWidth={1} />
          {xTicks.map((i, j) => {
            const anchor = n === 1 ? 'middle' : j === 0 ? 'start' : j === xTicks.length - 1 ? 'end' : 'middle'
            const x = anchor === 'start' ? gutter + i * pitch : anchor === 'end' ? gutter + (i + 1) * pitch : gutter + (i + 0.5) * pitch
            return (
              <text key={i} x={x} y={base + 16} textAnchor={anchor} className="fill-zinc-500 text-[11px]">
                {xLabel(i)}
              </text>
            )
          })}
        </svg>
      )}
      {showTooltip && tooltip && active !== null && n > 0 && (
        <ChartTooltip x={gutter + (active + 0.5) * pitch} width={width}>
          {tooltip(active)}
        </ChartTooltip>
      )}
    </div>
  )
}

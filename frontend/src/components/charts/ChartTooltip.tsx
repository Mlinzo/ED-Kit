import type { ReactNode } from 'react'

/**
 * Floating readout above a chart, anchored at `x` px inside its relative container.
 * Near the edges it flips its anchor so it never leaves the card.
 */
export function ChartTooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const side = x < width * 0.3 ? 'left' : x > width * 0.7 ? 'right' : 'center'
  const transform =
    side === 'left' ? 'translate(-16px, -100%)' : side === 'right' ? 'translate(calc(-100% + 16px), -100%)' : 'translate(-50%, -100%)'
  return (
    <div
      className="pointer-events-none absolute -top-2 z-20 w-max max-w-72 min-w-36 rounded-xl bg-zinc-900/95 px-3 py-2 text-xs shadow-xl ring-1 shadow-black/40 ring-zinc-700/80 backdrop-blur"
      style={{ left: x, transform }}
      role="presentation"
    >
      {children}
    </div>
  )
}

/** One tooltip row: a short line-key in the series colour, the value (strong), then the label. */
export function TooltipRow({
  color,
  value,
  label,
  active = true,
}: {
  color?: string
  value: ReactNode
  label: string
  active?: boolean
}) {
  return (
    <div className={`flex items-center gap-2 py-0.5 ${active ? '' : 'opacity-60'}`}>
      {color ? (
        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      ) : (
        <span className="w-3 shrink-0" aria-hidden />
      )}
      <span className="font-semibold whitespace-nowrap text-zinc-50 tabular-nums">{value}</span>
      <span className="whitespace-nowrap text-zinc-400">{label}</span>
    </div>
  )
}

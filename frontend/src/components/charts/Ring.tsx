import type { ReactNode } from 'react'

/**
 * Progress ring: a single ratio against its limit. The track is a dark step of the same hue,
 * so the whole circle reads as one meter.
 */
export function Ring({
  value,
  total,
  size = 128,
  stroke = 10,
  color,
  track,
  label,
  children,
}: {
  value: number
  total: number
  size?: number
  stroke?: number
  color: string
  track: string
  /** Accessible description, e.g. "4 из 118 видов". */
  label: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0
  // A tiny non-zero share still shows as a dot: the round cap draws it even for a near-zero dash.
  const dash = Math.max(frac * c, 0.01)
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {frac > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
          />
        )}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  )
}

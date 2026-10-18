import { useId, useState } from 'react'
import { t } from '../../i18n'
import { formatMeters } from '../../lib/format'

export interface RadarPoint {
  /** 1-based sample number. */
  index: number
  east: number
  north: number
  distance: number
  inside: boolean
}

interface RadarProps {
  points: RadarPoint[]
  rangeM: number
  heading: number | null
  canSample: boolean
  label: string
}

const R = 100 // radar radius in SVG units
const NICE_RADII = [100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10_000]

/** Picks a round scale; keeps the current one unless it no longer fits or is far too big (hysteresis). */
function pickRadius(required: number, current: number | null): number {
  if (current !== null && required <= current && required > current * 0.55) return current
  return NICE_RADII.find((r) => r >= required) ?? NICE_RADII[NICE_RADII.length - 1]
}

const DEGREE_TICKS = Array.from({ length: 36 }, (_, i) => i * 10)
const DEGREE_LABELS = DEGREE_TICKS.filter((d) => d % 30 === 0 && d % 90 !== 0)

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [r * Math.sin(a), -r * Math.cos(a)]
}

/**
 * North-up radar centred on the commander: taken samples with their colony-range circles,
 * heading wedge, scale rings, a 0–360° compass scale. Everything is in metres scaled to the SVG radius.
 */
export function Radar({ points, rangeM, heading, canSample, label }: RadarProps) {
  // Fit every sample while they are close; when far away, fit at least the nearest one
  // (the others are pinned to the rim with their distance).
  const farthest = points.reduce((m, p) => Math.max(m, p.distance + rangeM), 0)
  const nearestEdge = points.reduce((m, p) => Math.min(m, p.distance + rangeM), Number.POSITIVE_INFINITY)
  const fit = farthest <= rangeM * 4 ? farthest : Math.max(rangeM * 4, nearestEdge)
  const required = Math.max(rangeM * 1.5, fit * 1.08)
  const [radiusM, setRadiusM] = useState(() => pickRadius(required, null))
  const nextRadius = pickRadius(required, radiusM)
  if (nextRadius !== radiusM) setRadiusM(nextRadius)

  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clipId = `radar-clip-${uid}`
  const bgId = `radar-bg-${uid}`
  const k = R / nextRadius
  const nearest = points.reduce<RadarPoint | null>((n, p) => (!n || p.distance < n.distance ? p : n), null)
  const stateColor = canSample ? 'var(--color-emerald-400)' : 'var(--color-amber-400)'
  const ringLabelAt = polar(R * 0.5, 135)
  const rimLabelAt = polar(R * 0.98, 135)

  return (
    <svg viewBox="-118 -118 236 236" role="img" aria-label={label} className="h-full w-full select-none">
      <defs>
        <clipPath id={clipId}>
          <circle r={R} />
        </clipPath>
        <radialGradient id={bgId}>
          <stop offset="0%" style={{ stopColor: 'var(--color-zinc-900)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--color-zinc-950)' }} />
        </radialGradient>
      </defs>

      {/* Disc, crosshair and scale rings */}
      <circle r={R} fill={`url(#${bgId})`} strokeWidth={0.8} style={{ stroke: 'var(--color-zinc-800)' }} />
      <g strokeWidth={0.5} style={{ stroke: 'var(--color-zinc-800)' }}>
        <line x1={-R} y1={0} x2={R} y2={0} />
        <line x1={0} y1={-R} x2={0} y2={R} />
        <circle r={R * 0.5} fill="none" strokeDasharray="1.5 2.5" />
      </g>
      <g fontSize={6} textAnchor="middle" style={{ fill: 'var(--color-zinc-500)' }}>
        <text x={ringLabelAt[0]} y={ringLabelAt[1]} dy={-1.5}>
          {formatMeters(nextRadius / 2)}
        </text>
        <text x={rimLabelAt[0] - 4} y={rimLabelAt[1] - 4}>
          {formatMeters(nextRadius)}
        </text>
      </g>

      {/* Degree scale: a tick every 10°, longer and numbered every 30° (letters at 0/90/180/270) */}
      <g strokeWidth={0.6} style={{ stroke: 'var(--color-zinc-700)' }}>
        {DEGREE_TICKS.map((deg) => {
          const [x1, y1] = polar(R, deg)
          const [x2, y2] = polar(deg % 30 === 0 ? R - 5 : R - 2.5, deg)
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />
        })}
      </g>
      <g fontSize={5.5} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--color-zinc-600)' }}>
        {DEGREE_LABELS.map((deg) => {
          const [x, y] = polar(109, deg)
          return (
            <text key={deg} x={x} y={y}>
              {deg}
            </text>
          )
        })}
      </g>

      {/* Compass */}
      <g fontSize={8} fontWeight={600} textAnchor="middle" dominantBaseline="central">
        <text x={0} y={-109} style={{ fill: 'var(--color-accent)' }}>
          {t.surface.north}
        </text>
        <text x={109} y={0} style={{ fill: 'var(--color-zinc-500)' }}>
          {t.surface.east}
        </text>
        <text x={0} y={109} style={{ fill: 'var(--color-zinc-500)' }}>
          {t.surface.south}
        </text>
        <text x={-109} y={0} style={{ fill: 'var(--color-zinc-500)' }}>
          {t.surface.west}
        </text>
      </g>

      <g clipPath={`url(#${clipId})`}>
        {/* Heading wedge */}
        {heading !== null && <HeadingWedge heading={heading} />}

        {/* Colony-range circles */}
        {points.map((p) => (
          <g
            key={`zone-${p.index}`}
            className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-linear"
            style={{ transform: `translate(${p.east * k}px, ${-p.north * k}px)` }}
          >
            <circle
              r={rangeM * k}
              style={{
                fill: p.inside ? 'var(--color-amber-400)' : 'var(--color-zinc-400)',
                stroke: p.inside ? 'var(--color-amber-400)' : 'var(--color-zinc-500)',
              }}
              fillOpacity={p.inside ? 0.14 : 0.05}
              strokeOpacity={p.inside ? 0.9 : 0.6}
              strokeWidth={p.inside ? 1 : 0.7}
              strokeDasharray={p.inside ? undefined : '3 2.5'}
            />
          </g>
        ))}

        {/* Line to the nearest sample */}
        {nearest && nearest.distance * k <= R && (
          <line
            x1={0}
            y1={0}
            x2={nearest.east * k}
            y2={-nearest.north * k}
            style={{ stroke: stateColor }}
            strokeOpacity={0.6}
            strokeWidth={0.8}
            strokeDasharray="2 2"
          />
        )}
      </g>

      {/* Sample markers (clamped to the rim when off-scale) */}
      {points.map((p) => {
        const r = p.distance * k
        const off = r > R * 0.94
        const s = off ? (R * 0.94) / r : 1
        const x = p.east * k * s
        const y = -p.north * k * s
        return (
          <g
            key={`pt-${p.index}`}
            className="motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-linear"
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <title>{`${t.surface.sample(p.index)}: ${formatMeters(p.distance)}`}</title>
            <circle r={off ? 2.5 : 3.4} strokeWidth={1} style={{ fill: 'var(--color-zinc-100)', stroke: 'var(--color-zinc-950)' }} />
            <text
              x={0}
              y={-6.5}
              fontSize={6.5}
              fontWeight={600}
              textAnchor="middle"
              paintOrder="stroke"
              strokeWidth={2}
              style={{ fill: 'var(--color-zinc-200)', stroke: 'var(--color-zinc-950)' }}
            >
              {off ? `${p.index} · ${formatMeters(p.distance)}` : p.index}
            </text>
          </g>
        )
      })}

      {/* Commander */}
      <g transform={heading !== null ? `rotate(${heading})` : undefined}>
        <circle r={11} fillOpacity={0.12} style={{ fill: stateColor }} />
        {heading !== null ? (
          <path
            d="M0,-8.5 L6,6 L0,2.8 L-6,6 Z"
            strokeWidth={1}
            strokeLinejoin="round"
            style={{ fill: stateColor, stroke: 'var(--color-zinc-950)' }}
          />
        ) : (
          <circle r={4} style={{ fill: stateColor }} />
        )}
      </g>
    </svg>
  )
}

function HeadingWedge({ heading }: { heading: number }) {
  const spread = 18
  const [x1, y1] = polar(R, heading - spread)
  const [x2, y2] = polar(R, heading + spread)
  const [hx, hy] = polar(R, heading)
  return (
    <g>
      <path d={`M0,0 L${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} Z`} fillOpacity={0.07} style={{ fill: 'var(--color-accent)' }} />
      <line x1={0} y1={0} x2={hx} y2={hy} strokeOpacity={0.35} strokeWidth={0.6} style={{ stroke: 'var(--color-accent)' }} />
    </g>
  )
}

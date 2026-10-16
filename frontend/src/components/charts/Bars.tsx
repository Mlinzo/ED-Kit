// Small bar figures: meter, segmented collection bar, part-to-whole bar, ranked value bar.

/** One ratio against its limit. The track is a dark step of the fill's own hue. */
export function Meter({
  value,
  total,
  color,
  track,
  label,
  className = 'h-1.5',
}: {
  value: number
  total: number
  color: string
  track: string
  label: string
  className?: string
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0
  return (
    <div
      className={`overflow-hidden rounded-full ${className}`}
      style={{ background: track }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color, minWidth: pct > 0 ? 4 : 0 }} />
    </div>
  )
}

/** A collection: one segment per item, found ones filled. 2px surface gaps between segments. */
export function SegmentBar({
  found,
  total,
  color,
  empty,
  label,
}: {
  found: number
  total: number
  color: string
  empty: string
  label: string
}) {
  return (
    <div className="flex h-1.5 gap-0.5" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={found}>
      {Array.from({ length: Math.max(1, total) }, (_, i) => (
        <span
          key={i}
          className="h-full min-w-0 flex-1 first:rounded-l-full last:rounded-r-full"
          style={{ background: i < found ? color : empty }}
        />
      ))}
    </div>
  )
}

export interface StackSegment {
  key: string
  value: number
  color: string
  label: string
}

/** Part-to-whole in one bar; a 2px surface gap separates the segments. */
export function StackedBar({ segments, className = 'h-2.5', title }: { segments: StackSegment[]; className?: string; title?: (s: StackSegment) => string }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0)
  if (total <= 0) return <div className={`rounded-full bg-zinc-800 ${className}`} />
  const visible = segments.filter((s) => s.value > 0)
  return (
    <div className={`flex gap-0.5 ${className}`} aria-hidden>
      {visible.map((s) => (
        <span
          key={s.key}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: s.value, flexBasis: 0, minWidth: 4, background: s.color }}
          title={title?.(s)}
        />
      ))}
    </div>
  )
}

/** A ranked list bar: value relative to the list's maximum. */
export function ValueBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-1 overflow-hidden rounded-full bg-zinc-800/80" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

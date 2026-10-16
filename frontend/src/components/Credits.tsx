import { exactCredits, formatCredits } from '../lib/format'

/** Compact credits (12.4M) with the exact amount in the tooltip. */
export function Credits({ value, className }: { value: number; className?: string }) {
  return (
    <span className={className} title={exactCredits(value)}>
      {formatCredits(value)}
    </span>
  )
}

export function CreditRange({ min, max, className }: { min: number; max: number; className?: string }) {
  if (min === max) return <Credits value={max} className={className} />
  return (
    <span className={className} title={`${exactCredits(min)} – ${exactCredits(max)}`}>
      {formatCredits(min)}–{formatCredits(max)}
    </span>
  )
}

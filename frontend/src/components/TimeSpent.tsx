// Time you spent in a system or at a planet, and what the stay brought per hour.
import { Timer } from 'lucide-react'
import { useIngest } from '../api/hooks'
import { useNow } from '../hooks/useNow'
import { t } from '../i18n'
import { exactCredits, formatCredits } from '../lib/format'
import { formatDuration, liveSeconds, perHour } from '../lib/timeSpent'

/**
 * "⏱ 1 ч 12 мин · 33.7M/ч"; nothing under a minute. Where you are now (`here`) it counts on while
 * the game runs.
 */
export function TimeSpent({
  seconds,
  earned,
  asOf,
  here,
  label,
  hint,
}: {
  seconds: number
  earned: number
  /** The last journal event: `seconds` are counted up to it. */
  asOf: string | null
  here: boolean
  label: string
  hint: string
}) {
  const now = useNow()
  const running = useIngest()?.gameRunning === true
  const spent = liveSeconds(seconds, asOf, now, here && running)
  if (spent < 60) return null
  const rate = perHour(earned, spent)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-zinc-400 tabular-nums">
      <Timer className="size-4 shrink-0 text-zinc-500" aria-hidden />
      <span title={hint}>
        <span className="sr-only">{label}: </span>
        {formatDuration(spent)}
      </span>
      {rate !== null && rate > 0 && (
        <span title={`${t.timeSpent.perHourHint}: ${exactCredits(Math.round(rate))}`}>
          · {t.timeSpent.perHour(formatCredits(rate))}
        </span>
      )}
    </span>
  )
}

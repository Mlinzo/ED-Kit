// Time spent in a system or at a planet (the backend counts it from the journal), and what the
// stay brought per hour.
import { t } from '../i18n'

/** As app.projector.AFK_GAP_S: a longer silence in the journal is taken for AFK, not counted. */
export const AFK_GAP_S = 30 * 60

/** Shorter stays (and sessions) get no "per hour": a few minutes say nothing about a pace. */
export const MIN_PER_HOUR_S = 600

/** Whole hours and the minutes left over (a minute at least). */
export function splitDuration(seconds: number): { h: number; m: number } {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return { h: Math.floor(minutes / 60), m: minutes % 60 }
}

/** "1 ч 12 мин" */
export function formatDuration(seconds: number): string {
  const { h, m } = splitDuration(seconds)
  return t.session.past.duration(h, m)
}

/**
 * The time spent so far. The backend counts up to the last journal event (`asOf`); where you are
 * now (`here`: and the game runs) the time since is added, unless that silence is already AFK.
 */
export function liveSeconds(seconds: number, asOf: string | null, now: number, here: boolean): number {
  if (!here || !asOf) return seconds
  const since = Math.round((now - Date.parse(asOf)) / 1_000)
  return since > 0 && since <= AFK_GAP_S ? seconds + since : seconds
}

/** Earned per hour spent; null for a stay too short to tell. */
export function perHour(value: number, seconds: number): number | null {
  return seconds >= MIN_PER_HOUR_S ? (value * 3_600) / seconds : null
}

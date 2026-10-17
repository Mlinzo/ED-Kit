// Local date / time labels for events (visits, deaths, footfalls): the commander's own clock.

import { locale } from '../i18n'

const dayFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
const dayYearFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
const fullFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'medium' })

/**
 * Short Intl dates without abbreviation dots and year markers: "16 окт. 2025 г." -> "16 окт 2025",
 * "28 вер. 2025 р." -> "28 вер 2025", "4 Sept" -> "4 Sep". The year marker is a separate word, so
 * the "р." ending "вер." stays.
 */
export function tidyDate(s: string): string {
  return s
    .replace(/\s[гр]\.?(?=,|$)/, '')
    .replace(/\.(?=\s|,|$)/g, '')
    .replace(/\bSept\b/, 'Sep')
}
const tidy = tidyDate

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** "16 окт" (with the year when it is not the current one); null for a missing date. */
export function eventDay(iso: string | null | undefined, now = Date.now()): string | null {
  const t = parse(iso)
  if (t === null) return null
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear()
  return tidy((sameYear ? dayFmt : dayYearFmt).format(t))
}

/** "19:48" */
export function eventTime(iso: string | null | undefined): string | null {
  const t = parse(iso)
  return t === null ? null : timeFmt.format(t)
}

/** "16 окт, 19:48" */
export function eventDayTime(iso: string | null | undefined, now = Date.now()): string | null {
  const day = eventDay(iso, now)
  const time = eventTime(iso)
  return day && time ? `${day}, ${time}` : null
}

/** Full timestamp for tooltips: "16 октября 2026 г., 19:48:49". */
export function eventFull(iso: string | null | undefined): string | null {
  const t = parse(iso)
  return t === null ? null : fullFmt.format(t)
}

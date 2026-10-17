// Local date / time labels for events (visits, deaths, footfalls): the commander's own clock.

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const dayYearFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const fullFmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'medium' })

/** "окт." -> "окт", "2025 г." -> "2025". */
const tidy = (s: string) => s.replace(/\s?г\.?$/, '').replace(/\.(?=\s|$)/g, '')

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

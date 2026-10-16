import { ru } from '../i18n/ru'

const NARROW_NBSP = ' '

/** Group thousands with a narrow no-break space, "." as decimal separator: 12 345.6 */
export function formatNumber(value: number, fractionDigits = 0): string {
  const s = value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  return s.replace(/,/g, NARROW_NBSP)
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Compact credits: 850, 12.3k, 850k, 1.7M, 124M, 1.2B. */
export function formatCredits(value: number): string {
  const sign = value < 0 ? '-' : ''
  const v = Math.abs(value)
  if (v < 1_000) return sign + String(Math.round(v))
  if (v < 100_000) return sign + trimZero((v / 1_000).toFixed(1)) + 'k'
  if (v < 999_500) return sign + Math.round(v / 1_000) + 'k'
  if (v < 99_950_000) return sign + trimZero((v / 1_000_000).toFixed(1)) + 'M'
  if (v < 999_500_000) return sign + Math.round(v / 1_000_000) + 'M'
  return sign + trimZero((v / 1_000_000_000).toFixed(1)) + 'B'
}

/** Exact credits for tooltips: "12 400 000 кр." */
export function exactCredits(value: number): string {
  return `${formatNumber(Math.round(value))} ${ru.units.credits}`
}

export function formatLs(value: number | null): string {
  if (value === null) return ru.common.unknown
  const digits = value > 0 && value < 10 ? 1 : 0
  return `${formatNumber(value, digits)} ${ru.units.ls}`
}

export function formatLy(value: number): string {
  return `${formatNumber(value, value < 100 ? 1 : 0)} ${ru.units.ly}`
}

/** Metres for the surface radar: "312 м", "1.4 км". */
export function formatMeters(value: number): string {
  if (value < 1_000) return `${Math.round(value)}${NARROW_NBSP}${ru.units.m}`
  const km = value / 1_000
  const text = formatNumber(km, km < 100 ? 1 : 0).replace(/\.0$/, '')
  return `${text}${NARROW_NBSP}${ru.units.km}`
}

export function formatGravity(g: number | null): string {
  return g === null ? ru.common.unknown : `${formatNumber(g, 2)} ${ru.units.g}`
}

export function formatKelvin(k: number | null): string {
  return k === null ? ru.common.unknown : `${formatNumber(k)} ${ru.units.k}`
}

/** Body mass: Earth masses for planets, solar masses for stars (decimals scale with size). */
export function formatMass(value: number | null, kind: 'star' | 'planet'): string {
  if (value === null) return ru.common.unknown
  const digits = value >= 100 ? 0 : value >= 1 ? 2 : value >= 0.01 ? 3 : 4
  return `${formatNumber(value, digits)} ${kind === 'star' ? ru.units.solarMass : ru.units.earthMass}`
}

export function formatKm(km: number | null): string {
  return km === null ? ru.common.unknown : `${formatNumber(km)} ${ru.units.km}`
}

export function formatRelative(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ru.common.unknown
  const minutes = Math.max(0, Math.floor((now - t) / 60_000))
  if (minutes < 1) return ru.time.justNow
  if (minutes < 60) return ru.time.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return ru.time.hoursAgo(hours)
  return ru.time.daysAgo(Math.floor(hours / 24))
}

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? ru.common.unknown : dateTimeFormat.format(t)
}

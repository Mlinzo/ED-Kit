import { lang, locale, t } from '../i18n'
import { tidyDate } from './when'

const NARROW_NBSP = ' '

/** Thousands grouped with commas in English (as the game does: 12,345.6), with a narrow no-break
 *  space in the other languages (12 345.6); "." as the decimal separator everywhere. */
export function formatNumber(value: number, fractionDigits = 0): string {
  const s = value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  return lang === 'en' ? s : s.replace(/,/g, NARROW_NBSP)
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
  return `${formatNumber(Math.round(value))} ${t.units.credits}`
}

export function formatLs(value: number | null): string {
  if (value === null) return t.common.unknown
  const digits = value > 0 && value < 10 ? 1 : 0
  return `${formatNumber(value, digits)} ${t.units.ls}`
}

export function formatLy(value: number): string {
  return `${formatNumber(value, value < 100 ? 1 : 0)} ${t.units.ly}`
}

/** Fuel in tons, without the unit: "0.42", "7.3", "112". */
export function formatTons(value: number): string {
  return formatNumber(value, value < 10 ? (value < 1 ? 2 : 1) : 0)
}

/** Metres for the surface radar: "312 м", "1.4 км". */
export function formatMeters(value: number): string {
  if (value < 1_000) return `${Math.round(value)}${NARROW_NBSP}${t.units.m}`
  const km = value / 1_000
  const text = formatNumber(km, km < 100 ? 1 : 0).replace(/\.0$/, '')
  return `${text}${NARROW_NBSP}${t.units.km}`
}

/** A compass direction, 0–359° (like the in-game heading). */
export function formatDegrees(deg: number): string {
  return `${((Math.round(deg) % 360) + 360) % 360}°`
}

export function formatGravity(g: number | null): string {
  return g === null ? t.common.unknown : `${formatNumber(g, 2)} ${t.units.g}`
}

export function formatKelvin(k: number | null): string {
  return k === null ? t.common.unknown : `${formatNumber(k)} ${t.units.k}`
}

/** Body mass: Earth masses for planets, solar masses for stars (decimals scale with size). */
export function formatMass(value: number | null, kind: 'star' | 'planet'): string {
  if (value === null) return t.common.unknown
  const digits = value >= 100 ? 0 : value >= 1 ? 2 : value >= 0.01 ? 3 : 4
  return `${formatNumber(value, digits)} ${kind === 'star' ? t.units.solarMass : t.units.earthMass}`
}

export function formatKm(km: number | null): string {
  return km === null ? t.common.unknown : `${formatNumber(km)} ${t.units.km}`
}

export function formatRelative(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return t.common.unknown
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000))
  if (minutes < 1) return t.time.justNow
  if (minutes < 60) return t.time.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return t.time.hoursAgo(hours)
  return t.time.daysAgo(Math.floor(hours / 24))
}

const dateTimeFormat = new Intl.DateTimeFormat(locale, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? t.common.unknown : tidyDate(dateTimeFormat.format(ms))
}

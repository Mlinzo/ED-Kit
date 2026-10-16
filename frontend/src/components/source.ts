// Where body data comes from: the commander's own scans (journal) or a community database
// (Spansh / EDSM: other players' scans). Text helpers shared by <SourceBadge> components.

import type { BodyView, DataSource } from '../api/types'
import { ru } from '../i18n/ru'

export type CommunitySource = Exclude<DataSource, 'journal'>

export function isCommunity(s: DataSource | null | undefined): s is CommunitySource {
  return s === 'spansh' || s === 'edsm'
}

const NAMES: Record<CommunitySource, string> = { spansh: 'Spansh', edsm: 'EDSM' }

export function sourceName(s: CommunitySource): string {
  return NAMES[s] ?? s
}

const NBSP = ' '
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const dayYearFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** "11 окт", "3 мар 2025"; with the time "16 окт, 20:48". null when there is no valid date. */
export function sourceDate(iso: string | null, withTime = false, now = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear()
  // No-break spaces: "11 окт" never splits across lines.
  const day = (sameYear ? dayFmt : dayYearFmt)
    .format(t)
    .replace(/\./g, '')
    .replace(/\s?г$/, '')
    .replace(/\s/g, NBSP)
  return withTime ? `${day}, ${timeFmt.format(t)}` : day
}

/** "Spansh — данные других игроков · обновлено 11 окт" */
export function communityText(source: CommunitySource, at: string | null = null): string {
  const date = sourceDate(at)
  const text = ru.source.community(sourceName(source))
  return date ? `${text} · ${ru.source.updated(date)}` : text
}

export interface SourceMarker {
  /** body: the whole body is community data; bio: only its bio signals / genera are. */
  scope: 'body' | 'bio'
  source: CommunitySource
  /** Full explanation for a tooltip / screen readers. */
  title: string
}

/**
 * What a compact marker (map label, hover card, list row) says about community data.
 * null for bodies the commander scanned whose bio data is their own too.
 */
export function sourceMarker(body: BodyView): SourceMarker | null {
  if (isCommunity(body.source)) {
    return { scope: 'body', source: body.source, title: communityText(body.source, body.sourceAt) }
  }
  if (body.signals.bio === 0) return null
  const lines: string[] = []
  let source: CommunitySource | null = null
  if (isCommunity(body.signalsSource)) {
    lines.push(`${ru.source.bioSignals}: ${ru.source.community(sourceName(body.signalsSource))}`)
    source = body.signalsSource
  }
  if (isCommunity(body.genusesSource) && body.genuses.length > 0) {
    lines.push(`${ru.source.genuses}: ${ru.source.community(sourceName(body.genusesSource))}`)
    source ??= body.genusesSource
  }
  return source ? { scope: 'bio', source, title: lines.join('\n') } : null
}

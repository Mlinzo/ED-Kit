// Codex marks: whether a species would be a new entry in the commander's codex. The codex is kept
// per galactic region, and the marks are per species (colour variants are not predicted yet).
// Text helpers shared by the <CodexBadge> components.

import type { BodyView, CodexStatus } from '../api/types'
import { ru } from '../i18n/ru'

const LABELS: Record<CodexStatus, string> = {
  new: ru.codex.new,
  new_region: ru.codex.newRegion,
  logged: ru.codex.logged,
}

const HINTS: Record<CodexStatus, string> = {
  new: ru.codex.newHint,
  new_region: ru.codex.newRegionHint,
  logged: ru.codex.loggedHint,
}

/** "Новое в кодексе" / "Новое для региона" / "В кодексе"; unknown codes read as logged. */
export function codexLabel(status: CodexStatus): string {
  return LABELS[status] ?? LABELS.logged
}

/**
 * Tooltip of a species mark: what it means, and that the codex is per region.
 * tentative: the species is only an uncertain prediction on this body.
 */
export function codexTitle(status: CodexStatus, tentative = false): string {
  const lines = [codexLabel(status), HINTS[status] ?? HINTS.logged]
  if (tentative && codexNewStatus(status)) lines.push(ru.codex.tentativeHint)
  lines.push(ru.codex.note)
  return lines.join('\n')
}

/** New to your codex, or new for this region (both give a new entry). */
export function codexNewStatus(status: CodexStatus): boolean {
  return status === 'new' || status === 'new_region'
}

export interface BodyCodex {
  /** new: confirmed / DSS-certain species new to the codex; maybe: only uncertain predictions. */
  level: 'new' | 'maybe'
  /** The number on the mark. */
  count: number
  /** "Новое в кодексе: 2 вида · ещё 1 — возможно" / "Возможно новое: 1 вид" */
  text: string
  /** Full explanation for a tooltip / screen readers. */
  title: string
}

/** What a body's codex mark says; null when nothing here would be new to the codex. */
export function bodyCodex(body: Pick<BodyView, 'codexNew' | 'codexMaybe' | 'genuses'>): BodyCodex | null {
  const sure = Math.max(0, body.codexNew)
  const maybe = Math.max(0, body.codexMaybe)
  const dss = body.genuses.length === 0 ? ` ${ru.codex.dssHint}` : ''
  if (sure > 0) {
    const text = maybe > 0 ? `${ru.codex.bodyNew(sure)} · ${ru.codex.alsoMaybe(maybe)}` : ru.codex.bodyNew(sure)
    const lines = [ru.codex.bodyNew(sure), ru.codex.bodyNewHint]
    if (maybe > 0) lines.push(`${ru.codex.bodyMaybe(maybe)}. ${ru.codex.bodyMaybeHint}${dss}`)
    lines.push(ru.codex.note)
    return { level: 'new', count: sure, text, title: lines.join('\n') }
  }
  if (maybe > 0) {
    const text = ru.codex.bodyMaybe(maybe)
    return { level: 'maybe', count: maybe, text, title: [text, `${ru.codex.bodyMaybeHint}${dss}`, ru.codex.note].join('\n') }
  }
  return null
}

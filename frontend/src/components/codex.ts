// Codex marks: whether a species would be a new entry in the commander's codex. The codex is kept
// per galactic region and per colour of a species, as the game keeps it.
// Text helpers shared by the <CodexBadge> components.

import type { BodyView, CodexStatus } from '../api/types'
import { t } from '../i18n'

const LABELS: Record<CodexStatus, string> = {
  new: t.codex.new,
  new_region: t.codex.newRegion,
  new_colour: t.codex.newColour,
  logged: t.codex.logged,
}

const HINTS: Record<CodexStatus, string> = {
  new: t.codex.newHint,
  new_region: t.codex.newRegionHint,
  new_colour: t.codex.newColourHint,
  logged: t.codex.loggedHint,
}

/** "Новое в кодексе" / "Новое для региона" / "Новый цвет" / "В кодексе"; unknown codes read as logged. */
export function codexLabel(status: CodexStatus): string {
  return LABELS[status] ?? LABELS.logged
}

/**
 * Tooltip of a species mark: what it means, and that the codex is per region.
 * tentative: the species is only an uncertain prediction on this body.
 */
export function codexTitle(status: CodexStatus, tentative = false): string {
  const lines = [codexLabel(status), HINTS[status] ?? HINTS.logged]
  if (tentative && codexNewStatus(status)) lines.push(t.codex.tentativeHint)
  lines.push(t.codex.note)
  return lines.join('\n')
}

/** New to your codex, new for this region or a new colour (each gives a new entry). */
export function codexNewStatus(status: CodexStatus): boolean {
  return status === 'new' || status === 'new_region' || status === 'new_colour'
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
  const dss = body.genuses.length === 0 ? ` ${t.codex.dssHint}` : ''
  if (sure > 0) {
    const text = maybe > 0 ? `${t.codex.bodyNew(sure)} · ${t.codex.alsoMaybe(maybe)}` : t.codex.bodyNew(sure)
    const lines = [t.codex.bodyNew(sure), t.codex.bodyNewHint]
    if (maybe > 0) lines.push(`${t.codex.bodyMaybe(maybe)}. ${t.codex.bodyMaybeHint}${dss}`)
    lines.push(t.codex.note)
    return { level: 'new', count: sure, text, title: lines.join('\n') }
  }
  if (maybe > 0) {
    const text = t.codex.bodyMaybe(maybe)
    return { level: 'maybe', count: maybe, text, title: [text, `${t.codex.bodyMaybeHint}${dss}`, t.codex.note].join('\n') }
  }
  return null
}

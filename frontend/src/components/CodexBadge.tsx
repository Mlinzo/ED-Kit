// Codex marks. New codex entries must jump out at a glance, so they get the one colour nothing
// else in the app uses: a filled, glowing fuchsia chip with a book-plus icon. New for this region
// only, or a new colour of a species you have here: the same hue, outlined. Uncertain (predicted,
// no DSS yet): the same book, faint and dashed.
// Already in your codex: a quiet grey check. (Violet stays reserved for community data.)

import { BookCheck, BookPlus, type LucideIcon } from 'lucide-react'
import type { BodyView, CodexStatus } from '../api/types'
import { HelpTip } from '../guide/HelpTip'
import { t } from '../i18n'
import { bodyCodex, codexLabel, codexNewStatus, codexTitle, type Tentative } from './codex'

const STRONG =
  'bg-fuchsia-600 text-white ring-1 ring-inset ring-fuchsia-300/45 shadow-[0_0_14px_-3px_var(--color-fuchsia-500)]'
const OUTLINE = 'bg-fuchsia-500/10 text-fuchsia-200 ring-1 ring-inset ring-fuchsia-400/75'
const FAINT = 'border border-dashed border-fuchsia-400/50 text-fuchsia-300/85'

const ICONS: Record<CodexStatus, LucideIcon> = { new: BookPlus, new_region: BookPlus, new_colour: BookPlus, logged: BookCheck }

type ChipSize = 'xs' | 'sm' | 'md'

const CHIP: Record<ChipSize, { box: string; icon: string }> = {
  xs: { box: 'h-5 gap-1 px-1.5 text-[11px]', icon: 'size-3' },
  sm: { box: 'h-6 gap-1 px-2 text-xs', icon: 'size-3.5' },
  md: { box: 'h-7 gap-1.5 px-2.5 text-sm', icon: 'size-4' },
}

/**
 * One species: "Новое в кодексе" (strong), "Новое для региона" / "Новый цвет" (outlined),
 * "В кодексе" (quiet).
 * tentative (the species may not be there: no DSS yet, or one of several of its genus): a new
 * entry is faint and dashed, like the body's "возможно новое" mark.
 */
export function CodexBadge({
  status,
  size = 'xs',
  tentative,
  className = '',
}: {
  status: CodexStatus
  size?: ChipSize
  tentative?: Tentative
  className?: string
}) {
  const Icon = ICONS[status] ?? BookCheck
  const { box, icon } = CHIP[size]
  const title = codexTitle(status, tentative)
  if (!codexNewStatus(status)) {
    const text = size === 'md' ? 'text-sm' : size === 'sm' ? 'text-xs' : 'text-[11px]'
    return (
      <span title={title} className={`inline-flex shrink-0 items-center gap-1 font-medium text-zinc-500 ${text} ${className}`}>
        <Icon className={`${icon} shrink-0`} strokeWidth={2.25} aria-hidden />
        {codexLabel(status)}
        <span className="sr-only">. {title}</span>
      </span>
    )
  }
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full whitespace-nowrap ${box} ${
        tentative ? `font-medium ${FAINT}` : `font-semibold ${status === 'new' ? STRONG : OUTLINE}`
      } ${className}`}
    >
      <Icon className={`${icon} shrink-0`} strokeWidth={2.5} aria-hidden />
      {codexLabel(status)}
      <span className="sr-only">. {title}</span>
    </span>
  )
}

/**
 * A body's mark: species here that would be new codex entries. Strong with the count of confirmed
 * ones (codexNew); faint and dashed when there are only uncertain predictions (codexMaybe).
 * Icon + count (map labels), or with its text (`label`, list rows).
 */
export function CodexMark({
  body,
  size = 'xs',
  label = false,
}: {
  body: Pick<BodyView, 'codexNew' | 'codexMaybe' | 'genuses'>
  size?: 'xs' | 'sm'
  label?: boolean
}) {
  const codex = bodyCodex(body)
  if (!codex) return null
  const strong = codex.level === 'new'
  const { box, icon } = CHIP[size]
  const text = strong ? t.codex.bodyNew(codex.count) : t.codex.bodyMaybe(codex.count)
  return (
    <span
      title={codex.title}
      className={`inline-flex shrink-0 items-center rounded-full whitespace-nowrap tabular-nums ${box} ${
        strong ? `font-semibold ${STRONG}` : `font-medium ${FAINT}`
      }`}
    >
      <BookPlus className={`${icon} shrink-0`} strokeWidth={2.5} aria-hidden />
      <span aria-hidden>{label ? text : codex.count}</span>
      <span className="sr-only">{codex.title}</span>
    </span>
  )
}

/** One line for the map hover card: the mark's icon and its full text. */
export function CodexLine({ body, className = '' }: { body: Pick<BodyView, 'codexNew' | 'codexMaybe' | 'genuses'>; className?: string }) {
  const codex = bodyCodex(body)
  if (!codex) return null
  const strong = codex.level === 'new'
  return (
    <p className={`flex items-center gap-2 text-xs leading-snug ${strong ? 'font-semibold text-fuchsia-100' : 'text-fuchsia-200/80'} ${className}`}>
      <span className={`grid size-5 shrink-0 place-items-center rounded-full ${strong ? STRONG : FAINT}`}>
        <BookPlus className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
      <span className="min-w-0">{codex.text}</span>
    </p>
  )
}

/** Details panel: what the codex says about this body's species, in one short line. */
export function CodexSummary({ body }: { body: BodyView }) {
  if (body.species.length === 0) return null
  const codex = bodyCodex(body)
  if (!codex) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-zinc-500" title={t.codex.note}>
        <BookCheck className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
        {t.codex.allLogged}
        <HelpTip topic="codex" />
      </p>
    )
  }
  const strong = codex.level === 'new'
  return (
    <div
      title={codex.title}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        strong ? 'bg-fuchsia-500/[0.09] ring-1 ring-fuchsia-400/35 ring-inset' : 'border border-dashed border-fuchsia-400/35'
      }`}
    >
      <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${strong ? STRONG : FAINT}`}>
        <BookPlus className="size-4" strokeWidth={2.5} aria-hidden />
      </span>
      <div className="min-w-0 text-sm">
        <p className={strong ? 'font-semibold text-fuchsia-50' : 'font-medium text-fuchsia-200/90'}>{codex.text}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{strong ? t.codex.bodyNewHint : t.codex.bodyMaybeHint}</p>
      </div>
      <HelpTip topic="codex" className="ml-auto" />
      <span className="sr-only">{t.codex.note}</span>
    </div>
  )
}

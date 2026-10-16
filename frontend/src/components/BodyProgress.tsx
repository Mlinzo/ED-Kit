import { Check, Leaf, Map as MapIcon } from 'lucide-react'
import type { BodyView } from '../api/types'
import { ru } from '../i18n/ru'
import { sourceMarker, type SourceMarker } from './source'
import { CommunityGlyph } from './SourceBadge'

type State = 'todo' | 'partial' | 'complete'

interface Item {
  key: string
  icon: typeof Leaf
  text: string
  state: State
  title: string
  /** Bio signals / genera taken from a community database. */
  community?: SourceMarker
}

const TONE: Record<State, string> = {
  todo: 'bg-zinc-900/80 text-zinc-300 ring-zinc-700/70',
  partial: 'bg-emerald-500/[0.07] text-emerald-200 ring-emerald-400/25',
  complete: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/35',
}

/** The progress items a body has: exobiology (analysed / signals) and DSS mapping. */
function progressItems(body: BodyView): Item[] {
  const items: Item[] = []
  if (body.signals.bio > 0) {
    const done = Math.min(body.bioDone, body.signals.bio)
    const marker = sourceMarker(body)
    const community = marker?.scope === 'bio' ? marker : undefined
    items.push({
      key: 'bio',
      icon: Leaf,
      text: `${done}/${body.signals.bio}`,
      state: done >= body.signals.bio ? 'complete' : done > 0 ? 'partial' : 'todo',
      title: [ru.progress.bioTitle(done, body.signals.bio), community?.title].filter(Boolean).join('\n'),
      community,
    })
  }
  if (body.kind === 'planet' && (body.mappedByMe || body.worthMapping)) {
    items.push({
      key: 'dss',
      icon: MapIcon,
      text: 'DSS',
      state: body.mappedByMe ? 'complete' : 'todo',
      title: body.mappedByMe ? ru.progress.mapped : ru.progress.worthMapping,
    })
  }
  return items
}

/**
 * What the commander has already collected on a body, at a glance:
 * DSS mapping (when worth it or done) and exobiology progress (analysed / signals); a violet
 * database icon in the bio chip when its signals / genera come from Spansh or EDSM.
 * Shared by the body list, the details panel and the 3D map labels.
 */
export function BodyProgress({ body, size = 'sm' }: { body: BodyView; size?: 'xs' | 'sm' }) {
  const items = progressItems(body)
  if (items.length === 0) return null

  const text = size === 'xs' ? 'text-[11px] h-5 px-1.5 gap-1' : 'text-xs h-6 px-2 gap-1.5'
  const iconSize = size === 'xs' ? 'size-3' : 'size-3.5'
  return (
    <ul className="inline-flex items-center gap-1">
      {items.map(({ key, icon: Icon, text: label, state, title, community }) => (
        <li
          key={key}
          title={title}
          className={`inline-flex items-center rounded-full font-medium tabular-nums ring-1 ring-inset ${text} ${TONE[state]}`}
        >
          <Icon className={`${iconSize} shrink-0`} strokeWidth={2.25} aria-hidden />
          <span aria-hidden>{label}</span>
          {state === 'complete' && <Check className={`${iconSize} shrink-0`} strokeWidth={3} aria-hidden />}
          {community && <CommunityGlyph className={iconSize} />}
          <span className="sr-only">{title}</span>
        </li>
      ))}
    </ul>
  )
}

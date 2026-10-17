import { CircleCheck, MapPin } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import type { BodyView } from '../../api/types'
import { BodyBadges, type RouteTarget } from '../../components/BodyBadges'
import { targetOf } from '../../lib/routeTarget'
import { BodyProgress } from '../../components/BodyProgress'
import { CodexMark } from '../../components/CodexBadge'
import { CreditRange, Credits } from '../../components/Credits'
import { sourceMarker } from '../../components/source'
import { SourceTag } from '../../components/SourceBadge'
import { t } from '../../i18n'
import { bodyLabel } from '../../lib/body'
import { formatLs } from '../../lib/format'
import { bodyColor } from '../../map/visuals/colors'

const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_4.75rem_4.75rem_7.5rem]'

const bodyOptionId = (body: BodyView) => `body-${body.id64}`

interface ListProps {
  bodies: BodyView[]
  selectedId: string | null
  focusId: string | null
  currentBodyId: number | null
  /** Arrow-key focus moved to a body. */
  onFocusBody: (id: string) => void
  /** Click / Enter / Space on a body. */
  onSelect: (id: string) => void
  /** Body id -> done, for the bodies the stored route counts on. */
  routeTargets: ReadonlyMap<number, boolean>
}

export function BodyList({ bodies, selectedId, focusId, currentBodyId, onFocusBody, onSelect, routeTargets }: ListProps) {
  const refs = useRef(new Map<string, HTMLLIElement>())
  // Roving tabindex: exactly one row is reachable with Tab.
  const tabStop = focusId ?? selectedId ?? bodies[0]?.id64 ?? null

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const index = bodies.findIndex((b) => b.id64 === (document.activeElement as HTMLElement | null)?.dataset.id)
    let next = -1
    if (e.key === 'ArrowDown') next = Math.min(bodies.length - 1, index + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = bodies.length - 1
    else if ((e.key === 'Enter' || e.key === ' ') && index >= 0) {
      e.preventDefault()
      onSelect(bodies[index].id64)
      return
    }
    if (next < 0) return
    e.preventDefault()
    const id = bodies[next].id64
    refs.current.get(id)?.focus()
    onFocusBody(id)
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-zinc-900/30 ring-1 ring-zinc-800">
      <div
        className={`${GRID} hidden gap-x-4 border-b border-zinc-800 px-4 py-2 text-xs font-medium tracking-wide text-zinc-500 uppercase lg:grid`}
        aria-hidden
      >
        <span>{t.system.colBody}</span>
        <span className="text-right">{t.system.fss}</span>
        <span className="text-right">{t.system.dss}</span>
        <span className="text-right">{t.system.bio}</span>
      </div>
      <ul
        role="listbox"
        aria-label={t.system.listLabel}
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="divide-y divide-zinc-800/70"
      >
        {bodies.map((body) => (
          <BodyRow
            key={body.id64}
            body={body}
            selected={body.id64 === selectedId}
            tabbable={body.id64 === tabStop}
            current={body.bodyId === currentBodyId}
            routeTarget={targetOf(routeTargets, body.bodyId)}
            onSelect={onSelect}
            refCallback={(el) => {
              if (el) refs.current.set(body.id64, el)
              else refs.current.delete(body.id64)
            }}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * Leading marker: a dot in the body's own colour, brighter and larger the more interesting it is
 * (the same language as the map); an emerald check once everything worth doing is done.
 */
function BodyMarker({ body }: { body: BodyView }) {
  if (body.done) {
    return (
      <span className="grid size-4 shrink-0 place-items-center self-center" title={t.progress.done}>
        <CircleCheck className="size-4 text-emerald-400" strokeWidth={2.5} aria-hidden />
        <span className="sr-only">{t.progress.done}</span>
      </span>
    )
  }
  const color = bodyColor(body.visual, body.kind)
  const size = body.kind === 'star' ? 11 : body.interest === 'high' ? 10 : body.interest === 'medium' ? 8 : 6
  const glow =
    body.kind === 'star'
      ? `0 0 8px 1px ${color}80`
      : body.interest === 'high'
        ? `0 0 0 3px ${color}26, 0 0 10px ${color}66`
        : 'none'
  return (
    <span className="grid size-4 shrink-0 place-items-center self-center" aria-hidden>
      <span
        className="rounded-full"
        style={{
          width: size,
          height: size,
          background: color,
          boxShadow: glow,
          opacity: body.interest === 'low' && body.kind !== 'star' ? 0.6 : 1,
        }}
      />
    </span>
  )
}

function BodyRow({
  body,
  selected,
  tabbable,
  current,
  routeTarget,
  onSelect,
  refCallback,
}: {
  body: BodyView
  selected: boolean
  tabbable: boolean
  current: boolean
  routeTarget: RouteTarget | null
  onSelect: (id: string) => void
  refCallback: (el: HTMLLIElement | null) => void
}) {
  const high = body.interest === 'high'
  // Uninteresting bodies recede; hovering, focusing or selecting brings them back.
  // The row fades to 75% and its grey captions step up one shade, so the text stays >= 4.5:1.
  const dim = body.interest === 'low' && !body.done && !selected && !current
  const caption = dim ? 'text-zinc-400' : 'text-zinc-500'
  const hasDss = body.kind === 'planet' && body.dssValue > 0
  const hasBio = body.bioValueMax > 0
  const primary = hasDss ? body.dssValue : body.fssValue
  const valueTone = high ? 'text-zinc-100' : 'text-zinc-400'
  const toMap = body.worthMapping && !body.mappedByMe
  const bioTone = body.signals.bio > 0 && body.bioDone >= body.signals.bio ? 'text-emerald-300/60' : 'text-emerald-300'
  // Community data (Spansh / EDSM): the body type line names the database; bio-only data is
  // marked inside the bio chip by <BodyProgress>.
  const marker = sourceMarker(body)

  return (
    <li
      ref={refCallback}
      id={bodyOptionId(body)}
      data-id={body.id64}
      data-interest={body.interest}
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect(body.id64)}
      className={`${GRID} focus-ring relative min-h-16 cursor-pointer items-center gap-x-4 px-4 py-3 outline-offset-[-2px] transition-[background-color,opacity] ${
        selected ? 'bg-zinc-800/70' : 'hover:bg-zinc-900/80 active:bg-zinc-900'
      } ${dim ? 'opacity-75 hover:opacity-100 focus-visible:opacity-100' : ''}`}
    >
      {selected && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" aria-hidden />}

      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <BodyMarker body={body} />
          <span
            className={`truncate text-[17px] proportional-nums ${
              high ? 'font-semibold text-zinc-50' : body.interest === 'medium' ? 'font-medium text-zinc-200' : 'font-medium text-zinc-400'
            }`}
          >
            {bodyLabel(body)}
          </span>
          {body.interest === 'low' && !body.done && <span className="sr-only">, {t.progress.lowInterest}</span>}
          {current && (
            <span className="inline-flex shrink-0 items-center gap-1 self-center text-xs font-medium text-accent">
              <MapPin className="size-3.5" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t.system.youAreHere}</span>
            </span>
          )}
          <span className={`shrink-0 text-sm ${caption}`}>{formatLs(body.distanceLs)}</span>
        </div>
        <div className={`flex min-w-0 items-center gap-2 pl-6 text-sm ${caption}`}>
          <span className="truncate">{body.subtype}</span>
          {marker?.scope === 'body' && <SourceTag marker={marker} className="text-xs" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-6 empty:hidden">
          <BodyProgress body={body} />
          <CodexMark body={body} size="sm" label />
          <BodyBadges body={body} omitProgress routeTarget={routeTarget} />
        </div>
      </div>

      {/* Desktop: one column per value */}
      <div className={`hidden text-right text-[15px] font-medium lg:block ${valueTone}`}>
        <Credits value={body.fssValue} />
      </div>
      <div className={`hidden text-right text-[15px] font-medium lg:block ${toMap ? 'text-emerald-300' : valueTone}`}>
        {hasDss ? <Credits value={body.dssValue} /> : <span className="text-zinc-600">{t.common.unknown}</span>}
      </div>
      <div className="hidden text-right text-[15px] font-medium lg:block">
        {hasBio ? (
          <CreditRange min={body.bioValueMin} max={body.bioValueMax} className={bioTone} />
        ) : (
          <span className="text-zinc-600">{t.common.unknown}</span>
        )}
      </div>

      {/* Phone: best carto value + bio range, stacked */}
      <div className="flex flex-col items-end gap-0.5 text-right lg:hidden">
        <span className={`text-base font-semibold ${toMap ? 'text-emerald-300' : valueTone}`}>
          <Credits value={primary} />
        </span>
        <span className={`text-[11px] font-medium tracking-wide uppercase ${caption}`}>
          {hasDss ? t.system.dss : t.system.fss}
        </span>
        {hasBio && (
          <span className={`text-sm font-semibold ${bioTone}`}>
            <span className="sr-only">{t.system.bio} </span>
            <CreditRange min={body.bioValueMin} max={body.bioValueMax} />
          </span>
        )}
      </div>
    </li>
  )
}

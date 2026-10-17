// The stop picked on the route map: what is there, where, and the same edits as the list.
import { ChevronsUp, ExternalLink, SkipForward, Undo2, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import type { RouteStopView, RouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CreditRange } from '../../components/Credits'
import { ru } from '../../i18n/ru'
import { formatLy } from '../../lib/format'
import { spanshUrl, type StopActions } from './helpers'
import { BodyRow, IconButton, PopulatedBadge, StopStatus } from './parts'

function Action({ onClick, children, danger = false }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 ${
        danger ? 'text-zinc-400 hover:text-rose-300' : 'text-zinc-300 hover:text-zinc-50'
      }`}
    >
      {children}
    </button>
  )
}

export function StopCard({
  stop,
  route,
  actions,
  onClose,
}: {
  stop: RouteStopView
  route: RouteView
  actions: StopActions
  onClose: () => void
}) {
  const next = stop.seq === route.nextSeq
  const you = route.currentPosition
  const fromYou = you && !stop.here ? Math.hypot(stop.x - you.x, stop.y - you.y, stop.z - you.z) : null
  const canMakeNext = !stop.done && !next && route.nextSeq !== null && stop.seq > route.nextSeq

  // Focus moves into the card when it opens (a stop picked from the keyboard is announced and
  // its actions are a Tab away) and back to where it was when it closes.
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    const before = document.activeElement
    card.current?.focus({ preventScroll: true })
    return () => {
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-label={stop.name}
      className="absolute inset-x-3 bottom-3 z-40 flex max-h-[calc(100%-4.5rem)] flex-col rounded-2xl bg-zinc-950/90 shadow-2xl ring-1 shadow-black/60 ring-white/10 outline-none backdrop-blur-md ring-inset sm:left-auto sm:w-[26rem]"
    >
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="tabular-nums">{ru.route.stopOf(stop.seq, route.stops.length)}</span>
            <StopStatus stop={stop} next={next} />
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <h3 className={`truncate text-lg font-semibold text-zinc-50 ${stop.skipped ? 'line-through' : ''}`} title={stop.name}>
              {stop.name}
            </h3>
            <CopyButton text={stop.name} />
          </div>
        </div>
        <IconButton label={ru.route.map.close} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 text-sm text-zinc-400">
        <span>
          {ru.route.map.hop(formatLy(stop.hopLy))}
          {stop.jumps ? <span className="text-zinc-500"> · {ru.route.jumps(stop.jumps)}</span> : null}
        </span>
        {fromYou !== null && <span>{ru.route.fromYou(formatLy(fromYou))}</span>}
        <PopulatedBadge population={stop.population} />
      </p>

      <ul className="mx-3 mt-3 min-h-0 divide-y divide-zinc-800/60 overflow-y-auto rounded-xl bg-zinc-900/50 ring-1 ring-zinc-800/80">
        {stop.bodies.map((b) => (
          <BodyRow key={b.bodyId} body={b} compact />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <CreditRange min={stop.valueMin} max={stop.value} className="text-base font-semibold text-zinc-100" />
        <div className="flex flex-wrap items-center gap-1.5">
          {canMakeNext && route.nextSeq !== null && (
            <Action onClick={() => actions.makeNext(stop.seq, route.nextSeq ?? stop.seq)}>
              <ChevronsUp className="size-3.5" aria-hidden />
              {ru.route.makeNext}
            </Action>
          )}
          {!stop.done && (
            <Action onClick={() => actions.skip(stop.seq, !stop.skipped)}>
              {stop.skipped ? <Undo2 className="size-3.5" aria-hidden /> : <SkipForward className="size-3.5" aria-hidden />}
              {stop.skipped ? ru.route.unskip : ru.route.skip}
            </Action>
          )}
          <Action onClick={() => actions.remove(stop.seq)} danger>
            <X className="size-3.5" aria-hidden />
            {ru.route.remove}
          </Action>
          <a
            href={spanshUrl(stop.address)}
            target="_blank"
            rel="noreferrer"
            title={ru.route.spansh}
            aria-label={ru.route.spansh}
            className="focus-ring flex size-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  )
}

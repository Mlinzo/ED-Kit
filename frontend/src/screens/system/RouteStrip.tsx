// The route, seen from the System tab: this system's stop (what is left here, its bodies marked
// below), or once it is done, skipped or not on the route at all, where to go next. One line, so
// the map under it keeps its height; the secondary parts give way on narrower screens.
import { ArrowRight, CircleCheck, Navigation, Route, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CreditRange } from '../../components/Credits'
import { t } from '../../i18n'
import { formatLy } from '../../lib/format'
import { routeStop, routeStripShown, stopLeft } from '../route/helpers'

function Strip({ tone, icon: Icon, children, onShowRoute }: { tone: 'accent' | 'done'; icon: LucideIcon; children: ReactNode; onShowRoute: () => void }) {
  const ring = tone === 'done' ? 'bg-emerald-500/[0.07] ring-emerald-500/25' : 'bg-sky-500/[0.07] ring-sky-500/25'
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-2.5 ring-1 ring-inset sm:flex-nowrap ${ring}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-zinc-300 sm:flex-nowrap sm:overflow-hidden sm:whitespace-nowrap">
        <Icon className={`size-4 shrink-0 ${tone === 'done' ? 'text-emerald-400' : 'text-accent'}`} aria-hidden />
        {children}
      </div>
      <button
        type="button"
        onClick={onShowRoute}
        className="focus-ring ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50"
      >
        {t.system.route.open}
        <ArrowRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}

export function RouteStrip({
  route,
  address,
  marked,
  missing,
  onShowRoute,
}: {
  route: RouteView
  /** The current system. */
  address: string | null
  /** Its bodies the route counts on that are in the list (and marked there). */
  marked: number
  /** Those not in the list yet (before FSS). */
  missing: number
  onShowRoute: () => void
}) {
  if (!routeStripShown(route, address)) return null
  const total = route.stops.length
  const stop = routeStop(route, address)
  const next = route.stops.find((s) => s.seq === route.nextSeq) ?? null

  // A stop still to do: what is left here.
  if (stop && !stop.done && !stop.skipped) {
    const left = stopLeft(stop)
    return (
      <Strip tone="accent" icon={Route} onShowRoute={onShowRoute}>
        <span className="shrink-0 font-medium text-zinc-50">{t.system.route.stop(stop.seq, total)}</span>
        {left.max > 0 && (
          <span className="shrink-0">
            {t.system.route.left}: <CreditRange min={left.min} max={left.max} className="font-semibold text-emerald-300" />
          </span>
        )}
        {marked > 0 && <span className="min-w-0 truncate text-zinc-400">{t.system.route.targets(marked)}</span>}
        {missing > 0 && <span className="min-w-0 truncate text-zinc-500">{t.system.route.missing(missing)}</span>}
      </Strip>
    )
  }

  // Done here, skipped, or elsewhere: the way on.
  const lead = stop ? (
    <span className="shrink-0 font-medium text-zinc-50">
      {t.system.route.stop(stop.seq, total)} — {stop.done ? t.system.route.done : t.system.route.skipped}
    </span>
  ) : null
  if (!next) {
    if (!stop) return null
    return (
      <Strip tone="done" icon={CircleCheck} onShowRoute={onShowRoute}>
        {lead}
        <span className="shrink-0">{t.system.route.finished}</span>
      </Strip>
    )
  }
  const where = route.distanceToNextLy !== null ? t.route.fromYou(formatLy(route.distanceToNextLy)) : null
  const more = [route.jumpsToNext ? t.route.jumps(route.jumpsToNext) : null, t.route.stopOf(next.seq, total)].filter(Boolean)
  return (
    <Strip tone={stop?.done ? 'done' : 'accent'} icon={stop?.done ? CircleCheck : Navigation} onShowRoute={onShowRoute}>
      {lead}
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="shrink-0">{t.system.route.next}:</span>
        <span className="truncate font-semibold text-zinc-50 proportional-nums" title={next.name}>
          {next.name}
        </span>
        <CopyButton text={next.name} />
      </span>
      {where && <span className="shrink-0 text-zinc-400">{where}</span>}
      <span className="hidden shrink-0 text-zinc-500 xl:inline">{more.join(' · ')}</span>
    </Strip>
  )
}

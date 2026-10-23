// Route: systems worth a visit for mapping payouts and biology (Spansh data, our own stop
// order), or just the way somewhere (a Spansh neutron route, its waypoints as the stops).
// Progress comes from the journal: mapped bodies and analysed species (or arrivals) tick off,
// the next target moves on by itself.
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  ExternalLink,
  Flag,
  Fuel,
  List,
  LoaderCircle,
  MapPin,
  Orbit,
  Pencil,
  Route,
  SkipForward,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useView } from '../../api/hooks'
import type { RouteRequest, RouteStopView, RouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CreditRange, Credits } from '../../components/Credits'
import { Segmented } from '../../components/Segmented'
import { EmptyState, Label, ViewFallback } from '../../components/States'
import { t } from '../../i18n'
import { exactCredits, formatCredits, formatLs, formatLy, formatNumber, formatRelative, formatTons } from '../../lib/format'
import { readStored, writeStored } from '../../lib/storage'
import { eventFull } from '../../lib/when'
import { BodyChips } from './kinds'
import { RouteMap } from './map'
import { approxLy, carto, DEFAULT_ROUTE, inSpansh, routeLeft, spanshUrl, stopLeft, type StopActions } from './helpers'
import { NeutronPlan } from './NeutronPlan'
import { BodyRow, CodexCount, FirstsChance, IconButton, PopulatedBadge, StopStatus } from './parts'
import { PlottedRoute } from './PlottedRoute'
import { RouteForm } from './RouteForm'
import { StopCard } from './StopCard'
import { useRouteActions } from './useRouteActions'

const VIEW_KEY = 'edk.routeView'
type ViewMode = 'map' | 'list'
const VIEW_OPTIONS = [
  { id: 'map' as const, label: t.map.map, icon: Orbit },
  { id: 'list' as const, label: t.map.list, icon: List },
]

function Notice({ tone, children }: { tone: 'warn' | 'error' | 'info'; children: ReactNode }) {
  const style = {
    warn: 'bg-amber-500/10 text-amber-200 ring-amber-500/25',
    error: 'bg-rose-500/10 text-rose-200 ring-rose-500/25',
    info: 'bg-sky-500/10 text-sky-200 ring-sky-500/25',
  }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${style}`}>
      {tone === 'info' ? (
        <LoaderCircle className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** A transit stop: supercharge here (a neutron star), or the end of the way. */
function TransitNote({ stop, last }: { stop: RouteStopView; last: boolean }) {
  if (stop.neutron)
    return (
      <p className="mt-4 flex items-start gap-2 rounded-xl bg-sky-500/[0.07] px-4 py-2.5 text-sm text-sky-100 ring-1 ring-sky-500/20 ring-inset">
        <Zap className="mt-0.5 size-4 shrink-0 text-sky-300" aria-hidden />
        {t.route.transit.neutron}
      </p>
    )
  if (last)
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
        <Flag className="size-4 shrink-0 text-emerald-400" aria-hidden />
        {t.route.transit.destination}
      </p>
    )
  return null
}

function NextTarget({
  route,
  onSkip,
  onPlanNeutron,
  onClearNeutron,
}: {
  route: RouteView
  onSkip: (seq: number) => void
  onPlanNeutron: () => void
  onClearNeutron: () => void
}) {
  const stop = route.stops.find((s) => s.seq === route.nextSeq)
  const firsts = route.params?.goal === 'firsts'
  if (route.stops.length === 0) {
    return (
      <section className="rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-800">
        <EmptyState icon={<Route className="size-10" />} title={t.route.empty} hint={firsts ? t.route.firsts.emptyHint : t.route.emptyHint} />
      </section>
    )
  }
  if (!stop) {
    return (
      <section className="rounded-2xl bg-emerald-500/[0.07] ring-1 ring-emerald-500/25">
        <EmptyState icon={<Flag className="size-10 text-emerald-400" />} title={t.route.finished} hint={t.route.finishedHint} />
      </section>
    )
  }
  const left = stopLeft(stop)
  const after = route.stops.find((s) => s.seq > stop.seq && !s.done && !s.skipped && !s.passed)
  const bio = stop.bodies.some((b) => b.bioSignals > 0)
  const codex = route.params?.goal === 'codex'
  const transit = route.params?.goal === 'transit'
  return (
    <section aria-labelledby="route-next" className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-sky-500/25 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Label as="h2" id="route-next">
          {t.route.next} · <span className="normal-case">{t.route.stopOf(stop.seq, route.stops.length)}</span>
        </Label>
        {inSpansh(stop) && (
          <a
            href={spanshUrl(stop.address)}
            target="_blank"
            rel="noreferrer"
            className="focus-ring inline-flex items-center gap-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300"
          >
            {t.route.spansh}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
      {/* Where to go and what it is worth, side by side: the two things to see at a glance. */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h3 className="min-w-0 text-2xl font-semibold tracking-tight break-words text-zinc-50 proportional-nums sm:text-3xl">{stop.name}</h3>
            <CopyButton text={stop.name} label />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
            {stop.here ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
                <MapPin className="size-4" aria-hidden />
                {t.route.youAreHere}
              </span>
            ) : route.distanceToNextLy !== null ? (
              <span>
                {t.route.fromYou(approxLy(route.distanceToNextLy, stop.spreadLy > 0))}
                {/* Transit: Spansh's count (with supercharges) is shown big instead of this estimate. */}
                {route.jumpsToNext && !transit ? <span className="text-zinc-500"> · {t.route.jumps(route.jumpsToNext)}</span> : null}
              </span>
            ) : null}
            {!transit && <PopulatedBadge population={stop.population} />}
          </p>
          {/* Here and not done yet: the system after it, to copy into the galaxy map meanwhile. */}
          {stop.here && after && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
              <span>{t.route.then}:</span>
              <span className="min-w-0 font-medium break-words text-zinc-200 proportional-nums">{after.name}</span>
              <CopyButton text={after.name} />
              <span className="text-zinc-500">
                {approxLy(Math.hypot(after.x - stop.x, after.y - stop.y, after.z - stop.z), after.spreadLy > 0 || stop.spreadLy > 0)}
              </span>
            </p>
          )}
          {/* A missing number in its boxel: the name is exact, the place only roughly known. */}
          {firsts && stop.spreadLy > 0 && !stop.here && (
            <p className="mt-1.5 max-w-prose text-xs text-zinc-500" title={t.route.firsts.searchHint}>
              {t.route.firsts.approx(formatLy(stop.spreadLy))}
            </p>
          )}
          {route.oneJumpFuelT !== null && !stop.here && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-200/80">
              <Fuel className="mt-px size-3.5 shrink-0 text-amber-300" aria-hidden />
              {/* Rounded down: a ton more and the jump falls short. */}
              {t.route.oneJump(`${formatTons(route.oneJumpFuelT >= 10 ? Math.floor(route.oneJumpFuelT) : route.oneJumpFuelT)} ${t.units.t}`)}
            </p>
          )}
        </div>
        {transit ? (
          stop.jumps ? (
            <div className="shrink-0 sm:text-right">
              <p className="text-2xl font-semibold tracking-tight text-zinc-50 tabular-nums sm:text-3xl">{stop.jumps}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{t.route.transit.jumpsHere(stop.jumps)}</p>
            </div>
          ) : null
        ) : firsts ? (
          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-medium text-zinc-500">{t.route.firsts.likely}</p>
            <FirstsChance stop={stop} className="mt-0.5 block text-2xl font-semibold tracking-tight sm:text-3xl" />
          </div>
        ) : codex ? (
          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-medium text-zinc-500">{t.route.codex.here}</p>
            <CodexCount value={stop.codexNew} className="mt-0.5 text-2xl font-semibold tracking-tight text-violet-200 sm:text-3xl" />
            {left.max > 0 && (
              <p className="mt-0.5 text-xs text-zinc-500">
                {t.route.codex.creditsToo} <CreditRange min={left.min} max={left.max} className="text-zinc-400" />
              </p>
            )}
          </div>
        ) : (
          left.max > 0 && (
            <div className="shrink-0 sm:text-right">
              <p className="text-xs font-medium text-zinc-500">{t.route.stopLeft}</p>
              <CreditRange
                min={left.min}
                max={left.max}
                className="mt-0.5 block text-2xl font-semibold tracking-tight text-emerald-300 tabular-nums sm:text-3xl"
              />
            </div>
          )
        )}
      </div>

      {transit ? (
        <TransitNote stop={stop} last={stop.seq === route.stops.length} />
      ) : firsts ? null : (
        <>
          <ul className="mt-5 divide-y divide-zinc-800/60 rounded-xl bg-zinc-950/40 ring-1 ring-zinc-800/80">
            {stop.bodies.map((b) => (
              <BodyRow key={b.bodyId} body={b} />
            ))}
          </ul>
          {bio && <p className="mt-2 text-xs text-zinc-600">{t.route.bioHint}</p>}
          {!stop.here && <NeutronPlan route={route} onPlan={onPlanNeutron} onClear={onClearNeutron} />}
        </>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => onSkip(stop.seq)}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-50"
        >
          <SkipForward className="size-4" aria-hidden />
          {t.route.skip}
        </button>
      </div>
    </section>
  )
}

function Progress({ route }: { route: RouteView }) {
  const total = route.stops.length
  const pct = (n: number) => (total ? (n / total) * 100 : 0)
  const left = routeLeft(route)
  const transit = route.params?.goal === 'transit'
  const firsts = route.params?.goal === 'firsts'
  const jumpsLeft = route.stops.filter((s) => !s.done && !s.skipped && !s.passed).reduce((n, s) => n + (s.jumps ?? 0), 0)
  // The range now (fuel and cargo aboard) first; the maximum and the full-tank one when they differ.
  const { jumpRangeNowLy: now, jumpRangeLy: max, jumpRangeFullLy: full } = route
  const differs = (ly: number) => now !== null && Math.abs(ly - now) >= 0.05
  return (
    <section aria-labelledby="route-progress" className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-zinc-800 sm:p-6">
      <Label as="h2" id="route-progress">
        {t.route.progress}
      </Label>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{t.route.stopsDone(route.doneCount, total)}</p>
      <div
        className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label={t.route.progress}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={route.doneCount}
      >
        <div className="h-full bg-emerald-400" style={{ width: `${pct(route.doneCount)}%` }} />
        <div className="h-full bg-zinc-600" style={{ width: `${pct(route.skippedCount)}%` }} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        {transit && (
          <div>
            <dt className="text-zinc-500">{t.route.transit.jumpsLeft}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-zinc-100 tabular-nums">{jumpsLeft}</dd>
          </div>
        )}
        {firsts && (
          <div>
            <dt className="text-zinc-500">{t.route.firsts.found}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-amber-300 tabular-nums">{route.firstsFound}</dd>
          </div>
        )}
        {firsts && (
          <div>
            <dt className="text-zinc-500" title={t.route.firsts.leftHint}>
              {t.route.firsts.left}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-emerald-300 tabular-nums">
              {t.route.firsts.expected(formatNumber(route.firstsLeft, route.firstsLeft >= 10 ? 0 : 1))}
            </dd>
          </div>
        )}
        {!transit && !firsts && (
        <div>
          <dt className="text-zinc-500">{t.route.collected}</dt>
          <dd className="mt-0.5">
            <Credits value={route.collectedValue} className="text-lg font-semibold text-emerald-300" />{' '}
            <span className="text-zinc-500" title={exactCredits(route.totalValue)}>
              {t.route.ofTotal(formatCredits(route.totalValue))}
            </span>
          </dd>
        </div>
        )}
        {!transit && !firsts && (
        <div>
          <dt className="text-zinc-500" title={t.route.routeLeftHint}>
            {t.route.routeLeft}
          </dt>
          <dd className="mt-0.5">
            <CreditRange min={left.min} max={left.max} className="text-lg font-semibold text-zinc-100" />
          </dd>
          {route.skippedCount > 0 && <dd className="text-xs text-zinc-500">{t.route.withoutSkipped}</dd>}
        </div>
        )}
        {route.params?.goal === 'codex' && (
          <div className="col-span-2">
            <dt className="text-zinc-500" title={t.route.codex.leftHint}>
              {t.route.codex.left}
            </dt>
            <dd className="mt-0.5">
              {route.codexLeft > 0 ? (
                <CodexCount value={route.codexLeft} className="text-lg font-semibold text-violet-200" />
              ) : (
                <span className="text-zinc-500">{t.route.codex.none}</span>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-zinc-500">{t.route.remaining}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-zinc-100">{formatLy(route.remainingLy)}</dd>
          <dd className="text-xs text-zinc-500">
            {t.route.total}: <span className="whitespace-nowrap">{formatLy(route.totalLy)}</span>
            {route.directLy !== null && (
              <span className="block whitespace-nowrap">{t.route.direct(formatLy(route.directLy))}</span>
            )}
          </dd>
        </div>
        {now !== null && (
          <div>
            <dt className="text-zinc-500" title={t.route.jumpRangeHint}>
              {t.route.jumpRange}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-zinc-100">{formatLy(now)}</dd>
            <dd className="text-xs text-zinc-500">
              {max !== null && differs(max) && <span className="block whitespace-nowrap">{t.route.jumpRangeMax(formatLy(max))}</span>}
              {full !== null && differs(full) && (
                <span className="block whitespace-nowrap">{t.route.jumpRangeFull(formatLy(full))}</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <span title={route.dataAt ? (eventFull(route.dataAt) ?? undefined) : undefined}>
          {route.dataAt ? t.route.dataFrom(formatRelative(route.dataAt)) : null}
        </span>
      </div>
    </section>
  )
}

const GRID =
  'grid-cols-[2.5rem_minmax(0,1fr)_6rem] md:grid-cols-[2.5rem_6.5rem_minmax(0,1fr)_6rem_13rem] xl:grid-cols-[2.5rem_6.5rem_minmax(0,22rem)_minmax(0,1fr)_6rem_13rem]'

function StopRow({
  stop,
  next,
  nextSeq,
  last,
  actions,
  codex = false,
  transit = false,
  firsts = false,
}: {
  stop: RouteStopView
  next: boolean
  nextSeq: number | null
  last: boolean
  actions: StopActions
  /** A codex route: the new entries expected are the stop's value. */
  codex?: boolean
  /** A transit route: jumps instead of a value, neutron stars marked. */
  transit?: boolean
  /** A firsts route: the chance nobody has been there instead of a value. */
  firsts?: boolean
}) {
  // Gone past it unfinished: skipped, though not by the button (so no "restore": fly back instead).
  const skipped = stop.skipped || stop.passed
  const dim = stop.done || skipped
  const label = (action: string) => `${action}: ${stop.name}`
  return (
    <li
      className={`group grid ${GRID} items-center gap-x-3 px-4 py-2.5 text-sm ${next ? 'bg-sky-500/[0.07]' : ''} ${dim ? 'text-zinc-500' : 'text-zinc-300'}`}
    >
      <span className="text-zinc-500 tabular-nums">{stop.seq}</span>
      <span className="hidden tabular-nums md:block">
        {approxLy(stop.hopLy, stop.spreadLy > 0)}
        {stop.jumps ? <span className="block text-xs text-zinc-600">{t.route.jumps(stop.jumps)}</span> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate font-medium proportional-nums ${dim ? 'text-zinc-500' : 'text-zinc-100'} ${skipped ? 'line-through' : ''}`} title={stop.name}>
          {stop.name}
        </span>
        <CopyButton text={stop.name} />
        {transit && stop.neutron && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-sky-300" title={t.route.transit.neutron}>
            <Zap className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t.route.transit.neutronShort}</span>
          </span>
        )}
        {!transit && <PopulatedBadge population={stop.population} compact />}
      </span>
      <span className="hidden min-w-0 flex-wrap gap-1.5 xl:flex">
        {stop.bodies.map((b) => (
          <span
            key={b.bodyId}
            className="inline-flex items-center gap-1"
            title={[
              b.name,
              formatLs(b.distanceLs),
              carto(b) ? exactCredits(b.mappingValue) : null,
              b.bioSignals > 0 ? `${t.route.bioSignals(b.bioSignals)}: ${exactCredits(b.bioMin)} – ${exactCredits(b.bioMax)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <BodyChips body={b} dim={b.done || skipped} />
            <span className="text-xs text-zinc-500">
              {b.shortName}
              {b.bioSignals > 0 && <span className="text-zinc-600"> · {b.bioDone}/{b.bioSignals}</span>}
            </span>
          </span>
        ))}
      </span>
      <span className="text-right tabular-nums">
        {transit ? (
          <span className={dim ? '' : 'text-zinc-300'}>{stop.jumps ? t.route.transit.jumpsTotal(stop.jumps) : ''}</span>
        ) : firsts ? (
          <FirstsChance stop={stop} className={stop.first !== null ? 'text-xs' : dim ? 'text-zinc-500' : 'font-medium'} />
        ) : codex ? (
          <span title={`${exactCredits(stop.valueMin)} – ${exactCredits(stop.value)}`}>
            <CodexCount value={stop.codexNew} short className={dim ? '' : 'font-medium text-violet-200'} />
          </span>
        ) : (
          <CreditRange min={stop.valueMin} max={stop.value} className={dim ? '' : 'font-medium text-zinc-100'} />
        )}
      </span>
      <span className="hidden items-center justify-end gap-1 md:flex">
        <StopStatus stop={stop} next={next} />
        {/* Editing: shown on hover or keyboard focus, so the list stays quiet. */}
        <span className="ml-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {!stop.done && !next && nextSeq !== null && stop.seq > nextSeq && (
            <IconButton label={label(t.route.makeNext)} onClick={() => actions.makeNext(stop.seq, nextSeq)}>
              <ChevronsUp className="size-4" aria-hidden />
            </IconButton>
          )}
          {stop.seq > 1 && (
            <IconButton label={label(t.route.moveUp)} onClick={() => actions.move(stop.seq, stop.seq - 1)}>
              <ArrowUp className="size-4" aria-hidden />
            </IconButton>
          )}
          {!last && (
            <IconButton label={label(t.route.moveDown)} onClick={() => actions.move(stop.seq, stop.seq + 1)}>
              <ArrowDown className="size-4" aria-hidden />
            </IconButton>
          )}
          {!stop.done && !stop.passed && (
            <IconButton label={label(stop.skipped ? t.route.unskip : t.route.skip)} onClick={() => actions.skip(stop.seq, !stop.skipped)}>
              {stop.skipped ? <Undo2 className="size-4" aria-hidden /> : <SkipForward className="size-4" aria-hidden />}
            </IconButton>
          )}
          <IconButton label={label(t.route.remove)} onClick={() => actions.remove(stop.seq)} danger>
            <X className="size-4" aria-hidden />
          </IconButton>
        </span>
      </span>
    </li>
  )
}

function StopList({ route, actions }: { route: RouteView; actions: StopActions }) {
  const th = 'text-[11px] font-medium tracking-wide text-zinc-500 uppercase'
  const firsts = route.params?.goal === 'firsts'
  return (
    <section aria-label={t.route.title} className="rounded-2xl bg-zinc-900/30 ring-1 ring-zinc-800">
      <div aria-hidden className={`sticky top-14 z-10 grid ${GRID} gap-x-3 rounded-t-2xl border-b border-zinc-800 bg-zinc-950/90 px-4 py-2.5 backdrop-blur`}>
        <span className={th}>{t.route.colStop}</span>
        <span className={`${th} hidden md:block`}>{t.route.colHop}</span>
        <span className={th}>{t.route.colSystem}</span>
        <span className={`${th} hidden xl:block`}>{firsts ? '' : t.route.colBodies}</span>
        <span className={`${th} text-right`}>{firsts ? t.plotted.col.chance : t.route.colValue}</span>
        <span className={`${th} hidden text-right md:block`}>{t.route.colStatus}</span>
      </div>
      <ol className="divide-y divide-zinc-800/50">
        {route.stops.map((s, i) => (
          <StopRow
            key={s.address}
            stop={s}
            next={s.seq === route.nextSeq}
            nextSeq={route.nextSeq}
            last={i === route.stops.length - 1}
            actions={actions}
            codex={route.params?.goal === 'codex'}
            transit={route.params?.goal === 'transit'}
            firsts={firsts}
          />
        ))}
      </ol>
    </section>
  )
}

function routeSummary(route: RouteView): string | null {
  const p = route.params
  const source = route.source?.name ?? p?.source ?? ''
  if (!p) return null
  if (p.goal === 'transit') {
    const jumps = route.stops.reduce((n, s) => n + (s.jumps ?? 0), 0)
    return t.route.summary.transit(source, route.destination?.name ?? p.destination ?? '?', t.route.transit.jumpsTotal(jumps))
  }
  const where =
    p.mode === 'line'
      ? t.route.summary.line(source, route.destination?.name ?? p.destination ?? '?', p.deviationLy)
      : t.route.summary.riches(source, p.radiusLy, route.stops.length)
  return where
}

export function RouteScreen({
  prefill = null,
  onPrefillUsed,
}: {
  /** Open the form to just get to this system (from "Where to sell"). */
  prefill?: string | null
  onPrefillUsed?: () => void
}) {
  const { data, error, refetch } = useView('route')
  const plotted = useView('navroute').data
  const actions = useRouteActions()
  const [formOpen, setFormOpen] = useState(false)
  // The destination handed over by another tab: the form opens on it (once: the parent forgets it).
  const [draft, setDraft] = useState<string | null>(null)
  if (prefill !== null && prefill !== draft) {
    setDraft(prefill)
    setFormOpen(true)
  }
  useEffect(() => {
    if (prefill !== null) onPrefillUsed?.()
  }, [prefill, onPrefillUsed])
  const [view, setView] = useState<ViewMode>(() => readStored(VIEW_KEY, ['map', 'list'], 'map'))
  // The stop picked on the map, in the route it was picked in.
  const [selected, setSelected] = useState<{ address: string; route: string | null } | null>(null)
  const selectedStop =
    (selected !== null && data && selected.route === data.createdAt && data.stops.find((s) => s.address === selected.address)) || null
  // Removed from the route, or a new route: the selection is gone for good (not just hidden until
  // the system comes back in a later route).
  if (selected !== null && data && !selectedStop) setSelected(null)
  const routeId = data?.createdAt ?? null
  const select = useCallback(
    (address: string | null) => setSelected(address === null ? null : { address, route: routeId }),
    [routeId],
  )

  useEffect(() => {
    if (!selectedStop) return
    const onKey = (e: KeyboardEvent) => {
      // A dialog over the page (settings) takes its own Escape.
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedStop])

  if (!data) return <ViewFallback error={error} onRetry={refetch} />
  const hasRoute = data.params !== null
  const showForm = !hasRoute || formOpen
  const failure = data.error ? (t.route.errors[data.error] ?? t.route.errors.internal)(data.errorDetail) : null

  const plan = async (req: Parameters<typeof actions.plan>[0]) => {
    if (await actions.plan(req)) {
      setFormOpen(false)
      setDraft(null)
    }
  }
  const initial: RouteRequest | null = draft
    ? { ...(data.params ?? DEFAULT_ROUTE), goal: 'transit', source: '', destination: draft }
    : data.params
  const changeView = (v: ViewMode) => {
    setView(v)
    writeStored(VIEW_KEY, v)
  }
  const stopActions: StopActions = {
    skip: (seq, skipped) => void actions.skip(seq, skipped),
    move: (seq, position) => void actions.move(seq, position),
    makeNext: (seq, position) => void actions.makeNext(seq, position),
    remove: (seq) => void actions.remove(seq),
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{t.route.title}</h1>
          <p className="mt-1 text-sm text-zinc-500 proportional-nums">{hasRoute ? routeSummary(data) : t.route.intro}</p>
        </div>
        {hasRoute && !formOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              disabled={!data.online}
              title={t.route.editHint}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-800 px-3 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
            >
              <Pencil className="size-4" aria-hidden />
              {t.route.editRoute}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t.route.clearConfirm)) void actions.clear()
              }}
              title={t.route.clear}
              aria-label={t.route.clear}
              className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-zinc-500 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-rose-300"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </section>

      {plotted && <PlottedRoute view={plotted} />}

      {!data.online && <Notice tone="warn">{t.route.offline}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {actions.error && (
        <Notice tone="error">
          {t.route.sendError}: {actions.error}
        </Notice>
      )}
      {data.building && hasRoute && !showForm && <Notice tone="info">{t.route.building}</Notice>}

      {showForm && (
        <RouteForm
          key={draft ?? 'route'}
          initial={initial}
          currentSystem={data.currentSystem}
          currentPosition={data.currentPosition}
          replaces={hasRoute}
          building={data.building}
          disabled={!data.online}
          onSubmit={(req) => void plan(req)}
          onCancel={
            hasRoute
              ? () => {
                  setFormOpen(false)
                  setDraft(null)
                }
              : undefined
          }
        />
      )}

      {hasRoute && !formOpen && (
        <>
          {/* Around a point the route always takes the nearest N; cut short is news only for a corridor. */}
          {data.truncated && data.params?.mode === 'line' && <Notice tone="warn">{t.route.truncated}</Notice>}
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
            <NextTarget
              route={data}
              onSkip={(seq) => void actions.skip(seq, true)}
              onPlanNeutron={() => void actions.planNeutron()}
              onClearNeutron={() => void actions.clearNeutron()}
            />
            {data.stops.length > 0 && <Progress route={data} />}
          </div>
          {data.stops.length > 0 && (
            <section aria-labelledby="route-stops">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="route-stops" className="text-sm font-medium text-zinc-400">
                  {t.route.stops} <span className="text-zinc-600">{data.stops.length}</span>
                </h2>
                <Segmented label={t.map.viewLabel} value={view} options={VIEW_OPTIONS} onChange={changeView} />
              </div>
              {view === 'map' ? (
                <RouteMap
                  route={data}
                  selected={selectedStop?.address ?? null}
                  onSelect={select}
                  onShowList={() => changeView('list')}
                  className="h-[clamp(26rem,72dvh,56rem)]"
                  overlay={
                    selectedStop && (
                      <StopCard stop={selectedStop} route={data} actions={stopActions} onClose={() => setSelected(null)} />
                    )
                  }
                />
              ) : (
                <StopList route={data} actions={stopActions} />
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

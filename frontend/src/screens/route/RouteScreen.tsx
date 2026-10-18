// Route: systems worth a visit for mapping payouts and biology (Spansh data, our own stop
// order). Progress comes from the journal: mapped bodies and analysed species tick off, the
// next target moves on by itself.
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  ExternalLink,
  Flag,
  List,
  LoaderCircle,
  MapPin,
  Orbit,
  Pencil,
  RefreshCw,
  Route,
  SkipForward,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useView } from '../../api/hooks'
import type { RouteStopView, RouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CreditRange, Credits } from '../../components/Credits'
import { Segmented } from '../../components/Segmented'
import { EmptyState, Label, ViewFallback } from '../../components/States'
import { t } from '../../i18n'
import { exactCredits, formatCredits, formatLs, formatLy, formatRelative } from '../../lib/format'
import { readStored, writeStored } from '../../lib/storage'
import { eventFull } from '../../lib/when'
import { BodyChips } from './kinds'
import { RouteMap } from './map'
import { carto, routeLeft, spanshUrl, stopLeft, type StopActions } from './helpers'
import { NeutronPlan } from './NeutronPlan'
import { BodyRow, IconButton, PopulatedBadge, StopStatus } from './parts'
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
  if (route.stops.length === 0) {
    return (
      <section className="rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-800">
        <EmptyState icon={<Route className="size-10" />} title={t.route.empty} hint={t.route.emptyHint} />
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
  const bio = stop.bodies.some((b) => b.bioSignals > 0)
  return (
    <section aria-labelledby="route-next" className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-sky-500/25 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Label as="h2" id="route-next">
          {t.route.next} · <span className="normal-case">{t.route.stopOf(stop.seq, route.stops.length)}</span>
        </Label>
        <a
          href={spanshUrl(stop.address)}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex items-center gap-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300"
        >
          {t.route.spansh}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
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
                {t.route.fromYou(formatLy(route.distanceToNextLy))}
                {route.jumpsToNext ? <span className="text-zinc-500"> · {t.route.jumps(route.jumpsToNext)}</span> : null}
              </span>
            ) : null}
            <PopulatedBadge population={stop.population} />
          </p>
        </div>
        {left.max > 0 && (
          <div className="shrink-0 sm:text-right">
            <p className="text-xs font-medium text-zinc-500">{t.route.stopLeft}</p>
            <CreditRange
              min={left.min}
              max={left.max}
              className="mt-0.5 block text-2xl font-semibold tracking-tight text-emerald-300 tabular-nums sm:text-3xl"
            />
          </div>
        )}
      </div>

      <ul className="mt-5 divide-y divide-zinc-800/60 rounded-xl bg-zinc-950/40 ring-1 ring-zinc-800/80">
        {stop.bodies.map((b) => (
          <BodyRow key={b.bodyId} body={b} />
        ))}
      </ul>
      {bio && <p className="mt-2 text-xs text-zinc-600">{t.route.bioHint}</p>}

      {!stop.here && <NeutronPlan route={route} onPlan={onPlanNeutron} onClear={onClearNeutron} />}

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

function Progress({ route, onRefresh, refreshDisabled }: { route: RouteView; onRefresh: () => void; refreshDisabled: boolean }) {
  const total = route.stops.length
  const pct = (n: number) => (total ? (n / total) * 100 : 0)
  const left = routeLeft(route)
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
        <div>
          <dt className="text-zinc-500">{t.route.collected}</dt>
          <dd className="mt-0.5">
            <Credits value={route.collectedValue} className="text-lg font-semibold text-emerald-300" />{' '}
            <span className="text-zinc-500" title={exactCredits(route.totalValue)}>
              {t.route.ofTotal(formatCredits(route.totalValue))}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500" title={t.route.routeLeftHint}>
            {t.route.routeLeft}
          </dt>
          <dd className="mt-0.5">
            <CreditRange min={left.min} max={left.max} className="text-lg font-semibold text-zinc-100" />
          </dd>
          {route.skippedCount > 0 && <dd className="text-xs text-zinc-500">{t.route.withoutSkipped}</dd>}
        </div>
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
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <span title={route.dataAt ? (eventFull(route.dataAt) ?? undefined) : undefined}>
          {route.dataAt ? t.route.dataFrom(formatRelative(route.dataAt)) : null}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          title={t.route.refreshHint}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-zinc-400 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t.route.refresh}
        </button>
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
}: {
  stop: RouteStopView
  next: boolean
  nextSeq: number | null
  last: boolean
  actions: StopActions
}) {
  const dim = stop.done || stop.skipped
  const label = (action: string) => `${action}: ${stop.name}`
  return (
    <li
      className={`group grid ${GRID} items-center gap-x-3 px-4 py-2.5 text-sm ${next ? 'bg-sky-500/[0.07]' : ''} ${dim ? 'text-zinc-500' : 'text-zinc-300'}`}
    >
      <span className="text-zinc-500 tabular-nums">{stop.seq}</span>
      <span className="hidden tabular-nums md:block">
        {formatLy(stop.hopLy)}
        {stop.jumps ? <span className="block text-xs text-zinc-600">{t.route.jumps(stop.jumps)}</span> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate font-medium proportional-nums ${dim ? 'text-zinc-500' : 'text-zinc-100'} ${stop.skipped ? 'line-through' : ''}`} title={stop.name}>
          {stop.name}
        </span>
        <CopyButton text={stop.name} />
        <PopulatedBadge population={stop.population} compact />
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
            <BodyChips body={b} dim={b.done || stop.skipped} />
            <span className="text-xs text-zinc-500">
              {b.shortName}
              {b.bioSignals > 0 && <span className="text-zinc-600"> · {b.bioDone}/{b.bioSignals}</span>}
            </span>
          </span>
        ))}
      </span>
      <span className="text-right tabular-nums">
        <CreditRange min={stop.valueMin} max={stop.value} className={dim ? '' : 'font-medium text-zinc-100'} />
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
          {!stop.done && (
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
  return (
    <section aria-label={t.route.title} className="rounded-2xl bg-zinc-900/30 ring-1 ring-zinc-800">
      <div aria-hidden className={`sticky top-14 z-10 grid ${GRID} gap-x-3 rounded-t-2xl border-b border-zinc-800 bg-zinc-950/90 px-4 py-2.5 backdrop-blur`}>
        <span className={th}>{t.route.colStop}</span>
        <span className={`${th} hidden md:block`}>{t.route.colHop}</span>
        <span className={th}>{t.route.colSystem}</span>
        <span className={`${th} hidden xl:block`}>{t.route.colBodies}</span>
        <span className={`${th} text-right`}>{t.route.colValue}</span>
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
  const where =
    p.mode === 'line'
      ? t.route.summary.line(source, route.destination?.name ?? p.destination ?? '?', p.deviationLy)
      : t.route.summary.riches(source, p.radiusLy, route.stops.length)
  return where
}

export function RouteScreen() {
  const { data, error, refetch } = useView('route')
  const plotted = useView('navroute').data
  const actions = useRouteActions()
  const [formOpen, setFormOpen] = useState(false)
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
    if (await actions.plan(req)) setFormOpen(false)
  }
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
          initial={data.params}
          currentSystem={data.currentSystem}
          building={data.building}
          disabled={!data.online}
          onSubmit={(req) => void plan(req)}
          onCancel={hasRoute ? () => setFormOpen(false) : undefined}
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
            {data.stops.length > 0 && (
              <Progress
                route={data}
                refreshDisabled={data.building || !data.online}
                onRefresh={() => data.params && void actions.plan({ ...data.params, refresh: true })}
              />
            )}
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

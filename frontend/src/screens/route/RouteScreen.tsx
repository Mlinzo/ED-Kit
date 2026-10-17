// Route: systems worth a visit for mapping payouts and biology (Spansh data, our own stop
// order). Progress comes from the journal: mapped bodies and analysed species tick off, the
// next target moves on by itself.
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Flag,
  LoaderCircle,
  MapPin,
  Pencil,
  RefreshCw,
  Route,
  SkipForward,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useView } from '../../api/hooks'
import type { RouteBodyView, RouteStopView, RouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CreditRange, Credits } from '../../components/Credits'
import { EmptyState, Label, ViewFallback } from '../../components/States'
import { ru } from '../../i18n/ru'
import { exactCredits, formatCredits, formatLs, formatLy, formatNumber, formatRelative } from '../../lib/format'
import { eventFull } from '../../lib/when'
import { BodyChips } from './kinds'
import { RouteForm } from './RouteForm'
import { useRouteActions } from './useRouteActions'

const spanshUrl = (address: string) => `https://spansh.co.uk/system/${address}`

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

const carto = (b: RouteBodyView) => b.kind !== 'bio'

/** What is still to earn on the body: the mapping payout unless mapped, the species not
 *  analysed yet (optimistic, or pessimistic with `low`). */
function remaining(b: RouteBodyView, low = false): number {
  const mapping = carto(b) && !b.mapped ? b.mappingValue : 0
  if (b.bioSignals <= b.bioDone) return mapping
  return mapping + Math.floor(((low ? b.bioMin : b.bioMax) * (b.bioSignals - b.bioDone)) / b.bioSignals)
}

function BodyValue({ body, className = '' }: { body: RouteBodyView; className?: string }) {
  const mapping = carto(body) ? body.mappingValue : 0
  if (body.bioSignals === 0) return <Credits value={mapping} className={className} />
  return <CreditRange min={mapping + body.bioMin} max={mapping + body.bioMax} className={className} />
}

function BodyStatus({ body }: { body: RouteBodyView }) {
  if (body.done)
    return (
      <CircleCheck className="size-4 shrink-0 text-emerald-400" aria-label={ru.route.status.done}>
        <title>{ru.route.status.done}</title>
      </CircleCheck>
    )
  if (body.bioSignals > 0) {
    // Biology in progress (and mapping, if it counts, shown by the colour).
    const label = ru.route.bioDone(body.bioDone, body.bioSignals)
    return (
      <span
        className={`shrink-0 text-xs tabular-nums ${body.bioDone > 0 || body.mapped ? 'text-sky-300' : 'text-zinc-500'}`}
        title={carto(body) && body.mapped ? `${ru.route.bodyMapped} · ${label}` : label}
      >
        {body.bioDone}/{body.bioSignals}
      </span>
    )
  }
  if (body.mapped)
    return (
      <CircleCheck className="size-4 shrink-0 text-emerald-400" aria-label={ru.route.bodyMapped}>
        <title>{ru.route.bodyMapped}</title>
      </CircleCheck>
    )
  if (body.scanned)
    return (
      <CircleDashed className="size-4 shrink-0 text-sky-400" aria-label={ru.route.bodyScanned}>
        <title>{ru.route.bodyScanned}</title>
      </CircleDashed>
    )
  return <span className="size-4 shrink-0" aria-hidden />
}

function PopulatedBadge({ population, compact = false }: { population: number | null; compact?: boolean }) {
  if (!population) return null
  const hint = ru.route.populatedHint(formatNumber(population))
  if (compact) {
    return (
      <span title={hint} className="inline-flex shrink-0 text-zinc-500">
        <Users className="size-3.5" aria-hidden />
        <span className="sr-only">{ru.route.populated}</span>
      </span>
    )
  }
  return (
    <span title={hint} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
      <Users className="size-3" aria-hidden />
      {ru.route.populated}
    </span>
  )
}

function NextTarget({ route, onSkip }: { route: RouteView; onSkip: (seq: number) => void }) {
  const stop = route.stops.find((s) => s.seq === route.nextSeq)
  if (route.stops.length === 0) {
    return (
      <section className="rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-800">
        <EmptyState icon={<Route className="size-10" />} title={ru.route.empty} hint={ru.route.emptyHint} />
      </section>
    )
  }
  if (!stop) {
    return (
      <section className="rounded-2xl bg-emerald-500/[0.07] ring-1 ring-emerald-500/25">
        <EmptyState icon={<Flag className="size-10 text-emerald-400" />} title={ru.route.finished} hint={ru.route.finishedHint} />
      </section>
    )
  }
  const left = stop.bodies.reduce((n, b) => n + remaining(b), 0)
  const bio = stop.bodies.some((b) => b.bioSignals > 0)
  return (
    <section aria-labelledby="route-next" className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-sky-500/25 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Label as="h2" id="route-next">
          {ru.route.next} · {ru.route.stopOf(stop.seq, route.stops.length)}
        </Label>
        <a
          href={spanshUrl(stop.address)}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex items-center gap-1 rounded-md text-xs text-zinc-500 hover:text-zinc-300"
        >
          {ru.route.spansh}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h3 className="min-w-0 text-2xl font-semibold tracking-tight break-words text-zinc-50 sm:text-3xl">{stop.name}</h3>
        <CopyButton text={stop.name} label />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
        {stop.here ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
            <MapPin className="size-4" aria-hidden />
            {ru.route.youAreHere}
          </span>
        ) : route.distanceToNextLy !== null ? (
          <span>
            {ru.route.fromYou(formatLy(route.distanceToNextLy))}
            {route.jumpsToNext ? <span className="text-zinc-500"> · {ru.route.jumps(route.jumpsToNext)}</span> : null}
          </span>
        ) : null}
        <PopulatedBadge population={stop.population} />
      </p>

      <ul className="mt-5 divide-y divide-zinc-800/60 rounded-xl bg-zinc-950/40 ring-1 ring-zinc-800/80">
        {stop.bodies.map((b) => (
          <li key={b.bodyId} className={`flex items-center gap-3 px-3.5 py-2.5 text-sm ${b.done ? 'text-zinc-500' : 'text-zinc-200'}`}>
            <BodyChips body={b} dim={b.done} />
            <span className="min-w-0 flex-1 truncate" title={b.name}>
              <span className="font-medium">{b.shortName}</span>
              {b.bioSignals > 0 && (
                <span className="ml-2 text-xs text-zinc-500">
                  {ru.route.bioSignals(b.bioSignals)} · {b.genuses.length > 0 ? b.genuses.join(', ') : ru.route.genusUnknown}
                </span>
              )}
            </span>
            <span className="text-zinc-500 tabular-nums">{formatLs(b.distanceLs)}</span>
            <BodyValue body={b} className={`text-right tabular-nums ${b.bioSignals > 0 ? 'w-24' : 'w-14'}`} />
            <BodyStatus body={b} />
          </li>
        ))}
      </ul>
      {bio && <p className="mt-2 text-xs text-zinc-600">{ru.route.bioHint}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {left > 0 && (
            <>
              {ru.route.toEarn}: <Credits value={left} className="font-medium text-zinc-200" />
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => onSkip(stop.seq)}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-50"
        >
          <SkipForward className="size-4" aria-hidden />
          {ru.route.skip}
        </button>
      </div>
    </section>
  )
}

function Progress({ route, onRefresh, refreshDisabled }: { route: RouteView; onRefresh: () => void; refreshDisabled: boolean }) {
  const total = route.stops.length
  const pct = (n: number) => (total ? (n / total) * 100 : 0)
  return (
    <section aria-labelledby="route-progress" className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-zinc-800 sm:p-6">
      <Label as="h2" id="route-progress">
        {ru.route.progress}
      </Label>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">{ru.route.stopsDone(route.doneCount, total)}</p>
      <div
        className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label={ru.route.progress}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={route.doneCount}
      >
        <div className="h-full bg-emerald-400" style={{ width: `${pct(route.doneCount)}%` }} />
        <div className="h-full bg-zinc-600" style={{ width: `${pct(route.skippedCount)}%` }} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <div>
          <dt className="text-zinc-500">{ru.route.collected}</dt>
          <dd className="mt-0.5">
            <Credits value={route.collectedValue} className="text-lg font-semibold text-emerald-300" />{' '}
            <span className="text-zinc-500" title={exactCredits(route.totalValue)}>
              {ru.route.ofTotal(formatCredits(route.totalValue))}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">{ru.route.remaining}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-zinc-100">{formatLy(route.remainingLy)}</dd>
          <dd className="text-xs text-zinc-500">
            {ru.route.total}: <span className="whitespace-nowrap">{formatLy(route.totalLy)}</span>
            {route.directLy !== null && (
              <span className="block whitespace-nowrap">{ru.route.direct(formatLy(route.directLy))}</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <span title={route.dataAt ? (eventFull(route.dataAt) ?? undefined) : undefined}>
          {route.dataAt ? ru.route.dataFrom(formatRelative(route.dataAt)) : null}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          title={ru.route.refreshHint}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-zinc-400 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {ru.route.refresh}
        </button>
      </div>
    </section>
  )
}

const GRID =
  'grid-cols-[2.5rem_minmax(0,1fr)_6rem] md:grid-cols-[2.5rem_6.5rem_minmax(0,1fr)_6rem_13rem] xl:grid-cols-[2.5rem_6.5rem_minmax(0,22rem)_minmax(0,1fr)_6rem_13rem]'

interface StopActions {
  skip: (seq: number, skipped: boolean) => void
  move: (seq: number, position: number) => void
  remove: (seq: number) => void
}

function IconButton({ label, onClick, children, danger = false }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`focus-ring flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 ${
        danger ? 'hover:text-rose-300' : 'hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function StopStatus({ stop, next }: { stop: RouteStopView; next: boolean }) {
  if (stop.done)
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <CircleCheck className="size-4" aria-hidden />
        {ru.route.status.done}
      </span>
    )
  if (stop.skipped) return <span className="text-zinc-500">{ru.route.status.skipped}</span>
  if (stop.here) return <span className="font-medium text-emerald-300">{ru.route.status.here}</span>
  if (next) return <span className="font-medium text-accent">{ru.route.status.next}</span>
  if (stop.visited) return <span className="text-zinc-400">{ru.route.status.visited}</span>
  return null
}

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
        {stop.jumps ? <span className="block text-xs text-zinc-600">{ru.route.jumps(stop.jumps)}</span> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate font-medium ${dim ? 'text-zinc-500' : 'text-zinc-100'} ${stop.skipped ? 'line-through' : ''}`} title={stop.name}>
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
              b.bioSignals > 0 ? `${ru.route.bioSignals(b.bioSignals)}: ${exactCredits(b.bioMin)} – ${exactCredits(b.bioMax)}` : null,
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
            <IconButton label={label(ru.route.makeNext)} onClick={() => actions.move(stop.seq, nextSeq)}>
              <ChevronsUp className="size-4" aria-hidden />
            </IconButton>
          )}
          {stop.seq > 1 && (
            <IconButton label={label(ru.route.moveUp)} onClick={() => actions.move(stop.seq, stop.seq - 1)}>
              <ArrowUp className="size-4" aria-hidden />
            </IconButton>
          )}
          {!last && (
            <IconButton label={label(ru.route.moveDown)} onClick={() => actions.move(stop.seq, stop.seq + 1)}>
              <ArrowDown className="size-4" aria-hidden />
            </IconButton>
          )}
          {!stop.done && (
            <IconButton label={label(stop.skipped ? ru.route.unskip : ru.route.skip)} onClick={() => actions.skip(stop.seq, !stop.skipped)}>
              {stop.skipped ? <Undo2 className="size-4" aria-hidden /> : <SkipForward className="size-4" aria-hidden />}
            </IconButton>
          )}
          <IconButton label={label(ru.route.remove)} onClick={() => actions.remove(stop.seq)} danger>
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
    <section aria-label={ru.route.title} className="rounded-2xl bg-zinc-900/30 ring-1 ring-zinc-800">
      <div aria-hidden className={`sticky top-14 z-10 grid ${GRID} gap-x-3 rounded-t-2xl border-b border-zinc-800 bg-zinc-950/90 px-4 py-2.5 backdrop-blur`}>
        <span className={th}>{ru.route.colStop}</span>
        <span className={`${th} hidden md:block`}>{ru.route.colHop}</span>
        <span className={th}>{ru.route.colSystem}</span>
        <span className={`${th} hidden xl:block`}>{ru.route.colBodies}</span>
        <span className={`${th} text-right`}>{ru.route.colValue}</span>
        <span className={`${th} hidden text-right md:block`}>{ru.route.colStatus}</span>
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
      ? ru.route.summary.line(source, route.destination?.name ?? p.destination ?? '?', p.deviationLy)
      : ru.route.summary.riches(source, p.radiusLy, route.stops.length)
  return where
}

export function RouteScreen() {
  const { data, error, refetch } = useView('route')
  const actions = useRouteActions()
  const [formOpen, setFormOpen] = useState(false)

  if (!data) return <ViewFallback error={error} onRetry={refetch} />
  const hasRoute = data.params !== null
  const showForm = !hasRoute || formOpen
  const failure = data.error ? (ru.route.errors[data.error] ?? ru.route.errors.internal)(data.errorDetail) : null

  const plan = async (req: Parameters<typeof actions.plan>[0]) => {
    if (await actions.plan(req)) setFormOpen(false)
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{ru.route.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{hasRoute ? routeSummary(data) : ru.route.intro}</p>
        </div>
        {hasRoute && !formOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              disabled={!data.online}
              title={ru.route.editHint}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-800 px-3 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
            >
              <Pencil className="size-4" aria-hidden />
              {ru.route.editRoute}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(ru.route.clearConfirm)) void actions.clear()
              }}
              title={ru.route.clear}
              aria-label={ru.route.clear}
              className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-zinc-500 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-rose-300"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </section>

      {!data.online && <Notice tone="warn">{ru.route.offline}</Notice>}
      {failure && <Notice tone="error">{failure}</Notice>}
      {actions.error && (
        <Notice tone="error">
          {ru.route.sendError}: {actions.error}
        </Notice>
      )}
      {data.building && hasRoute && !showForm && <Notice tone="info">{ru.route.building}</Notice>}

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
          {data.truncated && data.params?.mode === 'line' && <Notice tone="warn">{ru.route.truncated}</Notice>}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
            <NextTarget route={data} onSkip={(seq) => void actions.skip(seq, true)} />
            {data.stops.length > 0 && (
              <Progress
                route={data}
                refreshDisabled={data.building || !data.online}
                onRefresh={() => data.params && void actions.plan({ ...data.params, refresh: true })}
              />
            )}
          </div>
          {data.stops.length > 0 && (
            <StopList
              route={data}
              actions={{
                skip: (seq, skipped) => void actions.skip(seq, skipped),
                move: (seq, position) => void actions.move(seq, position),
                remove: (seq) => void actions.remove(seq),
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

import {
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  History,
  List,
  LocateFixed,
  Orbit,
  Ruler,
  SearchX,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useView } from '../../api/hooks'
import type { SystemRef, SystemView } from '../../api/types'
import { Credits } from '../../components/Credits'
import { Sheet } from '../../components/Sheet'
import { EmptyState, Label, ViewFallback } from '../../components/States'
import { useIsDesktop } from '../../hooks/useMediaQuery'
import { ru } from '../../i18n/ru'
import { bodyLabel, sortBodies, type BodySort } from '../../lib/body'
import { exactCredits, formatCredits } from '../../lib/format'
import { eventDayTime, eventFull } from '../../lib/when'
import { SystemMap } from '../../map'
import { BodyDetail } from './BodyDetail'
import { BodyList } from './BodyList'

const SORT_KEY = 'edk.bodySort'
const VIEW_KEY = 'edk.systemView'

type ViewMode = 'map' | 'list'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable (private mode); the choice just won't persist.
  }
}

function isSheetState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'edkSheet' in state
}

function Stat({
  label,
  short,
  children,
  footer,
}: {
  label: string
  short: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-zinc-900/50 px-2 py-2 ring-1 ring-zinc-800 min-[380px]:px-2.5 sm:px-4 sm:py-2.5">
      <dt className="truncate text-[10px] font-medium tracking-wide text-zinc-500 uppercase sm:text-[11px]">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
      </dt>
      <dd className="mt-0.5 flex flex-1 flex-col">
        <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap text-zinc-50 sm:text-xl">
          {children}
        </span>
        {footer && <div className="mt-auto pt-1.5">{footer}</div>}
      </dd>
    </div>
  )
}

/**
 * The system's bio range. On a phone the tile is narrow: when "136M–188M" does not fit, the upper
 * bound wraps under the lower one instead of being clipped.
 */
function BioRange({ min, max }: { min: number; max: number }) {
  if (min === max) return <Credits value={max} className="text-emerald-300" />
  return (
    <span className="inline-flex flex-wrap text-emerald-300" title={`${exactCredits(min)} – ${exactCredits(max)}`}>
      <span>{formatCredits(min)}</span>
      <span>–{formatCredits(max)}</span>
    </span>
  )
}

/** Opens a system from the history; null opens the current system. */
type OpenSystem = (address: string | null) => void

function openRef(system: SystemView, target: SystemRef, onOpen: OpenSystem) {
  onOpen(target.address === system.currentSystem?.address ? null : target.address)
}

function StepButton({
  target,
  direction,
  system,
  onOpenSystem,
}: {
  target: SystemRef | null
  direction: 'prev' | 'next'
  system: SystemView
  onOpenSystem: OpenSystem
}) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight
  const label = direction === 'prev' ? ru.system.prev : ru.system.next
  let title: string
  if (target) title = (direction === 'prev' ? ru.system.prevTo : ru.system.nextTo)(target.name)
  else title = direction === 'prev' ? ru.system.noPrev : ru.system.noNext
  return (
    <button
      type="button"
      disabled={!target}
      title={title}
      aria-label={target ? title : label}
      onClick={() => target && openRef(system, target, onOpenSystem)}
      className="focus-ring relative flex size-6 items-center justify-center rounded-md text-zinc-400 ring-1 ring-zinc-800 after:absolute after:-inset-1.5 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:text-zinc-700"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

/** Shown above a system from the history: it must never pass for the one you are in. */
function PastBanner({
  system,
  onOpenSystem,
  onShowHistory,
}: {
  system: SystemView
  onOpenSystem: OpenSystem
  onShowHistory: () => void
}) {
  const when = eventDayTime(system.lastVisitAt)
  const current = system.currentSystem
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-sky-500/10 px-4 py-2.5 ring-1 ring-sky-500/25 ring-inset">
      <p className="flex min-w-0 items-center gap-2.5 text-sm text-zinc-300">
        <History className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0">
          <span className="font-medium text-zinc-50">{ru.system.past}</span>
          <span className="sr-only">. {ru.system.pastHint}</span>
          {when && (
            <span title={eventFull(system.lastVisitAt) ?? undefined}>
              {' · '}
              {ru.system.visitedAt(when)}
            </span>
          )}
          {system.visits > 1 && <span className="text-zinc-400"> · {ru.system.visits(system.visits)}</span>}
        </span>
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onShowHistory}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50"
        >
          <List className="size-4" aria-hidden />
          {ru.system.allHistory}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => onOpenSystem(null)}
            title={`${ru.system.nowIn} ${current.name}`}
            className="focus-ring inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 text-sm font-medium text-accent-strong ring-1 ring-sky-400/30 ring-inset hover:bg-sky-500/25"
          >
            <LocateFixed className="size-4 shrink-0" aria-hidden />
            {ru.system.toCurrent}
            <span className="hidden max-w-[16rem] truncate font-normal text-sky-200/70 xl:inline">· {current.name}</span>
          </button>
        )}
      </div>
    </div>
  )
}

function SystemHeader({ system, onOpenSystem }: { system: SystemView; onOpenSystem: OpenSystem }) {
  const { bodyCount, scannedCount, allBodiesFound, totals } = system
  const pct = bodyCount ? Math.min(100, (scannedCount / bodyCount) * 100) : 0
  return (
    <section aria-labelledby="system-title" className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <Label>{system.isCurrent ? ru.tabs.system : ru.system.past}</Label>
          <div className="flex items-center gap-1.5">
            <StepButton target={system.prevSystem} direction="prev" system={system} onOpenSystem={onOpenSystem} />
            <StepButton target={system.nextSystem} direction="next" system={system} onOpenSystem={onOpenSystem} />
          </div>
        </div>
        <h1
          id="system-title"
          className="mt-1 text-2xl font-semibold tracking-tight break-words text-zinc-50 proportional-nums sm:text-3xl"
        >
          {system.name ?? ru.common.unknown}
        </h1>
      </div>
      {/* Phone: one row, the bio range gets the widest tile (and wraps rather than clips at 360px). */}
      <dl className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.75fr)] gap-1.5 sm:grid-cols-4 sm:gap-3 xl:w-[min(100%,46rem)] xl:shrink-0">
        <Stat
          label={ru.system.honk}
          short={ru.system.bodies}
          footer={
            bodyCount === null ? (
              <p className="hidden truncate text-[11px] leading-tight text-zinc-500 sm:block" title={ru.system.honkUnknown}>
                {ru.system.honkUnknown}
              </p>
            ) : (
              <div
                className="h-1 overflow-hidden rounded-full bg-zinc-800"
                role="progressbar"
                aria-label={ru.system.honk}
                aria-valuemin={0}
                aria-valuemax={bodyCount}
                aria-valuenow={scannedCount}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${allBodiesFound ? 'bg-emerald-400' : 'bg-accent'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )
          }
        >
          {scannedCount}
          <span className="text-zinc-500">/{bodyCount ?? '?'}</span>
          {/* On a phone the emerald progress bar says it; the tile has no room for the icon. */}
          {allBodiesFound && (
            <>
              <CircleCheck className="ml-1 hidden size-4 align-[-2px] text-emerald-400 sm:inline" aria-hidden />
              <span className="sr-only">, {ru.system.allFound}</span>
            </>
          )}
        </Stat>
        <Stat label={ru.system.fssLong} short={ru.system.fss}>
          <Credits value={totals.fss} />
        </Stat>
        <Stat label={ru.system.dssLong} short={ru.system.dss}>
          <Credits value={totals.dss} />
        </Stat>
        <Stat label={ru.system.bioLong} short={ru.system.bio}>
          {totals.bioMax > 0 ? (
            <BioRange min={totals.bioMin} max={totals.bioMax} />
          ) : (
            <span className="text-zinc-600">{ru.common.unknown}</span>
          )}
        </Stat>
      </dl>
    </section>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; icon: typeof Ruler }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800">
      {options.map(({ id, label: text, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`focus-ring flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors lg:h-8 ${
            value === id ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Icon className="size-4" aria-hidden />
          {text}
        </button>
      ))}
    </div>
  )
}

const SORT_OPTIONS = [
  { id: 'value' as const, label: ru.system.sortValue, icon: ArrowDownWideNarrow },
  { id: 'distance' as const, label: ru.system.sortDistance, icon: Ruler },
]

const VIEW_OPTIONS = [
  { id: 'map' as const, label: ru.map.map, icon: Orbit },
  { id: 'list' as const, label: ru.map.list, icon: List },
]

export function SystemScreen({
  address: wantedAddress,
  onOpenSystem,
  onShowHistory,
}: {
  /** A system from the history; null: the current system. */
  address: string | null
  onOpenSystem: OpenSystem
  onShowHistory: () => void
}) {
  const { data: fresh, error, refetch } = useView('system', wantedAddress ? { address: wantedAddress } : undefined)
  // Stepping through the history: keep the previous system on screen until the next one arrives.
  const [kept, setKept] = useState(fresh)
  if (fresh && fresh !== kept) setKept(fresh)
  const data = fresh ?? (error ? null : kept)
  const switching = !fresh && data !== null

  // You jumped into the system you were looking at (or opened the current one): show it live.
  const reachedPast = wantedAddress !== null && fresh?.isCurrent === true
  useEffect(() => {
    if (reachedPast) onOpenSystem(null)
  }, [reachedPast, onOpenSystem])

  const isDesktop = useIsDesktop()
  const [sort, setSort] = useState<BodySort>(() => readStored(SORT_KEY, ['value', 'distance'], 'value'))
  const [view, setView] = useState<ViewMode>(() => readStored(VIEW_KEY, ['map', 'list'], 'map'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  // A new system resets the selection.
  const address = data?.address ?? null
  const [shownAddress, setShownAddress] = useState(address)
  if (address !== shownAddress) {
    setShownAddress(address)
    setSelectedId(null)
    setFocusId(null)
  }

  const bodies = useMemo(() => (data ? sortBodies(data.bodies, sort) : []), [data, sort])
  const selected = bodies.find((b) => b.id64 === selectedId) ?? null
  const currentBodyId = data?.currentBodyId ?? null
  // Desktop always shows something in the detail column: the selection, else where you are, else the top body.
  const detail = isDesktop
    ? (selected ?? bodies.find((b) => b.bodyId === currentBodyId) ?? bodies[0] ?? null)
    : selected

  // The phone sheet works with the browser back button / back gesture.
  const isDesktopRef = useRef(isDesktop)
  useEffect(() => {
    isDesktopRef.current = isDesktop
  }, [isDesktop])
  useEffect(() => {
    const onPop = () => {
      if (!isDesktopRef.current && !isSheetState(window.history.state)) setSelectedId(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const select = useCallback(
    (id: string) => {
      setSelectedId(id)
      setFocusId(id)
      if (!isDesktop && !isSheetState(window.history.state)) window.history.pushState({ edkSheet: true }, '')
    },
    [isDesktop],
  )

  const focusBody = (id: string) => {
    setFocusId(id)
    if (isDesktop) setSelectedId(id)
  }

  const closeSheet = useCallback(() => {
    if (isSheetState(window.history.state)) window.history.back()
    else setSelectedId(null)
  }, [])

  const changeSort = (s: BodySort) => {
    setSort(s)
    writeStored(SORT_KEY, s)
  }

  const changeView = (v: ViewMode) => {
    setView(v)
    writeStored(VIEW_KEY, v)
  }

  if (!data) {
    return <ViewFallback error={error} onRetry={refetch} />
  }
  if (wantedAddress !== null && !data.address && !switching) {
    return (
      <div className="flex flex-col items-center">
        <EmptyState icon={<SearchX className="size-10" />} title={ru.system.notFound} hint={ru.system.notFoundHint} />
        <button
          type="button"
          onClick={() => onOpenSystem(null)}
          className="focus-ring -mt-8 inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-800 px-4 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          <LocateFixed className="size-4" aria-hidden />
          {ru.system.toCurrent}
        </button>
      </div>
    )
  }
  if (!data.name && data.bodies.length === 0) {
    return <EmptyState icon={<Orbit className="size-10" />} title={ru.system.noData} hint={ru.system.noDataHint} />
  }

  return (
    <div className={`transition-opacity duration-150 ${switching ? 'opacity-60' : ''}`} aria-busy={switching}>
      {!data.isCurrent && <PastBanner system={data} onOpenSystem={onOpenSystem} onShowHistory={onShowHistory} />}
      <SystemHeader system={data} onOpenSystem={onOpenSystem} />

      <div className="mt-5 grid items-start gap-6 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] xl:grid-cols-[minmax(0,1fr)_440px]">
        <section aria-labelledby="bodies-title" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="bodies-title" className="text-sm font-medium text-zinc-400">
              {ru.system.bodies} <span className="text-zinc-600">{bodies.length}</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {view === 'list' && (
                <Segmented label={ru.system.sortLabel} value={sort} options={SORT_OPTIONS} onChange={changeSort} />
              )}
              <Segmented label={ru.map.viewLabel} value={view} options={VIEW_OPTIONS} onChange={changeView} />
            </div>
          </div>
          {view === 'map' ? (
            <SystemMap
              system={data}
              selectedId={isDesktop ? (detail?.id64 ?? null) : selectedId}
              onSelect={select}
              onShowList={() => changeView('list')}
              className={
                data.isCurrent
                  ? 'h-[max(20rem,calc(100dvh-23.5rem))] lg:h-[max(28rem,calc(100dvh-22rem))] xl:h-[max(30rem,calc(100dvh-16.5rem))]'
                  : // The history banner takes 4.5rem.
                    'h-[max(20rem,calc(100dvh-28rem))] lg:h-[max(28rem,calc(100dvh-26.5rem))] xl:h-[max(30rem,calc(100dvh-21rem))]'
              }
            />
          ) : bodies.length > 0 ? (
            <BodyList
              bodies={bodies}
              selectedId={detail?.id64 ?? null}
              focusId={focusId}
              currentBodyId={currentBodyId}
              onFocusBody={focusBody}
              onSelect={select}
            />
          ) : (
            <EmptyState title={ru.system.emptyList} />
          )}
        </section>

        {isDesktop && (
          <aside
            aria-label={detail ? bodyLabel(detail) : ru.system.selectHint}
            className="sticky top-20 max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-2xl bg-zinc-900/40 p-6 ring-1 ring-zinc-800 lg:mt-[3.25rem]"
          >
            {detail ? (
              <BodyDetail
                key={detail.id64}
                body={detail}
                headingId="detail-title"
                isCurrent={detail.bodyId === currentBodyId}
              />
            ) : (
              <p className="py-12 text-center text-sm text-zinc-500">{ru.system.selectHint}</p>
            )}
          </aside>
        )}
      </div>

      {!isDesktop && selected && (
        <Sheet title={data.name ?? ''} labelledBy="sheet-title" onClose={closeSheet}>
          <BodyDetail body={selected} headingId="sheet-title" isCurrent={selected.bodyId === currentBodyId} />
        </Sheet>
      )}
    </div>
  )
}

// Visited systems, newest first: where you have been and what you did there.
// A row opens the system on the System tab (history mode).
import { BookmarkCheck, CircleCheck, Flag, Footprints, History, Leaf, Map as MapIcon, Search, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useView } from '../../api/hooks'
import type { BodyVisual, HistoryEntry, HistoryStar } from '../../api/types'
import { Credits } from '../../components/Credits'
import { BookmarkLine } from '../../components/Bookmark'
import { EmptyState, ViewFallback } from '../../components/States'
import { t } from '../../i18n'
import { exactCredits } from '../../lib/format'
import { eventDay, eventDayTime, eventTime } from '../../lib/when'
import { bodyColor } from '../../map/visuals/colors'
import { NotableGlyph } from '../stats/NotableGlyph'
import {
  filterCounts,
  groupByDay,
  HISTORY_FILTERS,
  isTransit,
  limitRows,
  matchesFilter,
  matchesQuery,
  relativeDay,
  type DayGroup,
  type HistoryFilter,
} from './historyList'

/** Rows rendered at first and added per "show more" (long trips have thousands of systems). */
const PAGE = 150
/** Notable glyphs shown next to a system name. */
const MAX_GLYPHS = 3

/**
 * Search, filter, list length and scroll position survive leaving the tab: you open a system,
 * look at it and come back to the same place in the list.
 */
const memory = { query: '', filter: 'all' as HistoryFilter, limit: PAGE, scrollY: 0 }

// Columns: time · system · bodies · DSS · bio · firsts · value (DSS and firsts from lg up).
const GRID =
  'grid-cols-[3.25rem_minmax(0,1fr)_6.5rem] md:grid-cols-[3.25rem_minmax(0,1fr)_5.5rem_4.5rem_6.5rem] lg:grid-cols-[3.25rem_minmax(0,1fr)_5.5rem_3.5rem_4.5rem_7.5rem_6.5rem]'

const EMPTY_VISUAL: BodyVisual = {
  planetClass: null,
  starType: null,
  starSubclass: null,
  luminosity: null,
  atmosphereType: null,
  terraformState: null,
  volcanism: null,
  temperatureK: null,
  surfacePressureAtm: null,
  atmosphereComposition: {},
  massEm: null,
  radiusM: null,
  stellarMass: null,
  axialTiltRad: null,
  rotationPeriodS: null,
  tidalLock: null,
  composition: {},
  rings: [],
}

function StarDot({ star }: { star: HistoryStar | null }) {
  if (!star) return <span className="size-2.5 shrink-0 rounded-full ring-1 ring-zinc-700" aria-hidden />
  const color = bodyColor({ ...EMPTY_VISUAL, ...star }, 'star')
  return (
    <span
      className="size-2.5 shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
      title={star.subtype}
      aria-hidden
    />
  )
}

function Dash() {
  return (
    <span className="text-zinc-700" aria-hidden>
      —
    </span>
  )
}

function Bodies({ e }: { e: HistoryEntry }) {
  return (
    <span className="flex items-center gap-1 tabular-nums" title={t.history.bodiesHint(e.bodiesScanned, e.bodyCount)}>
      <span>
        {e.bodiesScanned}
        <span className="text-zinc-600">/{e.bodyCount ?? '?'}</span>
      </span>
      {e.allBodiesFound && (
        <>
          <CircleCheck className="size-3.5 text-emerald-400" aria-hidden />
          <span className="sr-only">, {t.history.allFound}</span>
        </>
      )}
    </span>
  )
}

function Bio({ e }: { e: HistoryEntry }) {
  if (e.bioSignals === 0 && e.speciesAnalysed === 0) return <Dash />
  const done = e.bioSignals > 0 && e.speciesAnalysed >= e.bioSignals
  return (
    <span
      className={`flex items-center gap-1 tabular-nums ${done ? 'text-emerald-300' : 'text-zinc-200'}`}
      title={t.history.bioHint(e.speciesAnalysed, e.bioSignals)}
    >
      <Leaf className="size-3.5 shrink-0 text-emerald-400/80" aria-hidden />
      <span>
        {e.speciesAnalysed}
        {e.bioSignals > 0 && <span className="text-zinc-600">/{e.bioSignals}</span>}
      </span>
    </span>
  )
}

function Firsts({ e }: { e: HistoryEntry }) {
  const marks = [
    { n: e.firstDiscoveries, icon: Flag, label: t.history.firstDiscoveries },
    { n: e.firstMapped, icon: MapIcon, label: t.history.firstMapped },
    { n: e.firstFootfalls, icon: Footprints, label: t.history.firstFootfalls },
  ].filter((m) => m.n > 0)
  if (marks.length === 0) return <Dash />
  return (
    <span className="flex items-center gap-2.5 text-zinc-200">
      {marks.map(({ n, icon: Icon, label }) => (
        <span key={label} className="inline-flex items-center gap-1 tabular-nums" title={`${label}: ${n}`}>
          <Icon className="size-3.5 text-zinc-500" aria-hidden />
          {n}
          <span className="sr-only">{label}</span>
        </span>
      ))}
    </span>
  )
}

function Mark({ className, label }: { className: string; label: string }) {
  return <span className={`size-1.5 shrink-0 rounded-full ${className}`} title={label} aria-label={label} role="img" />
}

function Value({ e, dim }: { e: HistoryEntry; dim: boolean }) {
  const lost = t.history.lost(exactCredits(e.lostValue))
  return (
    <span className="flex items-center justify-end gap-1.5 tabular-nums">
      {e.lostValue > 0 && e.value > 0 && <Mark className="bg-rose-400" label={lost} />}
      {/* Every jump leaves an unsold arrival-star scan: mark only systems you explored. */}
      {e.unsoldValue > 0 && !dim && <Mark className="bg-amber-400" label={t.history.unsold(exactCredits(e.unsoldValue))} />}
      {e.lostValue > 0 && e.value === 0 ? (
        <span className="text-rose-300/80" title={lost}>
          {t.history.lostShort}
        </span>
      ) : e.value === 0 ? (
        <Dash />
      ) : (
        <Credits value={e.value} className={dim ? 'text-zinc-500' : 'font-medium text-zinc-100'} />
      )}
    </span>
  )
}

function Row({ e, current, onOpen }: { e: HistoryEntry; current: boolean; onOpen: (e: HistoryEntry) => void }) {
  const transit = isTransit(e)
  const first = eventDayTime(e.firstVisitAt)
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(e)}
        title={e.visits > 1 && first ? t.history.visitsHint(e.visits, first) : undefined}
        className={`focus-ring grid w-full ${GRID} items-center gap-x-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-zinc-800/40 ${
          current ? 'bg-emerald-500/[0.06]' : ''
        } ${transit ? 'text-zinc-500' : 'text-zinc-300'}`}
      >
        <span className="text-zinc-500 tabular-nums">{eventTime(e.lastVisitAt)}</span>
        <span className="flex min-w-0 items-center gap-2.5">
          <StarDot star={e.mainStar} />
          <span className={`truncate font-medium proportional-nums ${transit ? 'text-zinc-400' : 'text-zinc-100'}`}>{e.name}</span>
          {e.visits > 1 && <span className="shrink-0 text-xs text-zinc-500 tabular-nums">×{e.visits}</span>}
          {current && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
              {/* Phone: the dot alone, so the system's name keeps its room. */}
              <span className="sr-only sm:not-sr-only">{t.history.youAreHere}</span>
            </span>
          )}
          {e.notable.length > 0 && (
            <span className="flex shrink-0 items-center gap-0.5">
              {e.notable.slice(0, MAX_GLYPHS).map((kind) => (
                <span key={kind} title={t.stats.notableLabel[kind as keyof typeof t.stats.notableLabel]?.replace(/­/g, '') ?? kind}>
                  <NotableGlyph kind={kind} size={18} />
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="hidden md:block">
          <Bodies e={e} />
        </span>
        <span className="hidden tabular-nums lg:block" title={t.history.mappedHint(e.bodiesMapped)}>
          {e.bodiesMapped > 0 ? e.bodiesMapped : <Dash />}
        </span>
        <span className="hidden md:block">
          <Bio e={e} />
        </span>
        <span className="hidden lg:block">
          <Firsts e={e} />
        </span>
        <Value e={e} dim={transit} />
        {(e.bookmark || e.innerBookmarks > 0) && (
          <span className="col-span-full col-start-2 mt-1 flex min-w-0 flex-col gap-0.5">
            {e.bookmark && <BookmarkLine bookmark={e.bookmark} clamp className="text-xs" />}
            {e.innerBookmarks > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-200/70">
                <BookmarkCheck className="size-3 shrink-0" aria-hidden />
                {t.bookmarks.inner(e.innerBookmarks)}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  )
}

function dayLabel(group: DayGroup): string {
  const relative = relativeDay(group.day)
  if (relative === 'today') return t.history.today
  if (relative === 'yesterday') return t.history.yesterday
  return eventDay(group.at) ?? t.common.unknown
}

function ColumnHeader() {
  const th = 'text-[11px] font-medium tracking-wide text-zinc-500 uppercase'
  return (
    <div
      aria-hidden
      className={`sticky top-14 z-10 grid ${GRID} gap-x-3 rounded-t-2xl border-b border-zinc-800 bg-zinc-950/90 px-4 py-2.5 backdrop-blur`}
    >
      <span className={th}>{t.history.colTime}</span>
      <span className={th}>{t.history.colSystem}</span>
      <span className={`${th} hidden md:block`}>{t.history.colBodies}</span>
      <span className={`${th} hidden lg:block`}>{t.history.colMapped}</span>
      <span className={`${th} hidden md:block`}>{t.history.colBio}</span>
      <span className={`${th} hidden lg:block`}>{t.history.colFirsts}</span>
      <span className={`${th} text-right`} title={t.history.valueHint}>
        {t.history.colValue}
      </span>
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full lg:w-80">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.history.search}
        aria-label={t.history.search}
        spellCheck={false}
        className="focus-ring h-10 w-full rounded-xl bg-zinc-900 pr-10 pl-9 text-sm text-zinc-100 ring-1 ring-zinc-800 placeholder:text-zinc-500 focus:ring-zinc-700 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title={t.history.searchClear}
          aria-label={t.history.searchClear}
          className="focus-ring absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function FilterChips({
  value,
  counts,
  onChange,
}: {
  value: HistoryFilter
  counts: Record<HistoryFilter, number>
  onChange: (f: HistoryFilter) => void
}) {
  return (
    <div role="group" aria-label={t.history.filterLabel} className="flex flex-wrap gap-2">
      {HISTORY_FILTERS.map((f) => {
        const active = f === value
        return (
          <button
            key={f}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(f)}
            title={t.history.filterHint[f]}
            className={`focus-ring inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors ring-inset ${
              active
                ? 'bg-zinc-100 text-zinc-900 ring-zinc-100'
                : 'text-zinc-400 ring-zinc-800 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            {t.history.filter[f]}
            <span className={`tabular-nums ${active ? 'text-zinc-500' : 'text-zinc-600'}`}>{counts[f]}</span>
          </button>
        )
      })}
    </div>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="mt-4 rounded-2xl bg-zinc-900/30 ring-1 ring-zinc-800">{children}</div>
}

export function HistoryScreen({ onOpenSystem }: { onOpenSystem: (address: string | null) => void }) {
  const { data, error, refetch } = useView('history')
  const [query, setQueryState] = useState(memory.query)
  const [filter, setFilterState] = useState(memory.filter)
  const [limit, setLimitState] = useState(memory.limit)

  const setQuery = (q: string) => {
    memory.query = q
    memory.limit = PAGE
    setQueryState(q)
    setLimitState(PAGE)
  }
  const setFilter = (f: HistoryFilter) => {
    memory.filter = f
    memory.limit = PAGE
    setFilterState(f)
    setLimitState(PAGE)
  }
  const showMore = () => {
    memory.limit = limit + PAGE
    setLimitState(limit + PAGE)
  }

  const systems = data?.systems
  const counts = useMemo(() => filterCounts(systems ?? [], query), [systems, query])
  const shown = useMemo(
    () => (systems ?? []).filter((e) => matchesQuery(e, query) && matchesFilter(e, filter)),
    [systems, query, filter],
  )
  const groups = useMemo(() => limitRows(groupByDay(shown), limit), [shown, limit])

  // Back from a system opened here: return to the same place in the list.
  const restored = useRef(false)
  useLayoutEffect(() => {
    if (restored.current || !data) return
    restored.current = true
    if (memory.scrollY > 0) window.scrollTo({ top: memory.scrollY })
  }, [data])

  const open = (e: HistoryEntry) => {
    memory.scrollY = window.scrollY
    onOpenSystem(e.address === data?.currentAddress ? null : e.address)
  }

  if (!data) return <ViewFallback error={error} onRetry={refetch} />
  if (data.systems.length === 0) {
    return <EmptyState icon={<History className="size-10" />} title={t.history.empty} hint={t.history.emptyHint} />
  }

  return (
    <div>
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{t.history.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t.history.summary(data.systems.length)}</p>
        </div>
        <SearchBox value={query} onChange={setQuery} />
      </section>

      <div className="mt-5">
        <FilterChips value={filter} counts={counts} onChange={setFilter} />
      </div>

      {shown.length === 0 ? (
        <Frame>
          <div className="flex flex-col items-center pb-10">
            <EmptyState icon={<Search className="size-8" />} title={t.history.noMatch} hint={t.history.noMatchHint} />
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
              className="focus-ring -mt-10 inline-flex h-9 items-center rounded-lg bg-zinc-800 px-4 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
            >
              {t.history.resetFilters}
            </button>
          </div>
        </Frame>
      ) : (
        <Frame>
          <ColumnHeader />
          {groups.map((g) => (
            <section key={g.day} aria-label={dayLabel(g)}>
              <h2 className="flex items-baseline justify-between gap-4 border-b border-zinc-800/70 bg-zinc-900/60 px-4 py-2 text-xs">
                <span className="font-semibold tracking-wide text-zinc-300 uppercase">{dayLabel(g)}</span>
                <span className="text-zinc-500">{t.history.daySystems(g.entries.length)}</span>
              </h2>
              <ol className="divide-y divide-zinc-800/50">
                {g.rows.map((e) => (
                  <Row key={e.address} e={e} current={e.address === data.currentAddress} onOpen={open} />
                ))}
              </ol>
            </section>
          ))}
          {shown.length > limit && (
            <div className="flex justify-center border-t border-zinc-800 p-3">
              <button
                type="button"
                onClick={showMore}
                className="focus-ring inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-50"
              >
                {t.history.more(Math.min(PAGE, shown.length - limit))}
              </button>
            </div>
          )}
        </Frame>
      )}
    </div>
  )
}

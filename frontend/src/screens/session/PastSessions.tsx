// Past game sessions: when you played, for how long, and what it brought. Sortable by any column;
// a row opens what the session was made of.
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, Leaf, Sparkles } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useIngest, useView } from '../../api/hooks'
import type { SessionCodexEntry, SessionEntry } from '../../api/types'
import { Credits } from '../../components/Credits'
import { Label } from '../../components/States'
import { t } from '../../i18n'
import { exactCredits, formatCredits, formatLy, formatNumber } from '../../lib/format'
import { formatDuration as duration } from '../../lib/timeSpent'
import { eventDay, eventFull, eventTime } from '../../lib/when'
import {
  DEFAULT_SORT,
  nextSort,
  sortRows,
  toRows,
  totals,
  type SessionRow,
  type SessionSort,
  type SortState,
} from './sessionList'

/** Rows shown at first and added per "show more". */
const PAGE = 20

/** Sort and list length survive leaving the tab. */
const memory: { sort: SortState; limit: number } = { sort: DEFAULT_SORT, limit: PAGE }

// Columns: session · played · jumps (md) · bodies, species (lg) · codex · earned · per hour (sm).
const GRID =
  'grid-cols-[minmax(0,1fr)_4.75rem_3.25rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_3.75rem_5rem_5rem] md:grid-cols-[minmax(0,1fr)_5.5rem_3.75rem_3.75rem_5rem_5rem] lg:grid-cols-[minmax(0,1fr)_5.5rem_3.75rem_3.75rem_3.75rem_3.75rem_5rem_5rem]'

/** Where each column shows (a hidden cell takes no place in the grid). */
const COLUMNS: readonly { key: SessionSort; show: string }[] = [
  { key: 'start', show: 'flex' },
  { key: 'played', show: 'flex' },
  { key: 'jumps', show: 'hidden md:flex' },
  { key: 'bodies', show: 'hidden lg:flex' },
  { key: 'species', show: 'hidden lg:flex' },
  { key: 'codex', show: 'flex' },
  { key: 'earned', show: 'flex' },
  { key: 'perHour', show: 'hidden sm:flex' },
]

function Dash() {
  return (
    <span className="text-zinc-700" aria-hidden>
      —
    </span>
  )
}

function Count({ n }: { n: number }) {
  return n > 0 ? <>{formatNumber(n)}</> : <Dash />
}

function SortHeader({ sort, onSort }: { sort: SortState; onSort: (key: SessionSort) => void }) {
  return (
    <div
      className={`sticky top-14 z-10 grid ${GRID} gap-x-2 rounded-t-2xl border-b border-zinc-800 bg-zinc-950/90 px-3 backdrop-blur sm:gap-x-3 sm:px-4`}
    >
      {COLUMNS.map(({ key, show }) => {
        const active = sort.key === key
        const label = t.session.past.col[key]
        const Arrow = sort.desc ? ArrowDown : ArrowUp
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSort(key)}
            title={t.session.past.colHint[key]}
            aria-label={t.session.past.sortBy(label)}
            aria-pressed={active}
            className={`focus-ring ${show} h-10 min-w-0 items-center gap-1 text-[11px] font-medium tracking-wide uppercase transition-colors ${
              key === 'start' ? 'justify-start' : 'justify-end'
            } ${active ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <span className="truncate">{label}</span>
            {active && <Arrow className="size-3 shrink-0" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}

function Earned({ s }: { s: SessionEntry }) {
  return (
    <span className="flex items-center justify-end gap-1.5 tabular-nums">
      {s.lostValue > 0 && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-rose-400"
          role="img"
          aria-label={`${t.session.past.lost}: ${exactCredits(s.lostValue)}`}
          title={`${t.session.past.lost}: ${exactCredits(s.lostValue)}`}
        />
      )}
      {s.value > 0 ? <Credits value={s.value} className="font-medium text-zinc-100" /> : <Dash />}
    </span>
  )
}

function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  // dt before dd in the DOM (valid <dl>), value shown on top.
  return (
    <div className="flex min-w-0 flex-col-reverse" title={title}>
      <dt className="mt-0.5 text-xs text-zinc-500">{label}</dt>
      <dd className="text-base font-semibold text-zinc-100 tabular-nums">{value}</dd>
    </div>
  )
}

function CodexChip({ entry }: { entry: SessionCodexEntry }) {
  const Icon = entry.category === 'bio' ? Leaf : Sparkles
  return (
    <li className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-zinc-800/70 px-2.5 py-1 text-xs text-zinc-200">
      <Icon className={`size-3 shrink-0 ${entry.category === 'bio' ? 'text-emerald-400' : 'text-sky-300'}`} aria-hidden />
      <span className="truncate">{entry.name}</span>
    </li>
  )
}

function Details({ s }: { s: SessionEntry }) {
  const p = t.session.past
  return (
    <div className="border-t border-zinc-800/60 bg-zinc-900/40 px-3 py-4 sm:px-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
        <Stat label={p.systems} value={formatNumber(s.systems)} />
        <Stat label={p.jumps} value={formatNumber(s.jumps)} />
        <Stat label={p.distance} value={formatLy(s.distanceLy)} />
        <Stat label={p.scanned} value={formatNumber(s.bodiesScanned)} />
        <Stat label={p.mapped} value={formatNumber(s.bodiesMapped)} />
        <Stat label={p.species} value={formatNumber(s.speciesAnalysed)} />
        <Stat label={t.session.carto} value={<Credits value={s.cartoValue} />} />
        <Stat label={t.session.bio} value={<Credits value={s.bioValue} />} />
        {s.firstDiscoveries > 0 && <Stat label={t.history.firstDiscoveries} value={formatNumber(s.firstDiscoveries)} />}
        {s.firstMapped > 0 && <Stat label={t.history.firstMapped} value={formatNumber(s.firstMapped)} />}
        {s.firstFootfalls > 0 && <Stat label={t.history.firstFootfalls} value={formatNumber(s.firstFootfalls)} />}
        {s.lostValue > 0 && (
          <Stat label={p.lost} title={p.lostHint} value={<Credits value={s.lostValue} className="text-rose-300" />} />
        )}
        {s.deaths > 0 && <Stat label={p.deaths} value={<span className="text-rose-300">{formatNumber(s.deaths)}</span>} />}
      </dl>
      <div className="mt-4">
        <Label as="h3">{s.codex.length > 0 ? `${p.codex} · ${s.codex.length}` : p.noCodex}</Label>
        {s.codex.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {s.codex.map((entry, i) => (
              <CodexChip key={i} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Row({ row, open, onToggle }: { row: SessionRow; open: boolean; onToggle: () => void }) {
  const { s, live } = row
  const day = eventDay(s.startedAt)
  const end = live ? '' : (eventTime(s.endedAt) ?? '')
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={`${eventFull(s.startedAt) ?? ''} – ${live ? t.session.past.now : (eventFull(s.endedAt) ?? '')}`}
        className={`focus-ring grid w-full ${GRID} items-center gap-x-2 px-3 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800/40 sm:gap-x-3 sm:px-4 ${
          live ? 'bg-emerald-500/[0.06]' : ''
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={`size-3.5 shrink-0 text-zinc-600 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-zinc-100">{day}</span>
              {live && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                  <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                  {/* Phone: the dot alone, so the date keeps its room. */}
                  <span className="sr-only sm:not-sr-only">{t.session.past.now}</span>
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-zinc-500 tabular-nums">
              {eventTime(s.startedAt)}
              {/* Phone: the start alone, the duration is next to it. */}
              {end && <span className="hidden sm:inline">–{end}</span>}
            </span>
          </span>
        </span>
        <span className="text-right tabular-nums">{duration(row.playedS)}</span>
        <span className="hidden text-right tabular-nums md:block">
          <Count n={s.jumps} />
        </span>
        <span className="hidden text-right tabular-nums lg:block">
          <Count n={s.bodiesScanned} />
        </span>
        <span className="hidden text-right tabular-nums lg:block">
          <Count n={s.speciesAnalysed} />
        </span>
        <span className={`text-right tabular-nums ${s.codex.length > 0 ? 'text-sky-200' : ''}`}>
          <Count n={s.codex.length} />
        </span>
        <Earned s={s} />
        <span className="hidden text-right tabular-nums sm:block">
          {row.perHour !== null && row.perHour > 0 ? <Credits value={row.perHour} /> : <Dash />}
        </span>
      </button>
      {open && <Details s={s} />}
    </li>
  )
}

export function PastSessions({ now }: { now: number }) {
  const { data } = useView('sessions')
  const gameRunning = useIngest()?.gameRunning ?? false
  const [sort, setSortState] = useState(memory.sort)
  const [limit, setLimitState] = useState(memory.limit)
  const [opened, setOpened] = useState<string | null>(null)

  const rows = useMemo(() => toRows(data?.sessions ?? [], gameRunning, now), [data, gameRunning, now])
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const sum = useMemo(() => totals(rows), [rows])

  if (!data || rows.length === 0) return null

  const setSort = (key: SessionSort) => {
    const next = nextSort(sort, key)
    memory.sort = next
    setSortState(next)
  }
  const showMore = () => {
    memory.limit = limit + PAGE
    setLimitState(limit + PAGE)
  }
  const p = t.session.past
  const hours = Math.round(sum.playedS / 3_600)

  return (
    <section aria-labelledby="sessions-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label as="h2" id="sessions-title" className="flex items-center gap-2">
          <CalendarClock className="size-4" aria-hidden />
          <span title={p.hint}>{p.title}</span>
        </Label>
        <p className="text-sm text-zinc-500">
          {[p.summary(rows.length), p.played(hours > 0 ? p.hours(hours) : duration(sum.playedS)), p.earned(formatCredits(sum.earned))].join(
            ' · ',
          )}
        </p>
      </div>
      <div className="mt-3 rounded-2xl bg-zinc-900/30 ring-1 ring-zinc-800">
        <SortHeader sort={sort} onSort={setSort} />
        <ol className="divide-y divide-zinc-800/50">
          {sorted.slice(0, limit).map((row) => (
            <Row
              key={row.s.startedAt}
              row={row}
              open={opened === row.s.startedAt}
              onToggle={() => setOpened(opened === row.s.startedAt ? null : row.s.startedAt)}
            />
          ))}
        </ol>
        {sorted.length > limit && (
          <div className="flex justify-center border-t border-zinc-800 p-3">
            <button
              type="button"
              onClick={showMore}
              className="focus-ring inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-50"
            >
              {t.history.more(Math.min(PAGE, sorted.length - limit))}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

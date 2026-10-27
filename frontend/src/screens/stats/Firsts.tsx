// First discoveries, first maps and first footfalls: confirmed counters and the bodies, by system.
import { ChevronDown, ChevronUp, Flag, Footprints, Map as MapIcon, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { FirstEntry, FirstState, StatsView } from '../../api/types'
import { t } from '../../i18n'
import { formatNumber } from '../../lib/format'
import { groupFirsts, markCounts, type FirstsFilter, type MarkKind, type SystemGroup } from './firstGroups'
import { bigNumber } from './numbers'
import { Card, MoreButton, SubLabel } from './ui'
import { eventDay, eventDayTime, eventFull } from '../../lib/when'

const MARK_ICON: Record<MarkKind, LucideIcon> = { discovered: Flag, mapped: MapIcon, footfall: Footprints }

const STATE_TEXT: Record<FirstState, string> = {
  sold: 'text-emerald-300',
  pending: 'text-amber-300',
  lost: 'text-rose-300',
}
const STATE_DOT: Record<FirstState, string> = {
  sold: 'bg-emerald-400',
  pending: 'bg-amber-400',
  lost: 'bg-rose-400',
}
const STATES: readonly FirstState[] = ['sold', 'pending', 'lost']

/** Systems shown at first and added per "show more". */
const SYSTEM_STEP = 8
/** Bodies shown in a long system group before "N more"; a group one longer is shown whole. */
const BODY_LIMIT = 5

function Counter({
  icon: Icon,
  value,
  label,
  children,
}: {
  icon: LucideIcon
  value: number
  label: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="mt-1 text-sm text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
          {label}
        </span>
        <span className="mt-0.5 block space-y-0.5 text-xs">{children}</span>
      </dt>
      <dd className="text-3xl font-semibold tracking-tight text-zinc-50 proportional-nums">{bigNumber(value)}</dd>
    </div>
  )
}

function SaleDetail({ pending, lost }: { pending: number; lost: number }) {
  return (
    <>
      <span className="block text-zinc-500">{t.stats.confirmedBySale}</span>
      {pending > 0 && (
        <span className="block text-amber-300/90" title={t.stats.firstStateHint.pending}>
          {t.stats.firstsPending(formatNumber(pending))}
        </span>
      )}
      {lost > 0 && (
        <span className="block text-rose-300/90" title={t.stats.firstStateHint.lost}>
          {t.stats.firstsLost(formatNumber(lost))}
        </span>
      )}
    </>
  )
}

function Legend() {
  return (
    <div className="mt-7">
      <SubLabel className="mb-2.5">{t.stats.firstsLegend}</SubLabel>
      <ul className="space-y-2">
        {STATES.map((s) => (
          <li key={s} className="flex items-start gap-2.5 text-xs">
            <span className={`mt-1 size-2 shrink-0 rounded-full ${STATE_DOT[s]}`} aria-hidden />
            <span className="min-w-0">
              <span className={STATE_TEXT[s]}>{t.stats.firstState[s]}</span>
              <span className="block text-zinc-500">{t.stats.firstStateHint[s]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StateMark({ state }: { state: FirstState | null }) {
  if (!state) {
    return (
      <span className="block leading-5 text-zinc-700">
        <span aria-hidden>—</span>
        <span className="sr-only">{t.stats.firstNone}</span>
      </span>
    )
  }
  return (
    <span
      className={`flex h-5 items-center gap-1.5 text-xs whitespace-nowrap ${STATE_TEXT[state]}`}
      title={t.stats.firstStateHint[state]}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[state]}`} aria-hidden />
      {t.stats.firstState[state]}
      {state !== 'sold' && <span className="sr-only"> — {t.stats.firstStateHint[state]}</span>}
    </span>
  )
}

function FootfallMark({ at }: { at: string | null }) {
  if (!at) {
    return (
      <span className="block leading-5 text-zinc-700">
        <span aria-hidden>—</span>
        <span className="sr-only">{t.stats.firstNone}</span>
      </span>
    )
  }
  const when = eventDayTime(at)
  return (
    <span
      className="flex h-5 items-center gap-1.5 text-xs whitespace-nowrap text-emerald-300"
      title={`${t.stats.firstMark.footfall}: ${eventFull(at) ?? at}`}
    >
      <Footprints className="size-3.5 shrink-0" aria-hidden />
      {when ?? t.common.unknown}
    </span>
  )
}

function BodyRow({ e }: { e: FirstEntry }) {
  const td = 'border-t border-zinc-800/60 px-3 py-2.5'
  return (
    <tr className="hover:bg-zinc-800/25">
      <td className={`${td} truncate font-medium text-zinc-100`} title={e.body}>
        {e.shortName || e.body}
      </td>
      <td className={`${td} truncate text-zinc-400`} title={e.subtype}>
        {e.subtype}
      </td>
      <td className={td}>
        <StateMark state={e.discovered} />
      </td>
      <td className={td}>
        <StateMark state={e.mapped} />
      </td>
      <td className={td}>
        <FootfallMark at={e.footfallAt} />
      </td>
    </tr>
  )
}

function GroupCounts({ g }: { g: SystemGroup }) {
  const kinds = (['discovered', 'mapped', 'footfall'] as const).filter((k) => g.counts[k] > 0)
  return (
    <span className="flex items-center gap-3">
      {kinds.map((k) => {
        const Icon = MARK_ICON[k]
        return (
          <span key={k} className="inline-flex items-center gap-1" title={`${t.stats.firstMark[k]}: ${g.counts[k]}`}>
            <Icon className="size-3.5" aria-hidden />
            <span className="tabular-nums">{g.counts[k]}</span>
          </span>
        )
      })}
    </span>
  )
}

function SystemRows({
  g,
  first,
  expanded,
  onToggle,
}: {
  g: SystemGroup
  first: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const long = g.entries.length > BODY_LIMIT + 1
  const shown = long && !expanded ? g.entries.slice(0, BODY_LIMIT) : g.entries
  const latest = Number.isFinite(g.latest) ? eventDay(new Date(g.latest).toISOString()) : null
  return (
    <tbody>
      {!first && (
        <tr aria-hidden>
          <td colSpan={5} className="h-4 p-0" />
        </tr>
      )}
      <tr>
        <th scope="colgroup" colSpan={5} className="rounded-lg bg-zinc-800/35 px-3 py-2 text-left font-normal">
          <div className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="truncate text-sm font-semibold text-zinc-100" title={g.system ?? undefined}>
                {g.system ?? t.stats.unknownSystem}
              </span>
              <span className="shrink-0 text-xs text-zinc-500">{t.stats.firstsBodies(g.entries.length)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-4 text-xs text-zinc-400">
              <GroupCounts g={g} />
              {latest && <span className="min-w-14 text-right whitespace-nowrap text-zinc-500">{latest}</span>}
            </span>
          </div>
        </th>
      </tr>
      {shown.map((e) => (
        <BodyRow key={e.body} e={e} />
      ))}
      {long && (
        <tr>
          <td colSpan={5} className="border-t border-zinc-800/60 px-1.5 pt-2">
            <MoreButton onClick={onToggle} expanded={expanded} className="ring-0">
              {expanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
              {expanded ? t.stats.collapse : t.stats.firstsMoreBodies(g.entries.length - BODY_LIMIT)}
            </MoreButton>
          </td>
        </tr>
      )}
    </tbody>
  )
}

function FilterChips({
  value,
  counts,
  total,
  onChange,
}: {
  value: FirstsFilter
  counts: Record<MarkKind, number>
  total: number
  onChange: (f: FirstsFilter) => void
}) {
  const items: { id: FirstsFilter; count: number; icon?: LucideIcon }[] = [
    { id: 'all', count: total },
    { id: 'discovered', count: counts.discovered, icon: Flag },
    { id: 'mapped', count: counts.mapped, icon: MapIcon },
    { id: 'footfall', count: counts.footfall, icon: Footprints },
  ]
  return (
    <div role="group" aria-label={t.stats.firstsFilterLabel} className="flex flex-wrap gap-1.5">
      {items.map(({ id, count, icon: Icon }) => {
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            disabled={count === 0 && id !== 'all'}
            onClick={() => onChange(id)}
            className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 disabled:cursor-default disabled:opacity-40 ${
              active
                ? 'bg-zinc-800 text-zinc-100 ring-zinc-700'
                : 'text-zinc-400 ring-zinc-800 enabled:hover:bg-zinc-800/60 enabled:hover:text-zinc-200'
            }`}
          >
            {Icon && <Icon className="size-3.5" aria-hidden />}
            {t.stats.firstsFilter[id]}
            <span className={`tabular-nums ${active ? 'text-zinc-400' : 'text-zinc-500'}`}>{formatNumber(count)}</span>
          </button>
        )
      })}
    </div>
  )
}

function FirstsTable({ entries }: { entries: readonly FirstEntry[] }) {
  const [filter, setFilter] = useState<FirstsFilter>('all')
  const [limit, setLimit] = useState(SYSTEM_STEP)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const counts = useMemo(() => markCounts(entries), [entries])
  const groups = useMemo(() => groupFirsts(entries, filter), [entries, filter])
  const shown = groups.slice(0, limit)
  const rest = groups.length - shown.length

  const changeFilter = (f: FirstsFilter) => {
    setFilter(f)
    setLimit(SYSTEM_STEP)
    setOpen(new Set())
  }
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const th = 'pb-2 px-3 text-left text-[11px] font-medium tracking-wider text-zinc-500 uppercase'
  const markTh = (k: MarkKind) => {
    const Icon = MARK_ICON[k]
    return (
      <th scope="col" className={th} title={t.stats.firstMark[k]}>
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5" aria-hidden />
          {t.stats.firstCol[k]}
        </span>
      </th>
    )
  }

  return (
    <div className="min-w-0">
      <FilterChips value={filter} counts={counts} total={entries.length} onChange={changeFilter} />
      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">{t.stats.noFirstsFilter}</p>
      ) : (
        <div className="relative overflow-x-auto">
          {/* A minimum width, or the free column (type) shrinks to nothing on a phone: the box scrolls instead. */}
          <table className="mt-5 w-full min-w-[43rem] table-fixed border-separate border-spacing-0 text-sm">
            <caption className="sr-only">{t.stats.firsts}</caption>
            <colgroup>
              <col className="w-[6.5rem]" />
              <col />
              <col className="w-[10rem]" />
              <col className="w-[10rem]" />
              <col className="w-[10rem]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  {t.stats.firstCol.body}
                </th>
                <th scope="col" className={th}>
                  {t.stats.firstCol.type}
                </th>
                {markTh('discovered')}
                {markTh('mapped')}
                {markTh('footfall')}
              </tr>
            </thead>
            {shown.map((g, i) => (
              <SystemRows key={g.key} g={g} first={i === 0} expanded={open.has(g.key)} onToggle={() => toggle(g.key)} />
            ))}
          </table>
        </div>
      )}
      {(rest > 0 || groups.length > SYSTEM_STEP) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800/70 pt-4">
          {rest > 0 && (
            <MoreButton onClick={() => setLimit((n) => n + SYSTEM_STEP * 2)}>
              <ChevronDown className="size-3.5" aria-hidden />
              {t.stats.firstsMoreSystems(Math.min(rest, SYSTEM_STEP * 2))}
            </MoreButton>
          )}
          {limit > SYSTEM_STEP && (
            <MoreButton onClick={() => setLimit(SYSTEM_STEP)}>
              <ChevronUp className="size-3.5" aria-hidden />
              {t.stats.collapse}
            </MoreButton>
          )}
          <span className="ml-auto text-xs text-zinc-500">
            {shown.length} / {t.stats.firstsSystems(groups.length)}
          </span>
        </div>
      )}
      {entries.length >= 500 && <p className="mt-3 text-xs text-zinc-600">{t.stats.firstsCapped(entries.length)}</p>}
    </div>
  )
}

export function Firsts({ stats, className = '' }: { stats: StatsView; className?: string }) {
  const entries = useMemo(() => stats.firsts ?? [], [stats.firsts])
  const systems = useMemo(() => new Set(entries.map((e) => e.system ?? '')).size, [entries])

  const nothing =
    entries.length === 0 && stats.firstDiscoveriesSold === 0 && stats.firstMappedSold === 0 && stats.firstFootfallsTotal === 0
  if (nothing) {
    return (
      <Card id="stats-firsts" title={t.stats.firsts} icon={Flag} help="firsts" className={className}>
        <div className="flex items-center gap-4">
          <Flag className="size-9 shrink-0 text-zinc-600" aria-hidden />
          <div>
            <p className="text-base font-medium text-zinc-200">{t.stats.noFirsts}</p>
            <p className="mt-0.5 max-w-xl text-sm text-zinc-500">{t.stats.noFirstsHint}</p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      id="stats-firsts"
      title={t.stats.firsts}
      icon={Flag}
      help="firsts"
      className={className}
      aside={
        entries.length > 0 && (
          <span className="text-xs text-zinc-500">
            {t.stats.firstsSystems(systems)} · {t.stats.firstsBodies(entries.length)}
          </span>
        )
      }
    >
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Stays in view next to a long list. */}
        <div className="min-w-0 self-start lg:sticky lg:top-24">
          <dl className="grid content-start gap-6">
            <Counter icon={Flag} value={stats.firstDiscoveriesSold} label={t.stats.firstsDiscovered(stats.firstDiscoveriesSold)}>
              <SaleDetail pending={stats.firstDiscoveriesPending} lost={stats.firstDiscoveriesLost} />
            </Counter>
            <Counter icon={MapIcon} value={stats.firstMappedSold} label={t.stats.firstsMapped(stats.firstMappedSold)}>
              <SaleDetail pending={stats.firstMappedPending} lost={stats.firstMappedLost} />
            </Counter>
            <Counter icon={Footprints} value={stats.firstFootfallsTotal} label={t.stats.firstsFootfalls(stats.firstFootfallsTotal)}>
              <span className="block text-zinc-500">{t.stats.footfallInstant}</span>
            </Counter>
          </dl>
          <Legend />
        </div>
        {entries.length > 0 ? <FirstsTable entries={entries} /> : <p className="text-sm text-zinc-500">{t.stats.noFirstsHint}</p>}
      </div>
    </Card>
  )
}

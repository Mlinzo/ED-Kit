import { CalendarCheck, Compass, Rocket, Route, Trophy, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DayStats, NamedValue, StatsView } from '../../api/types'
import { ValueBar } from '../../components/charts/Bars'
import { Credits } from '../../components/Credits'
import { t } from '../../i18n'
import { formatNumber } from '../../lib/format'
import { bigNumber } from './numbers'
import { shortDay } from './timeline'
import { VIZ } from './palette'
import { Card, SubLabel } from './ui'

function RecordTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode | null
  sub?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl bg-zinc-800/30 p-3.5 ring-1 ring-zinc-800/80">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-800 text-zinc-300">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-zinc-500">{label}</div>
        {value !== null ? (
          <>
            <div className="mt-0.5 text-xl font-semibold tracking-tight text-zinc-50 proportional-nums">{value}</div>
            {sub && <div className="truncate text-xs text-zinc-400">{sub}</div>}
          </>
        ) : (
          <div className="mt-0.5 text-sm text-zinc-600">{t.stats.noRecords}</div>
        )}
      </div>
    </div>
  )
}

function lyValue(v: number) {
  return (
    <>
      {bigNumber(v, v < 100 ? 1 : 0)} <span className="text-sm font-normal text-zinc-500">{t.units.ly}</span>
    </>
  )
}

function placeSub(r: NamedValue) {
  return (
    <span title={r.name}>
      {r.name}
      {r.at && <span className="text-zinc-600"> · {shortDay(r.at)}</span>}
    </span>
  )
}

function bestDay(timeline: readonly DayStats[], key: 'earnings' | 'distanceLy'): DayStats | null {
  let best: DayStats | null = null
  for (const d of timeline) if (d[key] > 0 && (!best || d[key] > best[key])) best = d
  return best
}

function TopList({ title, items, color }: { title: string; items: readonly NamedValue[]; color: string }) {
  const max = Math.max(0, ...items.map((i) => i.value))
  return (
    <div className="min-w-0">
      <SubLabel className="mb-3">{title}</SubLabel>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">{t.stats.noRecords}</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item, i) => (
            <li key={`${item.name}-${i}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1.5">
              <span className={`text-xs tabular-nums ${i === 0 ? 'text-amber-300/90' : 'text-zinc-600'}`}>{i + 1}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-100 proportional-nums" title={item.name}>
                  {item.name}
                </div>
                {item.detail && (
                  <div className="truncate text-xs text-zinc-500" title={item.detail}>
                    {item.detail}
                  </div>
                )}
              </div>
              <Credits value={item.value} className="text-sm font-semibold text-zinc-100" />
              <div className="col-span-2 col-start-2">
                <ValueBar value={item.value} max={max} color={color} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function Records({ stats, className = '' }: { stats: StatsView; className?: string }) {
  const richest = bestDay(stats.timeline, 'earnings')
  const farthest = bestDay(stats.timeline, 'distanceLy')
  return (
    <Card id="stats-records" title={t.stats.records} icon={Trophy} className={className}>
      <div className="grid gap-x-8 gap-y-8 lg:grid-cols-3">
        <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <RecordTile
            icon={Rocket}
            label={t.stats.longestJump}
            value={stats.longestJump ? lyValue(stats.longestJump.value) : null}
            sub={stats.longestJump && placeSub(stats.longestJump)}
          />
          <RecordTile
            icon={Compass}
            label={t.stats.farthest}
            value={stats.farthestFromSol ? lyValue(stats.farthestFromSol.value) : null}
            sub={stats.farthestFromSol && placeSub(stats.farthestFromSol)}
          />
          <RecordTile
            icon={CalendarCheck}
            label={t.stats.bestDay}
            value={richest ? <Credits value={richest.earnings} /> : null}
            sub={richest && shortDay(richest.date)}
          />
          <RecordTile
            icon={Route}
            label={t.stats.longestDay}
            value={farthest ? lyValue(farthest.distanceLy) : null}
            sub={farthest && `${shortDay(farthest.date)} · ${formatNumber(farthest.jumps)} ${t.stats.jumps(farthest.jumps)}`}
          />
        </div>
        <TopList title={t.stats.topBodies} items={stats.mostValuableBodies} color={VIZ.carto} />
        <TopList title={t.stats.topSpecies} items={stats.mostValuableSpecies} color={VIZ.bio} />
      </div>
    </Card>
  )
}

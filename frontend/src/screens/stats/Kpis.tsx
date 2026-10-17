import { CalendarDays, Orbit, Route, Telescope, type LucideIcon } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import type { StatsView } from '../../api/types'
import { Sparkline } from '../../components/charts/Sparkline'
import { useElementWidth } from '../../components/charts/useElementWidth'
import { t } from '../../i18n'
import { exactCredits, formatCredits, formatNumber } from '../../lib/format'
import { bigNumber } from './numbers'
import { bucketCount, bucketize, longDate, shortDay, type Bucket, type Granularity } from './timeline'
import { VIZ } from './palette'

function Tile({
  icon: Icon,
  label,
  value,
  unit,
  footer,
  trend,
  trendLabel,
  strip,
}: {
  icon: LucideIcon
  label: string
  value: string
  unit?: string
  footer?: ReactNode
  trend?: number[]
  trendLabel?: string
  /** Replaces the sparkline: one cell per day, filled when the commander played. */
  strip?: Bucket[]
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  return (
    <div className="flex min-w-0 flex-col rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-zinc-800 sm:p-5">
      <dt className="flex items-start gap-2 text-xs leading-4 font-medium tracking-wide text-zinc-500 uppercase">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="mt-2 flex flex-1 flex-col">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-3xl font-semibold tracking-tight text-zinc-50 proportional-nums sm:text-4xl">{value}</span>
          {unit && <span className="text-sm text-zinc-500">{unit}</span>}
        </span>
        <div className="mt-auto pt-3">
          {strip && strip.length > 0 ? (
            <DayStrip days={strip} />
          ) : (
            trend &&
            trend.length > 1 && (
              <div ref={ref} title={trendLabel}>
                <Sparkline values={trend} width={width} height={30} accent={VIZ.activity} surface={VIZ.surface} />
              </div>
            )
          )}
          {footer && <span className="block min-h-[calc(3.25em+0.5rem)] pt-2 text-xs leading-relaxed text-zinc-400">{footer}</span>}
        </div>
      </dd>
    </div>
  )
}

/** A short history as a row of day cells: played (accent) or not (empty), today last. */
function DayStrip({ days }: { days: Bucket[] }) {
  const active = days.filter((d) => d.activeDays > 0).length
  return (
    <div
      className="flex h-[30px] items-end gap-[3px]"
      role="img"
      aria-label={t.stats.dayStrip(active, days.length)}
      title={t.stats.dayStrip(active, days.length)}
    >
      {days.map((d) => (
        <span
          key={d.start}
          title={`${shortDay(d.start)}: ${d.activeDays > 0 ? t.stats.playedDay : t.stats.noActivity}`}
          className="h-3 max-w-4 min-w-0 flex-1 rounded-[3px]"
          style={{ background: d.activeDays > 0 ? VIZ.activity : VIZ.empty }}
        />
      ))}
    </div>
  )
}

/** Trend granularity for the tiles: days for a short history, weeks up to a year, then months. */
function trendGranularity(timeline: StatsView['timeline']): Granularity {
  if (bucketCount(timeline, 'day') <= 31) return 'day'
  if (bucketCount(timeline, 'week') <= 53) return 'week'
  return 'month'
}

export function Kpis({ stats }: { stats: StatsView }) {
  const avgJump = stats.jumps > 0 ? stats.distanceLy / stats.jumps : 0
  const total = stats.earningsCarto + stats.earningsBio
  const perDay = stats.daysActive > 0 ? total / stats.daysActive : 0
  const g = useMemo(() => trendGranularity(stats.timeline), [stats.timeline])
  const buckets = useMemo(() => bucketize(stats.timeline, g), [stats.timeline, g])
  const series = (f: (b: Bucket) => number) => buckets.map(f)
  const trendLabel = t.stats.granularity[g]

  return (
    <dl className="grid h-full min-w-0 auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-2">
      <Tile
        icon={Route}
        label={t.stats.distance}
        value={bigNumber(stats.distanceLy, stats.distanceLy < 100 ? 1 : 0)}
        unit={t.units.ly}
        trend={series((b) => b.distanceLy)}
        trendLabel={`${t.stats.seriesDistance}, ${trendLabel}`}
        footer={
          <>
            {formatNumber(stats.jumps)} {t.stats.jumps(stats.jumps)}
            {avgJump > 0 && (
              <span className="block text-zinc-500">{t.stats.avgJump(`${formatNumber(avgJump, 1)} ${t.units.ly}`)}</span>
            )}
          </>
        }
      />
      <Tile
        icon={Orbit}
        label={t.stats.systems}
        value={bigNumber(stats.systemsVisited)}
        trend={series((b) => b.jumps)}
        trendLabel={`${t.stats.seriesJumps}, ${trendLabel}`}
        footer={t.stats.systemsHonked(formatNumber(stats.systemsHonked))}
      />
      <Tile
        icon={Telescope}
        label={t.stats.bodies}
        value={bigNumber(stats.bodiesScanned)}
        trend={series((b) => b.bodiesScanned)}
        trendLabel={`${t.stats.seriesBodies}, ${trendLabel}`}
        footer={t.stats.starsPlanets(stats.starsScanned, formatNumber(stats.starsScanned), stats.planetsScanned, formatNumber(stats.planetsScanned))}
      />
      <Tile
        icon={CalendarDays}
        label={t.stats.days}
        value={bigNumber(stats.daysActive)}
        strip={g === 'day' ? buckets : undefined}
        trend={g === 'day' ? undefined : series((b) => b.activeDays)}
        trendLabel={`${t.stats.days}, ${trendLabel}`}
        footer={
          <>
            {stats.since && t.stats.since(longDate(stats.since))}
            {perDay > 0 && (
              <span className="block text-zinc-500" title={exactCredits(perDay)}>
                {t.stats.perDay(`${formatCredits(perDay)} ${t.units.credits}`)}
              </span>
            )}
          </>
        }
      />
    </dl>
  )
}

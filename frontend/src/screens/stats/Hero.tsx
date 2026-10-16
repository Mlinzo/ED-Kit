import { Trophy } from 'lucide-react'
import { useMemo } from 'react'
import type { StatsView } from '../../api/types'
import { AreaChart } from '../../components/charts/AreaChart'
import { StackedBar } from '../../components/charts/Bars'
import { TooltipRow } from '../../components/charts/ChartTooltip'
import { useElementWidth } from '../../components/charts/useElementWidth'
import { Credits } from '../../components/Credits'
import { ru } from '../../i18n/ru'
import { exactCredits, formatCredits } from '../../lib/format'
import { percent } from './numbers'
import { cumulativeEarnings, longDate, shortDay } from './timeline'
import { VIZ } from './palette'

export function Hero({ stats }: { stats: StatsView }) {
  const total = stats.earningsCarto + stats.earningsBio
  const growth = useMemo(() => cumulativeEarnings(stats.timeline), [stats.timeline])
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>()
  const segments = [
    { key: 'carto', value: stats.earningsCarto, color: VIZ.carto, label: ru.stats.carto },
    { key: 'bio', value: stats.earningsBio, color: VIZ.bio, label: ru.stats.bio },
  ]
  const sale = stats.biggestSale

  return (
    <section
      aria-labelledby="stats-earned"
      className="relative isolate flex h-full min-w-0 flex-col overflow-hidden rounded-3xl bg-zinc-900/50 p-6 ring-1 ring-zinc-800 sm:p-8"
    >
      {/* Soft nebula light in the two series hues */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-20 -z-10 size-80 rounded-full bg-sky-500/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-16 -z-10 size-80 rounded-full bg-emerald-500/[0.07] blur-3xl" />

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 id="stats-earned" className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          {ru.stats.earnedAllTime}
        </h1>
        {(stats.commander || stats.since) && (
          <p className="text-xs text-zinc-500">
            {stats.commander && (
              <>
                {ru.common.commander} <span className="font-medium text-zinc-300">{stats.commander}</span>
              </>
            )}
            {stats.commander && stats.since && <span aria-hidden> · </span>}
            {stats.since && ru.stats.since(longDate(stats.since))}
          </p>
        )}
      </div>

      <p className="mt-3 flex items-baseline gap-2" title={exactCredits(total)}>
        <span className="text-6xl leading-none font-semibold tracking-tighter text-zinc-50 proportional-nums sm:text-7xl">
          {formatCredits(total)}
        </span>
        <span className="text-xl font-medium text-zinc-500">{ru.units.credits}</span>
      </p>

      <div className="mt-6">
        <StackedBar segments={segments} title={(s) => `${s.label}: ${exactCredits(s.value)}`} />
        <dl className="mt-3 grid grid-cols-2 gap-4">
          {segments.map((s) => (
            <div key={s.key} className="min-w-0">
              <dt className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
                <span className="truncate">{s.label}</span>
              </dt>
              <dd className="mt-0.5 pl-[18px] text-lg font-semibold text-zinc-100 proportional-nums">
                <Credits value={s.value} /> <span className="text-sm font-normal text-zinc-500">{percent(s.value, total)}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {growth.length > 1 && (
        <div className="mt-6">
          <div className="mb-1 flex items-baseline justify-between text-xs text-zinc-500">
            <span>{ru.stats.growth}</span>
            <span>
              {shortDay(growth[0].start)} — {shortDay(growth[growth.length - 1].start)}
            </span>
          </div>
          <div ref={chartRef}>
            <AreaChart
              values={growth.map((g) => g.total)}
              width={chartWidth}
              height={64}
              color={VIZ.total}
              surface={VIZ.surface}
              ariaLabel={`${ru.stats.growth}: ${formatCredits(total)}`}
              tooltip={(i) => (
                <>
                  <div className="mb-1 text-zinc-400">{shortDay(growth[i].start)}</div>
                  <TooltipRow value={formatCredits(growth[i].total)} label={ru.stats.total} />
                </>
              )}
            />
          </div>
        </div>
      )}

      {sale && sale.value > 0 && (
        <div className="mt-auto flex items-center gap-3 pt-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300/90 ring-1 ring-amber-400/20">
            <Trophy className="size-4.5" aria-hidden />
          </span>
          <p className="min-w-0 text-sm">
            <span className="block text-xs text-zinc-500">{ru.stats.biggestSale}</span>
            <Credits value={sale.value} className="font-semibold text-zinc-100" />
            <span className="text-zinc-500">
              {' '}
              · {ru.stats.saleKind(sale.name)}
              {sale.at && ` · ${shortDay(sale.at)}`}
            </span>
          </p>
        </div>
      )}
    </section>
  )
}

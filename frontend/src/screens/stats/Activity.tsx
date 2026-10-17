import { Activity as ActivityIcon, Table2, X } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import type { DayStats } from '../../api/types'
import { TooltipRow } from '../../components/charts/ChartTooltip'
import { ColumnChart, type ColumnStack } from '../../components/charts/ColumnChart'
import { columnGutter } from '../../components/charts/geometry'
import { useElementWidth } from '../../components/charts/useElementWidth'
import { t } from '../../i18n'
import { exactCredits, formatCredits, formatNumber } from '../../lib/format'
import { wideGroups } from './numbers'
import { bucketize, bucketLabel, pickGranularity, type Bucket, type Granularity } from './timeline'
import { VIZ } from './palette'
import { Card } from './ui'

type SeriesKey = 'earnings' | 'distanceLy' | 'bodiesScanned' | 'speciesAnalysed'

interface Series {
  key: SeriesKey
  label: string
  color: string
  format: (v: number) => string
}

const fmtLy = (v: number) => formatNumber(v, v > 0 && v < 10 ? 1 : 0)
const fmtInt = (v: number) => formatNumber(v)

const SERIES: Series[] = [
  { key: 'earnings', label: t.stats.seriesEarnings, color: VIZ.total, format: formatCredits },
  { key: 'distanceLy', label: t.stats.seriesDistance, color: VIZ.activity, format: fmtLy },
  { key: 'bodiesScanned', label: t.stats.seriesBodies, color: VIZ.activity, format: fmtInt },
  { key: 'speciesAnalysed', label: t.stats.seriesSpecies, color: VIZ.bio, format: fmtInt },
]

const UNIT: Record<SeriesKey, string> = {
  earnings: t.units.credits,
  distanceLy: t.units.ly,
  bodiesScanned: '',
  speciesAnalysed: '',
}

/** Compact y-axis ticks: 0 / 5k / 10k, credits as 2M. */
function tickFormat(s: Series) {
  return (v: number) => (s.key === 'earnings' || v >= 1_000 ? formatCredits(v) : formatNumber(v, v % 1 ? 1 : 0))
}

/** Earnings by kind: cartography and exobiology, in the Hero's series colours. */
const SPLIT = [
  { key: 'earningsCarto', label: t.stats.carto, color: VIZ.carto },
  { key: 'earningsBio', label: t.stats.bio, color: VIZ.bio },
] as const

/** Sales the backend did not attribute to a kind (an older backend reports totals only). */
const unattributed = (b: Bucket) => Math.max(0, b.earnings - b.earningsCarto - b.earningsBio)

function earningsStack(buckets: readonly Bucket[]): ColumnStack[] {
  const layers: ColumnStack[] = SPLIT.map((sp) => ({ color: sp.color, values: buckets.map((b) => b[sp.key]) }))
  if (buckets.some((b) => unattributed(b) > 0)) layers.push({ color: VIZ.total, values: buckets.map(unattributed) })
  return layers
}

function periodLabel(b: Bucket, g: Granularity): string {
  if (g === 'week') return t.stats.weekOf(bucketLabel(b.start, 'day'))
  return bucketLabel(b.start, g)
}

function Tooltip({ bucket, g, source, split }: { bucket: Bucket; g: Granularity; source: SeriesKey; split: boolean }) {
  return (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-medium text-zinc-200">{periodLabel(bucket, g)}</span>
        {g !== 'day' && <span className="text-zinc-500">{t.stats.activeDays(bucket.activeDays)}</span>}
      </div>
      {bucket.activeDays === 0 ? (
        <div className="text-zinc-500">{t.stats.noActivity}</div>
      ) : (
        <>
          {SERIES.map((s) => {
            const splitHere = split && s.key === 'earnings' && source === 'earnings' && bucket.earnings > 0
            return (
              <div key={s.key}>
                <TooltipRow
                  color={s.key === source && !splitHere ? s.color : undefined}
                  value={`${s.format(bucket[s.key])}${UNIT[s.key] ? ` ${UNIT[s.key]}` : ''}`}
                  label={s.label.toLowerCase()}
                />
                {splitHere &&
                  SPLIT.map((sp) => (
                    <TooltipRow key={sp.key} color={sp.color} value={formatCredits(bucket[sp.key])} label={sp.label.toLowerCase()} />
                  ))}
              </div>
            )
          })}
          <TooltipRow value={formatNumber(bucket.jumps)} label={t.stats.jumps(bucket.jumps)} />
        </>
      )}
    </>
  )
}

function DataTable({ buckets, g, split }: { buckets: Bucket[]; g: Granularity; split: boolean }) {
  const rows = [...buckets].reverse().filter((b) => b.activeDays > 0)
  return (
    <div className="mt-5 max-h-96 overflow-auto rounded-xl ring-1 ring-zinc-800">
      <table className={`w-full text-sm tabular-nums ${split ? 'min-w-[46rem]' : 'min-w-[34rem]'}`}>
        <caption className="sr-only">{t.stats.tableCaption}</caption>
        <thead className="sticky top-0 bg-zinc-900 text-xs text-zinc-500">
          <tr>
            <th scope="col" className="sticky left-0 bg-zinc-900 px-3 py-2 text-left font-medium">
              {t.stats.period}
            </th>
            {SERIES.map((s) => (
              <Fragment key={s.key}>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {s.label}
                </th>
                {split &&
                  s.key === 'earnings' &&
                  SPLIT.map((sp) => (
                    <th key={sp.key} scope="col" className="px-3 py-2 text-right font-medium">
                      {sp.label}
                    </th>
                  ))}
              </Fragment>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t.stats.seriesJumps}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/70">
          {rows.map((b) => (
            <tr key={b.start}>
              <th scope="row" className="sticky left-0 bg-zinc-950 px-3 py-1.5 text-left font-normal whitespace-nowrap text-zinc-300">
                {periodLabel(b, g)}
              </th>
              {SERIES.map((s) => (
                <Fragment key={s.key}>
                  <td
                    className="px-3 py-1.5 text-right text-zinc-100"
                    title={s.key === 'earnings' && b.earnings > 0 ? exactCredits(b.earnings) : undefined}
                  >
                    {s.format(b[s.key])}
                  </td>
                  {split &&
                    s.key === 'earnings' &&
                    SPLIT.map((sp) => (
                      <td
                        key={sp.key}
                        className="px-3 py-1.5 text-right text-zinc-300"
                        title={b[sp.key] > 0 ? exactCredits(b[sp.key]) : undefined}
                      >
                        {formatCredits(b[sp.key])}
                      </td>
                    ))}
                </Fragment>
              ))}
              <td className="px-3 py-1.5 text-right text-zinc-100">{formatNumber(b.jumps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Картография 1.2B, Экзобиология 3.4B" for the earnings chart's accessible name. */
function splitSummary(buckets: readonly Bucket[]): string {
  return SPLIT.map((sp) => `${sp.label} ${formatCredits(buckets.reduce((a, b) => a + b[sp.key], 0))}`).join(', ')
}

/** Legend of the stacked earnings chart, with each kind's total for the period shown. */
function SplitLegend({ buckets }: { buckets: readonly Bucket[] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
      {SPLIT.map((sp) => {
        const total = buckets.reduce((a, b) => a + b[sp.key], 0)
        return (
          <li key={sp.key} className="inline-flex items-center gap-1.5" title={exactCredits(total)}>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: sp.color }} aria-hidden />
            {sp.label}
            <span className="font-medium text-zinc-200 tabular-nums">{formatCredits(total)}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Small multiples: one column chart per measure, sharing the x axis and a synced hover. */
export function Activity({ timeline }: { timeline: readonly DayStats[] }) {
  const [cellRef, cellWidth] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ index: number; source: SeriesKey } | null>(null)
  const [showTable, setShowTable] = useState(false)

  // The gutter is ~40px; pick the finest bucket that keeps columns at least 6px apart.
  const g = useMemo(() => pickGranularity(timeline, Math.max(0, cellWidth - 44)), [timeline, cellWidth])
  const buckets = useMemo(() => bucketize(timeline, g), [timeline, g])
  // One y-axis gutter for all four charts, so the same period sits at the same x in each.
  const gutter = useMemo(
    () => Math.max(...SERIES.map((s) => columnGutter(buckets.map((b) => b[s.key]), tickFormat(s)))),
    [buckets],
  )
  // Earnings split by kind (cartography / exobiology) when the backend reports it.
  const split = useMemo(() => buckets.some((b) => b.earningsCarto + b.earningsBio > 0), [buckets])
  const stack = useMemo(() => (split ? earningsStack(buckets) : undefined), [split, buckets])
  const [shownG, setShownG] = useState(g)
  if (shownG !== g) {
    setShownG(g)
    setHover(null)
  }

  return (
    <Card
      id="stats-activity"
      title={t.stats.activity}
      icon={ActivityIcon}
      aside={
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-full bg-zinc-800/80 px-2.5 py-1 text-xs text-zinc-400 first-letter:uppercase">{t.stats.granularity[g]}</span>
          <button
            type="button"
            aria-pressed={showTable}
            onClick={() => setShowTable((v) => !v)}
            className="focus-ring relative inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-400 ring-1 ring-zinc-800 after:absolute after:-inset-1.5 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {showTable ? <X className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
            {showTable ? t.stats.hideTable : t.stats.showTable}
          </button>
        </div>
      }
    >
      <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2 2xl:grid-cols-4">
        {SERIES.map((s, si) => {
          const values = buckets.map((b) => b[s.key])
          const total = values.reduce((a, v) => a + v, 0)
          let peak = 0
          values.forEach((v, i) => {
            if (v > values[peak]) peak = i
          })
          const unit = UNIT[s.key]
          return (
            <div key={s.key} className="min-w-0">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-zinc-200">{s.label}</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {total > 0
                      ? `${t.stats.peak} ${s.format(values[peak])} · ${periodLabel(buckets[peak], g)}`
                      : t.stats.noActivity}
                  </p>
                </div>
                <p className="shrink-0 text-right" title={s.key === 'earnings' ? exactCredits(total) : undefined}>
                  <span className="text-lg font-semibold text-zinc-50 proportional-nums">{wideGroups(s.format(total))}</span>
                  {unit && <span className="ml-1 text-xs text-zinc-500">{unit}</span>}
                </p>
              </div>
              <div ref={si === 0 ? cellRef : undefined}>
                <ColumnChart
                  values={values}
                  width={cellWidth}
                  height={88}
                  gutter={gutter}
                  color={s.color}
                  stack={s.key === 'earnings' ? stack : undefined}
                  active={hover?.index ?? null}
                  onActive={(i) => setHover(i === null ? null : { index: i, source: s.key })}
                  formatTick={tickFormat(s)}
                  xLabel={(i) => bucketLabel(buckets[i].start, g)}
                  ariaLabel={`${s.label}, ${t.stats.granularity[g]}: ${t.stats.total} ${s.format(total)}${unit ? ` ${unit}` : ''}${
                    s.key === 'earnings' && split ? ` (${splitSummary(buckets)})` : ''
                  }`}
                  showTooltip={hover?.source === s.key}
                  tooltip={(i) => <Tooltip bucket={buckets[i]} g={g} source={s.key} split={split} />}
                />
              </div>
              {s.key === 'earnings' && split && <SplitLegend buckets={buckets} />}
            </div>
          )
        })}
      </div>
      {showTable && <DataTable buckets={buckets} g={g} split={split} />}
    </Card>
  )
}

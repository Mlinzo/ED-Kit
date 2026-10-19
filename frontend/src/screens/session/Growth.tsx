import type { RiskPoint } from '../../api/types'
import { AreaChart } from '../../components/charts/AreaChart'
import { TooltipRow } from '../../components/charts/ChartTooltip'
import { useElementWidth } from '../../components/charts/useElementWidth'
import { t } from '../../i18n'
import { formatCredits, formatDateTime } from '../../lib/format'
import { VIZ } from '../stats/palette'

/** The at-risk card's surface (amber-500/10 over zinc-950): the end marker's ring. */
const SURFACE = '#21180b'

/**
 * Unsold data system by system since the last sale (`sold`: the first point is the sale itself):
 * how the sum at risk built up.
 */
export function Growth({ points, sold }: { points: RiskPoint[]; sold: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  if (points.length < 2) return null
  const total = (p: RiskPoint) => p.carto + p.bio
  const last = points[points.length - 1]
  const systems = t.session.cartoSystems(points.length - (sold ? 1 : 0))

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-zinc-400">
        <span>{t.session.growth}</span>
        <span>{systems}</span>
      </div>
      <div ref={ref}>
        <AreaChart
          values={points.map(total)}
          width={width}
          height={56}
          color={VIZ.total}
          surface={SURFACE}
          ariaLabel={t.session.growthLabel(formatCredits(total(last)), systems)}
          tooltip={(i) => (
            <>
              <div className="mb-1 text-zinc-400">
                {points[i].systemName && <span className="block font-medium text-zinc-200">{points[i].systemName}</span>}
                {formatDateTime(points[i].at)}
              </div>
              <TooltipRow value={formatCredits(total(points[i]))} label={t.session.total} />
              <TooltipRow color={VIZ.carto} value={formatCredits(points[i].carto)} label={t.session.carto} />
              <TooltipRow color={VIZ.bio} value={formatCredits(points[i].bio)} label={t.session.bio} />
            </>
          )}
        />
      </div>
    </div>
  )
}

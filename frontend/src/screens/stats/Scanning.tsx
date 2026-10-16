import { ScanSearch } from 'lucide-react'
import type { ReactNode } from 'react'
import type { StatsView } from '../../api/types'
import { Meter } from '../../components/charts/Bars'
import { ru } from '../../i18n/ru'
import { formatNumber } from '../../lib/format'
import { bigNumber, percent as pctText } from './numbers'
import { VIZ } from './palette'
import { Card } from './ui'

function RatioStat({
  label,
  value,
  part,
  total,
  detail,
}: {
  label: string
  value: ReactNode
  part: number
  total: number
  detail: ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-zinc-400">{label}</dt>
      <dd>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold tracking-tight text-zinc-50 proportional-nums">{value}</span>
          <span className="text-sm text-zinc-400 tabular-nums">{pctText(part, total)}</span>
        </div>
        <Meter
          value={Math.min(part, total)}
          total={total}
          color={VIZ.activity}
          track={VIZ.cartoTrack}
          label={`${label}: ${pctText(part, total)}`}
          className="mt-2.5 h-1.5"
        />
        <div className="mt-1.5 text-xs text-zinc-500">{detail}</div>
      </dd>
    </div>
  )
}

export function Scanning({ stats, className = '' }: { stats: StatsView; className?: string }) {
  return (
    <Card id="stats-scanning" title={ru.stats.scanning} icon={ScanSearch} className={className}>
      <dl className="grid gap-x-8 gap-y-7 sm:grid-cols-2 xl:grid-cols-4">
        <RatioStat
          label={ru.stats.firstDiscoveries}
          value={bigNumber(stats.firstDiscoveries)}
          part={stats.firstDiscoveries}
          total={stats.bodiesScanned}
          detail={ru.stats.firstDiscoveriesOf(stats.bodiesScanned, formatNumber(stats.bodiesScanned))}
        />
        {/* Share of scanned planets the commander mapped; first maps go in the caption. */}
        <RatioStat
          label={ru.stats.mapped}
          value={bigNumber(stats.bodiesMapped)}
          part={stats.bodiesMapped}
          total={stats.planetsScanned}
          detail={
            <>
              {ru.stats.mappedOf(stats.planetsScanned, formatNumber(stats.planetsScanned))}
              {stats.firstMapped > 0 && <span className="text-zinc-400"> · {ru.stats.firstMapped(stats.firstMapped, formatNumber(stats.firstMapped))}</span>}
            </>
          }
        />
        <RatioStat
          label={ru.stats.efficient}
          value={bigNumber(stats.efficientMaps)}
          part={stats.efficientMaps}
          total={stats.bodiesMapped}
          detail={ru.stats.efficientOf(stats.bodiesMapped, formatNumber(stats.bodiesMapped))}
        />
        <RatioStat
          label={ru.stats.fullyScanned}
          value={bigNumber(stats.systemsFullyScanned)}
          part={stats.systemsFullyScanned}
          total={stats.systemsVisited}
          detail={ru.stats.fullyScannedOf(stats.systemsVisited, formatNumber(stats.systemsVisited))}
        />
      </dl>
    </Card>
  )
}

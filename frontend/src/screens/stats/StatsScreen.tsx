// All-time statistics: a glanceable dashboard over GET /api/view/stats.
import { ChartNoAxesColumn } from 'lucide-react'
import { useView } from '../../api/hooks'
import type { StatsView } from '../../api/types'
import { EmptyState, ViewFallback } from '../../components/States'
import { ru } from '../../i18n/ru'
import { Activity } from './Activity'
import { Deaths } from './Deaths'
import { Exobiology } from './Exobiology'
import { Firsts } from './Firsts'
import { Hero } from './Hero'
import { Kpis } from './Kpis'
import { Notable } from './Notable'
import { Records } from './Records'
import { Scanning } from './Scanning'

function isEmpty(s: StatsView): boolean {
  return s.jumps === 0 && s.bodiesScanned === 0 && s.speciesAnalysed === 0 && s.earningsCarto + s.earningsBio === 0
}

export function StatsScreen() {
  const { data, error, refetch } = useView('stats')
  if (!data) return <ViewFallback error={error} onRetry={refetch} />
  if (isEmpty(data)) {
    return <EmptyState icon={<ChartNoAxesColumn className="size-10" />} title={ru.stats.noData} hint={ru.stats.noDataHint} />
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-5 xl:grid-cols-12">
      <div className="min-w-0 xl:col-span-7">
        <Hero stats={data} />
      </div>
      <div className="min-w-0 xl:col-span-5">
        <Kpis stats={data} />
      </div>

      {data.timeline.length > 0 && (
        <div className="min-w-0 xl:col-span-12">
          <Activity timeline={data.timeline} />
        </div>
      )}

      <Exobiology stats={data} className="xl:col-span-7" />
      <Notable notable={data.notable} className="xl:col-span-5" />

      <Records stats={data} className="xl:col-span-12" />

      <Scanning stats={data} className="xl:col-span-12" />
      <Firsts stats={data} className="xl:col-span-12" />
      <Deaths stats={data} className="xl:col-span-12" />
    </div>
  )
}

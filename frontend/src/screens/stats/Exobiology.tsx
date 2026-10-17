import { Leaf } from 'lucide-react'
import type { StatsView } from '../../api/types'
import { SegmentBar } from '../../components/charts/Bars'
import { Ring } from '../../components/charts/Ring'
import { t } from '../../i18n'
import { bigNumber } from './numbers'
import { VIZ } from './palette'
import { Card, Figure, SubLabel } from './ui'

export function Exobiology({ stats, className = '' }: { stats: StatsView; className?: string }) {
  const pct = stats.speciesTotal > 0 ? Math.round((stats.uniqueSpecies / stats.speciesTotal) * 100) : 0
  return (
    <Card
      id="stats-exobio"
      title={t.stats.exobio}
      icon={Leaf}
      className={className}
      aside={<span className="text-xs text-zinc-500 tabular-nums">{pct}%</span>}
    >
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
        <Ring
          value={stats.uniqueSpecies}
          total={stats.speciesTotal}
          size={148}
          stroke={11}
          color={VIZ.bio}
          track={VIZ.bioTrack}
          label={`${stats.uniqueSpecies} ${t.stats.speciesOf(stats.speciesTotal)} — ${t.stats.speciesFound}`}
        >
          <div>
            <div className="text-4xl leading-none font-semibold tracking-tight text-zinc-50 proportional-nums">
              {bigNumber(stats.uniqueSpecies)}
            </div>
            <div className="mt-1 text-xs text-zinc-400">{t.stats.speciesOf(stats.speciesTotal)}</div>
            <div className="text-[11px] text-zinc-500">{t.stats.speciesFound}</div>
          </div>
        </Ring>
        <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-5">
          <Figure
            value={
              <>
                {stats.generaFound}
                <span className="text-zinc-500"> / {stats.generaTotal}</span>
              </>
            }
            label={t.stats.genera}
          />
          <Figure value={bigNumber(stats.speciesAnalysed)} label={t.stats.analyses} />
          {/* Same count as the firsts card (bodies first walked on); `firstFootfalls` only counts
              analyses flagged with the bonus and can lag behind. */}
          <Figure value={bigNumber(stats.firstFootfallsTotal)} label={t.stats.firstFootfalls} />
          <Figure value={bigNumber(stats.codexNewEntries)} label={t.stats.codex} />
        </dl>
      </div>

      {stats.genusProgress.length > 0 && (
        <div className="mt-7">
          <SubLabel className="mb-3">{t.stats.genusCollection}</SubLabel>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-6">
            {stats.genusProgress.map((g) => {
              const any = g.found > 0
              const complete = g.total > 0 && g.found >= g.total
              return (
                <li key={g.genus} className="min-w-0" title={t.stats.genusTitle(g.genus, g.found, g.total)}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] sm:gap-3 sm:text-sm">
                    <span className={`truncate ${any ? 'text-zinc-100' : 'text-zinc-500'}`}>{g.genus}</span>
                    <span className={`shrink-0 text-xs tabular-nums ${complete ? 'text-emerald-300' : any ? 'text-zinc-300' : 'text-zinc-600'}`}>
                      {g.found}/{g.total}
                    </span>
                  </div>
                  <SegmentBar
                    found={g.found}
                    total={g.total}
                    color={VIZ.bio}
                    empty={VIZ.empty}
                    label={t.stats.genusTitle(g.genus, g.found, g.total)}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Card>
  )
}

// Galaxy: every system you visited on a 3D map of the galaxy — your path in arrival order, what
// you earned and where you were first, where you died, the routes ahead. A system opens on the
// System tab.
import { Flag, Galaxy, Orbit, Skull, Telescope, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useView } from '../../api/hooks'
import type { GalaxyView } from '../../api/types'
import { EmptyState, ViewFallback } from '../../components/States'
import { t } from '../../i18n'
import { formatLy, formatNumber } from '../../lib/format'
import { GalaxyMap } from './map'

function Kpi({ icon: Icon, label, value, detail, title }: { icon: LucideIcon; label: string; value: string; detail?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-zinc-900/50 px-4 py-3 ring-1 ring-zinc-800" title={title}>
      <dt className="flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1">
        <span className="text-2xl font-semibold tracking-tight text-zinc-50 proportional-nums">{value}</span>
        {detail && <span className="block truncate text-xs text-zinc-500">{detail}</span>}
      </dd>
    </div>
  )
}

function Kpis({ view }: { view: GalaxyView }) {
  const firsts = useMemo(() => view.systems.reduce((n, s) => n + s.firsts, 0), [view.systems])
  const far = view.farthestFromSol
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Kpi icon={Orbit} label={t.galaxy.systems} value={formatNumber(view.systems.length)} />
      <Kpi icon={Telescope} label={t.galaxy.travelled} value={formatLy(view.distanceLy)} />
      <Kpi icon={Flag} label={t.galaxy.farthest} value={far ? formatLy(far.value) : t.common.unknown} detail={far?.name} />
      <Kpi icon={Galaxy} label={t.galaxy.firsts} value={formatNumber(firsts)} title={t.galaxy.firstsHint} />
      <Kpi icon={Skull} label={t.galaxy.deaths} value={formatNumber(view.deaths.length)} />
    </dl>
  )
}

export function GalaxyScreen({ onOpenSystem, onShowHistory }: { onOpenSystem: (address: string) => void; onShowHistory: () => void }) {
  const { data, error, refetch } = useView('galaxy')
  if (!data) return <ViewFallback error={error} onRetry={refetch} />
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{t.galaxy.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t.galaxy.intro}</p>
      </section>
      {data.systems.length === 0 ? (
        <section className="rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-800">
          <EmptyState icon={<Galaxy className="size-10" />} title={t.galaxy.empty} hint={t.galaxy.emptyHint} />
        </section>
      ) : (
        <>
          <Kpis view={data} />
          <GalaxyMap view={data} onOpenSystem={onOpenSystem} onShowList={onShowHistory} className="h-[clamp(28rem,74dvh,60rem)]" />
        </>
      )}
    </div>
  )
}

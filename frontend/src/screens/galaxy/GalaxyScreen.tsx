// Galaxy: every system you visited on a 3D map of the galaxy — your path in arrival order, what
// you earned and where you were first, where you died, the routes ahead — and the codex regions
// you have been to. A system opens on the System tab.
import { Flag, Galaxy, Layers, Orbit, Skull, Telescope, type LucideIcon } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useView } from '../../api/hooks'
import type { GalaxyRegionView, GalaxyView } from '../../api/types'
import { EmptyState, ViewFallback } from '../../components/States'
import { t } from '../../i18n'
import { formatCredits, formatLy, formatNumber } from '../../lib/format'
import { eventDay } from '../../lib/when'
import { Card } from '../stats/ui'
import { GalaxyMap } from './map'

/** Codex regions in the game ("$Codex_RegionName_1;" to "_42;"). */
const REGION_COUNT = 42

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

const visitedRegions = (view: GalaxyView) => view.regions.filter((r) => r.systems > 0)

function Kpis({ view }: { view: GalaxyView }) {
  const firsts = useMemo(() => view.systems.reduce((n, s) => n + s.firsts, 0), [view.systems])
  const far = view.farthestFromSol
  const here = view.regions.find((r) => r.id === view.region)
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      <Kpi icon={Orbit} label={t.galaxy.systems} value={formatNumber(view.systems.length)} />
      <Kpi icon={Telescope} label={t.galaxy.travelled} value={formatLy(view.distanceLy)} />
      <Kpi icon={Flag} label={t.galaxy.farthest} value={far ? formatLy(far.value) : t.common.unknown} detail={far?.name} />
      <Kpi icon={Galaxy} label={t.galaxy.firsts} value={formatNumber(firsts)} title={t.galaxy.firstsHint} />
      <Kpi icon={Skull} label={t.galaxy.deaths} value={formatNumber(view.deaths.length)} />
      <Kpi
        icon={Layers}
        label={t.galaxy.regions.kpi}
        value={`${formatNumber(visitedRegions(view).length)} / ${REGION_COUNT}`}
        detail={here ? t.galaxy.regions.now(here.name) : undefined}
        title={t.galaxy.regions.hint}
      />
    </dl>
  )
}

function RegionCard({ region, here, selected, onShow }: { region: GalaxyRegionView; here: boolean; selected: boolean; onShow: () => void }) {
  const facts = [
    t.galaxy.regions.systems(region.systems),
    region.codex > 0 ? t.galaxy.regions.codex(region.codex, region.species) : null,
    region.value > 0 ? formatCredits(region.value) : null,
  ].filter(Boolean)
  const since = eventDay(region.firstVisitAt)
  return (
    <button
      type="button"
      onClick={onShow}
      aria-pressed={selected}
      title={t.galaxy.regions.show}
      className={`focus-ring flex w-full flex-col rounded-xl px-4 py-3 text-left ring-1 transition-colors ring-inset ${
        selected ? 'bg-sky-400/10 ring-sky-400/40' : 'bg-zinc-950/40 ring-zinc-800 hover:bg-zinc-800/50'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium text-zinc-100">{region.name}</span>
        {here && <span className="shrink-0 rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">{t.galaxy.regions.here}</span>}
      </span>
      <span className="mt-1 text-xs text-zinc-400">{facts.join(' · ')}</span>
      {since && <span className="mt-0.5 text-xs text-zinc-500">{t.galaxy.regions.since(since)}</span>}
    </button>
  )
}

function Regions({ view, selected, onShow }: { view: GalaxyView; selected: number | null; onShow: (id: number) => void }) {
  if (view.regions.length === 0) return null
  return (
    <Card
      id="galaxy-regions"
      title={t.galaxy.regions.title}
      icon={Layers}
      aside={<span className="text-sm text-zinc-500">{t.galaxy.regions.summary(visitedRegions(view).length, REGION_COUNT)}</span>}
    >
      <p className="-mt-2 mb-4 text-sm text-zinc-500">{t.galaxy.regions.hint}</p>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {view.regions.map((r) => (
          <li key={r.id} className="min-w-0">
            <RegionCard region={r} here={r.id === view.region} selected={r.id === selected} onShow={() => onShow(r.id)} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function GalaxyScreen({ onShowHistory }: { onShowHistory: () => void }) {
  const { data, error, refetch } = useView('galaxy')
  const [focus, setFocus] = useState<{ id: number; nonce: number } | null>(null)
  const mapBox = useRef<HTMLDivElement>(null)
  const showRegion = useCallback((id: number) => {
    setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    mapBox.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })
  }, [])
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
          <div ref={mapBox} className="scroll-mt-20">
            <GalaxyMap view={data} onShowList={onShowHistory} focusRegion={focus} className="h-[clamp(28rem,74dvh,60rem)]" />
          </div>
          <Regions view={data} selected={focus?.id ?? null} onShow={showRegion} />
        </>
      )}
    </div>
  )
}

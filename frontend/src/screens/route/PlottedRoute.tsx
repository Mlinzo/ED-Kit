// The route plotted in the game (NavRoute.json), on the Route tab: whether the fuel lasts and
// where to scoop, the neutron stars and white dwarfs ahead, and how likely each system ahead is
// still undiscovered (Spansh / EDSM). Updates by itself as you jump.
import { Check, ChevronDown, ChevronUp, CircleAlert, Fuel, LoaderCircle, MapPin, Navigation, Sparkles, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { NavHopView, NavRouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { Label } from '../../components/States'
import { t } from '../../i18n'
import { formatLy, formatNumber, formatTons } from '../../lib/format'
import { chanceTone, destination, fuelTone, hasHidden, KIND_COLOR, percent, shownHops, sortedWarnings } from './plotted'

function Empty() {
  return (
    <section className="flex items-start gap-3 rounded-2xl bg-zinc-900/30 px-5 py-4 ring-1 ring-zinc-800">
      <Navigation className="mt-0.5 size-5 shrink-0 text-zinc-600" aria-hidden />
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-zinc-300">{t.plotted.none}</h2>
        <p className="mt-0.5 text-sm text-zinc-500">{t.plotted.noneHint}</p>
      </div>
    </section>
  )
}

const DANGER = new Set(['fuel_short', 'refuel_here', 'dry_stretch'])

function Warnings({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null
  return (
    <ul className="mt-4 space-y-2">
      {codes.map((code) => {
        const danger = DANGER.has(code)
        return (
          <li
            key={code}
            role={danger ? 'alert' : undefined}
            className={`flex items-start gap-2.5 rounded-xl px-4 py-2.5 text-sm ring-1 ring-inset ${
              danger ? 'bg-rose-500/10 text-rose-200 ring-rose-500/25' : 'bg-amber-500/10 text-amber-200 ring-amber-500/25'
            }`}
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t.plotted.warnings[code] ?? code}
          </li>
        )
      })}
    </ul>
  )
}

function Line({ icon, tone = 'text-zinc-300', children }: { icon: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <li className={`flex items-start gap-2 ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function FuelSummary({ view }: { view: NavRouteView }) {
  const f = view.fuel
  const tone = fuelTone(view)
  const pct = f.level !== null && f.capacity ? Math.min(100, (f.level / f.capacity) * 100) : null
  const bar = tone === 'danger' ? 'bg-rose-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-sky-400'
  const icon = 'size-4'
  return (
    <div className="rounded-xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800/80">
      <div className="flex items-baseline justify-between gap-3">
        <Label as="h3">{t.plotted.fuel}</Label>
        <span className="text-sm text-zinc-300 tabular-nums">
          {f.level !== null && f.capacity !== null ? t.plotted.tank(formatTons(f.level), formatTons(f.capacity)) : t.plotted.levelUnknown}
        </span>
      </div>
      {pct !== null && (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
          role="meter"
          aria-label={t.plotted.fuel}
          aria-valuemin={0}
          aria-valuemax={f.capacity ?? 0}
          aria-valuenow={f.level ?? 0}
        >
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="mt-3 space-y-1.5 text-sm">
        {f.enough === true && (
          <Line icon={<Check className={`${icon} text-emerald-400`} aria-hidden />}>{t.plotted.enough}</Line>
        )}
        {f.enough === false && (
          <Line icon={<CircleAlert className={`${icon} text-rose-400`} aria-hidden />} tone="text-rose-200">
            {t.plotted.short}
          </Line>
        )}
        {view.jumpsLeft > 0 &&
          (f.jumpsToScoop !== null ? (
            <Line icon={<Fuel className={`${icon} text-amber-300`} aria-hidden />}>
              {t.plotted.scoopIn(f.jumpsToScoop)}
              {f.fuelAtScoop !== null && <span className="text-zinc-500"> · {t.plotted.scoopArrive(formatTons(f.fuelAtScoop))}</span>}
            </Line>
          ) : (
            <Line icon={<Fuel className={`${icon} text-zinc-600`} aria-hidden />} tone="text-zinc-400">
              {t.plotted.noScoopAhead}
            </Line>
          ))}
        {f.longestDry > 1 && f.longestDryFuel !== null && (
          <Line icon={<span className={`block ${icon}`} aria-hidden />} tone="text-zinc-400">
            {t.plotted.longestDry(f.longestDry, formatTons(f.longestDryFuel))}
          </Line>
        )}
        {!f.hasScoop && (
          <Line icon={<CircleAlert className={`${icon} text-amber-400`} aria-hidden />} tone="text-amber-200">
            {t.plotted.noScoop}
          </Line>
        )}
      </ul>
      <p className="mt-3 text-xs text-zinc-600">{f.learntFrom > 0 ? t.plotted.learntFrom(f.learntFrom) : t.plotted.noEstimate}</p>
    </div>
  )
}

function Ahead({ view }: { view: NavRouteView }) {
  const dot = (color: string) => <span className="mt-1 block size-2 rounded-full" style={{ background: color }} aria-hidden />
  return (
    <div className="rounded-xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800/80">
      <Label as="h3">{t.route.map.legend.ahead}</Label>
      <ul className="mt-3 space-y-1.5 text-sm">
        {view.nextNeutron !== null && (
          <Line icon={dot(KIND_COLOR.neutron)}>
            <span title={t.plotted.kindHint.neutron}>{t.plotted.neutronIn(view.nextNeutron)}</span>
          </Line>
        )}
        {view.nextWhiteDwarf !== null && (
          <Line icon={dot(KIND_COLOR.white_dwarf)}>
            <span title={t.plotted.kindHint.white_dwarf}>{t.plotted.whiteDwarfIn(view.nextWhiteDwarf)}</span>
          </Line>
        )}
        {view.online ? (
          <Line icon={<Sparkles className="size-4 text-emerald-300" aria-hidden />}>
            <span title={t.plotted.expectedHint}>{t.plotted.expected(formatNumber(view.undiscoveredExpected, 1))}</span>
            {view.checking && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-zinc-500">
                <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden />
                {t.plotted.checking}
              </span>
            )}
          </Line>
        ) : (
          <Line icon={<Sparkles className="size-4 text-zinc-600" aria-hidden />} tone="text-zinc-500">
            {t.plotted.offline}
          </Line>
        )}
      </ul>
      {view.online && <p className="mt-3 text-xs text-zinc-600">{t.plotted.chanceNote}</p>}
    </div>
  )
}

const GRID = 'grid-cols-[1.75rem_minmax(0,1fr)_5rem] md:grid-cols-[1.75rem_minmax(0,1fr)_7.5rem_4.5rem_8.5rem_9rem]'

function StarCell({ hop }: { hop: NavHopView }) {
  const color = KIND_COLOR[hop.starKind]
  return (
    <span className="hidden min-w-0 items-center gap-1.5 md:flex" title={`${hop.starClass} · ${t.plotted.kindHint[hop.starKind]}`}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-zinc-300">{hop.starClass.replace(/_.*/, '')}</span>
      <span className="truncate text-xs" style={{ color: hop.starKind === 'other' ? undefined : color }}>
        {t.plotted.kinds[hop.starKind]}
      </span>
    </span>
  )
}

function FuelCell({ hop, capacity, tight }: { hop: NavHopView; capacity: number | null; tight: boolean }) {
  if (hop.short) return <span className="hidden text-xs font-medium text-rose-300 md:block">{t.plotted.runsOut}</span>
  if (hop.fuelAfter === null || !capacity) return <span className="hidden md:block" aria-hidden />
  const pct = Math.max(2, Math.min(100, (hop.fuelAfter / capacity) * 100))
  const bar = tight ? 'bg-amber-400' : 'bg-sky-400/70'
  return (
    <span className="hidden items-center gap-2 md:flex" title={hop.refuel ? t.plotted.refuel : undefined}>
      <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-800" aria-hidden>
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`text-xs tabular-nums ${tight ? 'text-amber-300' : 'text-zinc-400'}`}>
        {formatTons(hop.fuelAfter)} {t.units.t}
      </span>
      {hop.refuel && <Fuel className="size-3.5 shrink-0 text-amber-300" aria-label={t.plotted.refuel} />}
    </span>
  )
}

function ChanceCell({ hop }: { hop: NavHopView }) {
  if (hop.status !== 'ahead') {
    if (hop.discoveredByYou === null) return <span aria-hidden />
    return hop.discoveredByYou ? (
      <span className="justify-self-end text-right text-xs font-medium text-amber-300">{t.plotted.yourFirst}</span>
    ) : (
      <span className="justify-self-end text-right text-xs text-zinc-600">{t.plotted.notFirst}</span>
    )
  }
  const d = hop.discovery
  if (!d) return <span aria-hidden />
  if (d.probability === null) return <span className="justify-self-end text-right text-xs text-zinc-600">{t.plotted.pending}</span>
  const tone = chanceTone(d.probability)
  const style = tone === 'high' ? 'text-emerald-300 font-semibold' : tone === 'mid' ? 'text-emerald-200/80' : 'text-zinc-500'
  const hint = d.reasons.map((r) => t.plotted.chanceHint[r] ?? r).join(' · ')
  return (
    <span className={`justify-self-end text-right text-sm tabular-nums ${style}`} title={hint}>
      {percent(d.probability)}
    </span>
  )
}

function HopRow({ hop, capacity, tightBelow }: { hop: NavHopView; capacity: number | null; tightBelow: number }) {
  const here = hop.status === 'here'
  const passed = hop.status === 'passed'
  const tight = hop.fuelAfter !== null && hop.fuelAfter < tightBelow
  return (
    <li className={`grid ${GRID} items-center gap-x-3 px-4 py-2 text-sm ${here ? 'bg-emerald-500/[0.06]' : ''} ${passed ? 'text-zinc-500' : 'text-zinc-300'}`}>
      <span className="text-zinc-500 tabular-nums">
        {here ? <MapPin className="size-4 text-emerald-300" aria-label={t.plotted.here} /> : hop.index}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate proportional-nums ${passed ? '' : 'font-medium text-zinc-100'}`} title={hop.name}>
          {hop.name}
        </span>
        {!passed && <CopyButton text={hop.name} />}
        {here && <span className="shrink-0 text-xs text-emerald-300">{t.plotted.here}</span>}
        {passed && <span className="shrink-0 text-xs text-zinc-600">{t.plotted.passed}</span>}
      </span>
      <StarCell hop={hop} />
      <span className="hidden text-right text-zinc-400 tabular-nums md:block">{hop.index > 0 ? formatLy(hop.distanceLy) : ''}</span>
      <FuelCell hop={hop} capacity={capacity} tight={tight} />
      <ChanceCell hop={hop} />
    </li>
  )
}

function HopList({ view, expanded }: { view: NavRouteView; expanded: boolean }) {
  const th = 'text-[11px] font-medium tracking-wide text-zinc-500 uppercase'
  // Arriving with less than the biggest jump ahead needs: tight.
  const tightBelow = Math.max(0, ...view.hops.map((h) => h.fuelUsed ?? 0))
  return (
    <div className="mt-5 overflow-hidden rounded-xl bg-zinc-950/30 ring-1 ring-zinc-800/80">
      <div aria-hidden className={`grid ${GRID} gap-x-3 border-b border-zinc-800 px-4 py-2`}>
        <span className={th}>{t.plotted.col.n}</span>
        <span className={th}>{t.plotted.col.system}</span>
        <span className={`${th} hidden md:block`}>{t.plotted.col.star}</span>
        <span className={`${th} hidden text-right md:block`}>{t.plotted.col.hop}</span>
        <span className={`${th} hidden md:block`}>{t.plotted.col.fuel}</span>
        <span className={`${th} text-right`}>{t.plotted.col.chance}</span>
      </div>
      <ol className="divide-y divide-zinc-800/50">
        {shownHops(view, expanded).map((h) => (
          <HopRow key={`${h.index}:${h.address}`} hop={h} capacity={view.fuel.capacity} tightBelow={tightBelow} />
        ))}
      </ol>
    </div>
  )
}

export function PlottedRoute({ view }: { view: NavRouteView }) {
  const [expanded, setExpanded] = useState(false)
  const end = destination(view)
  if (!end) return <Empty />
  const tone = fuelTone(view)
  const ring = tone === 'danger' ? 'ring-rose-500/30' : tone === 'warn' ? 'ring-amber-500/30' : 'ring-zinc-800'
  return (
    <section aria-labelledby="plotted-title" className={`rounded-2xl bg-zinc-900/40 p-5 ring-1 sm:p-6 ${ring}`}>
      <Label as="h2" id="plotted-title">
        {t.plotted.title}
      </Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 text-xl font-semibold tracking-tight break-words text-zinc-50 proportional-nums sm:text-2xl">{end.name}</span>
        <CopyButton text={end.name} />
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        {view.jumpsLeft > 0 ? `${t.plotted.jumps(view.jumpsLeft)} · ${formatLy(view.lyLeft)}` : t.plotted.arrived}
      </p>
      <Warnings codes={sortedWarnings(view)} />
      {view.jumpsLeft > 0 && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <FuelSummary view={view} />
          <Ahead view={view} />
        </div>
      )}
      <HopList view={view} expanded={expanded} />
      {hasHidden(view) && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {expanded ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
            {expanded ? t.plotted.showLess : t.plotted.showAll(view.hops.length)}
          </button>
        </div>
      )}
    </section>
  )
}

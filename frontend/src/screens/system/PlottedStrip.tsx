// The route plotted in the game, seen from the System tab: one line with what matters before the
// next jump — fuel trouble first, else where to refuel, a neutron star or white dwarf next, the
// first discoveries to expect. The Route tab has the details.
import { ArrowRight, Navigation, Sparkles, TriangleAlert } from 'lucide-react'
import type { NavRouteView } from '../../api/types'
import { t } from '../../i18n'
import { formatLy, formatNumber } from '../../lib/format'
import { destination, fuelTone, sortedWarnings } from '../route/plotted'

export function PlottedStrip({ view, onShowRoute }: { view: NavRouteView; onShowRoute: () => void }) {
  const end = destination(view)
  if (!end || view.jumpsLeft === 0) return null
  const tone = fuelTone(view)
  const warning = sortedWarnings(view)[0]
  const style =
    tone === 'danger'
      ? 'bg-rose-500/10 ring-rose-500/30'
      : warning
        ? 'bg-amber-500/[0.08] ring-amber-500/25'
        : 'bg-zinc-900/50 ring-zinc-800'
  const Icon = warning ? TriangleAlert : Navigation
  const iconTone = tone === 'danger' ? 'text-rose-300' : warning ? 'text-amber-300' : 'text-sky-300'
  const scoop = view.fuel.jumpsToScoop
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-2.5 ring-1 ring-inset sm:flex-nowrap ${style}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-zinc-300 sm:flex-nowrap sm:overflow-hidden sm:whitespace-nowrap">
        <Icon className={`size-4 shrink-0 ${iconTone}`} aria-hidden />
        <span className="shrink-0 font-medium text-zinc-50">{t.plotted.title}</span>
        <span className="min-w-0 truncate text-zinc-400" title={end.name}>
          {t.plotted.jumps(view.jumpsLeft)} {t.plotted.to(end.name)}
          <span className="hidden text-zinc-500 xl:inline"> · {formatLy(view.lyLeft)}</span>
        </span>
        {warning ? (
          <span className={`min-w-0 truncate ${tone === 'danger' ? 'text-rose-200' : 'text-amber-200'}`} title={t.plotted.warnings[warning]}>
            {t.plotted.warnings[warning] ?? warning}
          </span>
        ) : (
          scoop !== null && <span className="shrink-0 text-zinc-400">{t.plotted.scoopIn(scoop)}</span>
        )}
        {view.online && view.undiscoveredExpected >= 0.1 && (
          <span className="hidden shrink-0 items-center gap-1 text-emerald-300 lg:inline-flex" title={t.plotted.expectedHint}>
            <Sparkles className="size-3.5" aria-hidden />
            {t.plotted.expected(formatNumber(view.undiscoveredExpected, 1))}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onShowRoute}
        className="focus-ring ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50"
      >
        {t.plotted.open}
        <ArrowRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}

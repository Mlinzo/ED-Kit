// The route plotted in the game, seen from the System tab: one line, only when something needs
// attention before the next jumps — fuel trouble or a dangerous star first, else systems ahead
// likely nobody has discovered. The Route tab has the rest.
import { ArrowRight, Sparkles, TriangleAlert } from 'lucide-react'
import type { NavRouteView } from '../../api/types'
import { t } from '../../i18n'
import { formatLy } from '../../lib/format'
import { destination, fuelTone, likelyFirsts, sortedWarnings } from '../route/plotted'

export function PlottedStrip({ view, onShowRoute }: { view: NavRouteView; onShowRoute: () => void }) {
  const end = destination(view)
  if (!end || view.jumpsLeft === 0) return null
  const warning = sortedWarnings(view)[0]
  const likely = likelyFirsts(view).length
  if (!warning && likely === 0) return null
  const danger = fuelTone(view) === 'danger'
  const style = danger ? 'bg-rose-500/10 ring-rose-500/30' : warning ? 'bg-amber-500/[0.08] ring-amber-500/25' : 'bg-emerald-500/[0.06] ring-emerald-500/20'
  const Icon = warning ? TriangleAlert : Sparkles
  const iconTone = danger ? 'text-rose-300' : warning ? 'text-amber-300' : 'text-emerald-300'
  const text = warning ? (t.plotted.warnings[warning] ?? warning) : t.plotted.likelyAhead(likely)
  return (
    <div className={`mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-2.5 ring-1 ring-inset sm:flex-nowrap ${style}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-zinc-300 sm:flex-nowrap sm:overflow-hidden sm:whitespace-nowrap">
        <Icon className={`size-4 shrink-0 ${iconTone}`} aria-hidden />
        <span className="font-medium text-zinc-50 sm:shrink-0">{t.plotted.title}</span>
        <span className={`min-w-0 sm:truncate ${danger ? 'text-rose-200' : warning ? 'text-amber-200' : 'text-emerald-200'}`} title={text}>
          {text}
        </span>
        <span className="hidden min-w-0 truncate text-zinc-500 xl:inline" title={end.name}>
          {t.plotted.jumps(view.jumpsLeft)} {t.plotted.to(end.name)} · {formatLy(view.lyLeft)}
        </span>
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

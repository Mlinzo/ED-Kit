// The neutron route to the next stop (Spansh), in the next target's card: offered for a long
// hop, then the waypoint to plot to next and the ones after it, ticked off as you fly.
import { Check, ChevronDown, ChevronUp, LoaderCircle, RefreshCw, TriangleAlert, X, Zap } from 'lucide-react'
import { useState } from 'react'
import type { NeutronPlanView, NeutronWaypointView, RouteView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { t } from '../../i18n'
import { formatLy } from '../../lib/format'
import { IconButton } from './parts'

/** A hop this long is worth asking Spansh about. */
export const NEUTRON_MIN_LY = 250
/** Waypoints listed after the next one before "show all". */
const SHOWN_AFTER = 4

function Waypoint({ w, index, next }: { w: NeutronWaypointView; index: number; next: boolean }) {
  return (
    <li className={`flex items-center gap-2.5 px-3 py-1.5 text-sm ${next ? 'bg-sky-500/[0.08]' : ''} ${w.visited ? 'text-zinc-500' : 'text-zinc-300'}`}>
      <span className="w-6 shrink-0 text-right text-xs text-zinc-600 tabular-nums">{index}</span>
      {w.visited ? (
        <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
      ) : w.neutron ? (
        <Zap className="size-3.5 shrink-0 text-sky-300" aria-label={t.route.neutron.supercharge} />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className={`min-w-0 flex-1 truncate proportional-nums ${next ? 'font-medium text-zinc-50' : ''}`} title={w.name}>
        {w.name}
      </span>
      <span className="shrink-0 text-xs text-zinc-500 tabular-nums">+{w.jumps}</span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-zinc-500 tabular-nums sm:block">{formatLy(w.leftLy)}</span>
    </li>
  )
}

function Plan({ plan, onRebuild, onClear }: { plan: NeutronPlanView; onRebuild: () => void; onClear: () => void }) {
  const [all, setAll] = useState(false)
  const next = plan.nextIndex !== null ? plan.waypoints[plan.nextIndex] : null
  const from = all ? 0 : Math.max(0, (plan.nextIndex ?? plan.waypoints.length) - 1)
  const to = all ? plan.waypoints.length : (plan.nextIndex ?? plan.waypoints.length) + 1 + SHOWN_AFTER
  const shown = plan.waypoints.slice(from, to)
  const hidden = shown.length < plan.waypoints.length
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-300">
          <Zap className="size-4 text-sky-300" aria-hidden />
          <span className="font-medium text-zinc-100">{t.route.neutron.title}</span>
          {plan.totalJumps !== null && (
            <span className="text-zinc-400">
              {plan.directJumps !== null && plan.directJumps > plan.totalJumps
                ? t.route.neutron.jumps(plan.totalJumps, plan.directJumps)
                : t.route.neutron.jumpsOnly(plan.totalJumps)}
            </span>
          )}
          {plan.efficiency !== null && plan.multiplier !== null && (
            <span className="text-xs text-zinc-600">{t.route.neutron.settings(plan.efficiency, plan.multiplier)}</span>
          )}
        </p>
        <span className="flex items-center">
          <IconButton label={`${t.route.neutron.rebuild}: ${t.route.neutron.rebuildHint}`} onClick={onRebuild}>
            <RefreshCw className="size-4" aria-hidden />
          </IconButton>
          <IconButton label={t.route.neutron.remove} onClick={onClear} danger>
            <X className="size-4" aria-hidden />
          </IconButton>
        </span>
      </div>
      {next ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" title={t.route.neutron.plotHint}>
          <span className="text-sm text-zinc-500">{t.route.neutron.plotTo}</span>
          <span className="min-w-0 text-lg font-semibold break-words text-sky-100 proportional-nums">{next.name}</span>
          <CopyButton text={next.name} />
          {next.neutron && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 ring-1 ring-sky-500/25 ring-inset">
              <Zap className="size-3" aria-hidden />
              {t.route.neutron.supercharge}
            </span>
          )}
          <span className="text-xs text-zinc-500">{t.route.neutron.left(formatLy(next.leftLy))}</span>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-300">
          <Check className="size-4" aria-hidden />
          {t.route.neutron.finished}
        </p>
      )}
      <ol className="mt-3 divide-y divide-zinc-800/50 overflow-hidden rounded-lg bg-zinc-950/40 ring-1 ring-zinc-800/80">
        {shown.map((w, i) => (
          <Waypoint key={`${from + i}:${w.address}`} w={w} index={from + i} next={from + i === plan.nextIndex} />
        ))}
      </ol>
      {(hidden || all) && plan.waypoints.length > SHOWN_AFTER + 2 && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          aria-expanded={all}
          className="focus-ring mt-2 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {all ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          {all ? t.plotted.showLess : t.plotted.showAll(plan.waypoints.length)}
        </button>
      )}
    </div>
  )
}

/** Shown in the next target's card: an offer, Spansh at work, an error, or the plan. */
export function NeutronPlan({ route, onPlan, onClear }: { route: RouteView; onPlan: () => void; onClear: () => void }) {
  const plan = route.neutron
  const far = route.distanceToNextLy !== null && route.distanceToNextLy >= NEUTRON_MIN_LY
  const offer = route.online && route.jumpRangeLy !== null && far
  if (!plan && !offer) return null

  let body
  if (plan?.building) {
    body = (
      <p className="flex items-center gap-2 text-sm text-sky-200" role="status">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
        {t.route.neutron.building}
      </p>
    )
  } else if (plan && plan.waypoints.length > 0 && !plan.stale) {
    body = <Plan plan={plan} onRebuild={onPlan} onClear={onClear} />
  } else {
    const error = plan?.error ? (t.route.neutron.errors[plan.error] ?? t.route.neutron.errors.internal) : null
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          {error && (
            <p className="flex items-center gap-1.5 text-rose-300" role="alert">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
          {plan?.stale && <p className="text-zinc-400">{t.route.neutron.stale}</p>}
          {!error && !plan?.stale && route.distanceToNextLy !== null && (
            <p className="text-zinc-500">{t.route.neutron.offerHint(formatLy(route.distanceToNextLy))}</p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {(route.online || plan) && (
            <button
              type="button"
              onClick={onPlan}
              disabled={!route.online || route.jumpRangeLy === null}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 text-sm font-medium text-sky-100 ring-1 ring-sky-400/30 ring-inset hover:bg-sky-500/25 disabled:opacity-40"
            >
              <Zap className="size-4" aria-hidden />
              {plan ? t.route.neutron.rebuild : t.route.neutron.offer}
            </button>
          )}
          {plan && (
            <IconButton label={t.route.neutron.remove} onClick={onClear} danger>
              <X className="size-4" aria-hidden />
            </IconButton>
          )}
        </span>
      </div>
    )
  }
  return <div className="mt-5 border-t border-zinc-800 pt-4">{body}</div>
}

// Pieces shared by the route screen, its list and the stop card on the map.
import { CircleCheck, CircleDashed, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RouteBodyView, RouteStopView } from '../../api/types'
import { CreditRange, Credits } from '../../components/Credits'
import { t } from '../../i18n'
import { formatLs, formatNumber } from '../../lib/format'
import { carto } from './helpers'
import { BodyChips } from './kinds'

export function BodyValue({ body, className = '' }: { body: RouteBodyView; className?: string }) {
  const mapping = carto(body) ? body.mappingValue : 0
  if (body.bioSignals === 0) return <Credits value={mapping} className={className} />
  return <CreditRange min={mapping + body.bioMin} max={mapping + body.bioMax} className={className} />
}

export function BodyStatus({ body }: { body: RouteBodyView }) {
  if (body.done)
    return (
      <CircleCheck className="size-4 shrink-0 text-emerald-400" aria-label={t.route.status.done}>
        <title>{t.route.status.done}</title>
      </CircleCheck>
    )
  if (body.bioSignals > 0) {
    // Biology in progress (and mapping, if it counts, shown by the colour).
    const label = t.route.bioDone(body.bioDone, body.bioSignals)
    return (
      <span
        className={`shrink-0 text-xs tabular-nums ${body.bioDone > 0 || body.mapped ? 'text-sky-300' : 'text-zinc-500'}`}
        title={carto(body) && body.mapped ? `${t.route.bodyMapped} · ${label}` : label}
      >
        {body.bioDone}/{body.bioSignals}
      </span>
    )
  }
  if (body.mapped)
    return (
      <CircleCheck className="size-4 shrink-0 text-emerald-400" aria-label={t.route.bodyMapped}>
        <title>{t.route.bodyMapped}</title>
      </CircleCheck>
    )
  if (body.scanned)
    return (
      <CircleDashed className="size-4 shrink-0 text-sky-400" aria-label={t.route.bodyScanned}>
        <title>{t.route.bodyScanned}</title>
      </CircleDashed>
    )
  return <span className="size-4 shrink-0" aria-hidden />
}

/** One body of a stop: kind chips, name (and the biology), distance, value, progress.
 *  `compact` puts the biology under the name (narrow cards). */
export function BodyRow({ body: b, compact = false }: { body: RouteBodyView; compact?: boolean }) {
  const bio =
    b.bioSignals > 0 ? `${t.route.bioSignals(b.bioSignals)} · ${b.genuses.length > 0 ? b.genuses.join(', ') : t.route.genusUnknown}` : null
  return (
    <li className={`flex items-center text-sm ${compact ? 'gap-2.5 px-3 py-2' : 'gap-3 px-3.5 py-2.5'} ${b.done ? 'text-zinc-500' : 'text-zinc-200'}`}>
      <BodyChips body={b} dim={b.done} />
      {compact ? (
        <span className="min-w-0 flex-1" title={b.name}>
          <span className="block truncate font-medium">{b.shortName}</span>
          {bio && <span className="block truncate text-xs text-zinc-500">{bio}</span>}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate" title={b.name}>
          <span className="font-medium">{b.shortName}</span>
          {bio && <span className="ml-2 text-xs text-zinc-500">{bio}</span>}
        </span>
      )}
      <span className="text-zinc-500 tabular-nums">{formatLs(b.distanceLs)}</span>
      <BodyValue body={b} className={`text-right tabular-nums ${b.bioSignals > 0 ? 'w-24' : 'w-14'}`} />
      <BodyStatus body={b} />
    </li>
  )
}

export function PopulatedBadge({ population, compact = false }: { population: number | null; compact?: boolean }) {
  if (!population) return null
  const hint = t.route.populatedHint(formatNumber(population))
  if (compact) {
    return (
      <span title={hint} className="inline-flex shrink-0 text-zinc-500">
        <Users className="size-3.5" aria-hidden />
        <span className="sr-only">{t.route.populated}</span>
      </span>
    )
  }
  return (
    <span title={hint} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
      <Users className="size-3" aria-hidden />
      {t.route.populated}
    </span>
  )
}

export function IconButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`focus-ring flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 ${
        danger ? 'hover:text-rose-300' : 'hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

export function StopStatus({ stop, next }: { stop: RouteStopView; next: boolean }) {
  if (stop.done)
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <CircleCheck className="size-4" aria-hidden />
        {t.route.status.done}
      </span>
    )
  if (stop.skipped) return <span className="text-zinc-500">{t.route.status.skipped}</span>
  if (stop.here) return <span className="font-medium text-emerald-300">{t.route.status.here}</span>
  if (next) return <span className="font-medium text-accent">{t.route.status.next}</span>
  if (stop.visited) return <span className="text-zinc-400">{t.route.status.visited}</span>
  return null
}

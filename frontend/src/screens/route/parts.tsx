// Pieces shared by the route screen, its list and the stop card on the map.
import { BookOpen, CircleCheck, CircleDashed, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RouteBodyView, RouteStopView } from '../../api/types'
import { CreditRange, Credits } from '../../components/Credits'
import { t } from '../../i18n'
import { formatLs, formatNumber } from '../../lib/format'
import { carto } from './helpers'
import { BodyChips } from './kinds'
import { chanceTone, percent } from './plotted'

/** Firsts routes: how likely nobody has discovered the stop yet, or once you have been there,
 *  whether your scan of its star was the first. */
export function FirstsChance({ stop, className = '' }: { stop: RouteStopView; className?: string }) {
  if (stop.first !== null)
    return <span className={`${stop.first ? 'text-amber-300' : 'text-zinc-500'} ${className}`}>{stop.first ? t.plotted.yourFirst : t.plotted.notFirst}</span>
  const d = stop.discovery
  if (!d || d.probability === null) return null
  const tone = chanceTone(d.probability)
  const style = tone === 'high' ? 'text-emerald-300' : tone === 'mid' ? 'text-emerald-200/80' : 'text-zinc-500'
  const hint = d.reasons.map((r) => t.plotted.chanceHint[r] ?? r).join(' · ')
  return (
    <span className={`tabular-nums ${style} ${className}`} title={hint}>
      {percent(d.probability)}
    </span>
  )
}

/** Codex routes: new codex entries expected (fractions are what is uncertain); `short`: the
 *  number alone, for narrow columns. */
export function CodexCount({ value, short = false, className = '' }: { value: number; short?: boolean; className?: string }) {
  const n = formatNumber(value, value >= 10 || Number.isInteger(value) ? 0 : 1)
  const text = t.route.codex.expected(n)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums ${className}`} title={short ? text : t.route.codex.leftHint}>
      <BookOpen className="size-[0.9em] shrink-0" aria-hidden />
      {short ? `≈${n}` : text}
      {short && <span className="sr-only">{text}</span>}
    </span>
  )
}

/** The species that may be new in your codex on a body: names with their colour, the unsure ones dim. */
export function CodexList({ body, className = '' }: { body: RouteBodyView; className?: string }) {
  if (body.codex.length === 0) return null
  return (
    <span className={`flex flex-wrap gap-x-2 gap-y-0.5 text-xs ${className}`}>
      {body.codex.map((c) => {
        const sure = c.chance >= 0.95
        return (
          <span
            key={`${c.species}:${c.colour}`}
            className={sure ? 'text-violet-200' : 'text-violet-200/60'}
            title={sure ? undefined : t.route.codex.chance(`${Math.round(c.chance * 100)}%`)}
          >
            {c.species}
            {c.colour && <span className="text-violet-300/70"> · {c.colour}</span>}
            {!sure && <span aria-hidden>?</span>}
          </span>
        )
      })}
    </span>
  )
}

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
    // Phone: the name (and the biology) gets the line, distance, value and progress go under it.
    <li
      className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-y-1 text-sm sm:flex sm:items-center ${compact ? 'gap-x-2.5 px-3 py-2' : 'gap-x-3 px-3.5 py-2.5'} ${b.done ? 'text-zinc-500' : 'text-zinc-200'}`}
    >
      <BodyChips body={b} dim={b.done} />
      {compact ? (
        <span className="min-w-0 flex-1" title={b.name}>
          <span className="block truncate font-medium">{b.shortName}</span>
          {bio && <span className="block truncate text-xs text-zinc-500">{bio}</span>}
          <CodexList body={b} className="mt-0.5" />
        </span>
      ) : (
        <span className="min-w-0 flex-1" title={b.name}>
          <span className="block truncate">
            <span className="font-medium">{b.shortName}</span>
            {bio && <span className="ml-2 text-xs text-zinc-500">{bio}</span>}
          </span>
          <CodexList body={b} className="mt-0.5" />
        </span>
      )}
      <span className="col-start-2 flex items-center justify-end gap-3 sm:contents">
        <span className="mr-auto text-zinc-500 tabular-nums sm:mr-0">{formatLs(b.distanceLs)}</span>
        <BodyValue body={b} className={`text-right tabular-nums ${b.bioSignals > 0 ? 'w-24' : 'w-14'}`} />
        <BodyStatus body={b} />
      </span>
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
  if (stop.skipped || stop.passed) return <span className="text-zinc-500">{t.route.status.skipped}</span>
  if (stop.here) return <span className="font-medium text-emerald-300">{t.route.status.here}</span>
  if (next) return <span className="font-medium text-accent">{t.route.status.next}</span>
  if (stop.visited) return <span className="text-zinc-400">{t.route.status.visited}</span>
  return null
}

import {
  CloudSun,
  Droplets,
  Earth,
  FlaskConical,
  Leaf,
  Map as MapIcon,
  MapPinCheck,
  Mountain,
  Orbit,
  PlaneLanding,
  Sparkles,
  Sprout,
  Star,
  type LucideIcon,
} from 'lucide-react'
import type { BodyView, InterestReason } from '../api/types'
import { ru } from '../i18n/ru'

type Tone = 'value' | 'accent' | 'neutral' | 'muted'

interface BadgeSpec {
  key: string
  icon: LucideIcon
  label: string
  count?: number
  tone: Tone
}

const TONES: Record<Tone, string> = {
  value: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
  accent: 'bg-sky-500/10 text-accent ring-sky-500/25',
  neutral: 'bg-zinc-800/80 text-zinc-300 ring-zinc-700/60',
  muted: 'bg-zinc-900 text-zinc-500 ring-zinc-800',
}

function badgesFor(body: BodyView, omitProgress: boolean): BadgeSpec[] {
  const out: BadgeSpec[] = []
  if (body.signals.bio > 0 && !omitProgress)
    out.push({ key: 'bio', icon: Leaf, label: ru.badges.bio, count: body.signals.bio, tone: 'value' })
  if (body.signals.geo > 0)
    out.push({ key: 'geo', icon: Mountain, label: ru.badges.geo, count: body.signals.geo, tone: 'neutral' })
  if (body.wasDiscovered === false)
    out.push({ key: 'first', icon: Sparkles, label: ru.badges.firstDiscovery, tone: 'accent' })
  if (body.worthMapping && !body.mappedByMe && !omitProgress)
    out.push({ key: 'worth', icon: MapIcon, label: ru.badges.worthMapping, tone: 'value' })
  if (body.terraformable)
    out.push({ key: 'tf', icon: Earth, label: ru.badges.terraformable, tone: 'neutral' })
  if (body.mappedByMe && !omitProgress)
    out.push({ key: 'mapped', icon: MapPinCheck, label: ru.badges.mapped, tone: 'muted' })
  if (body.landable) out.push({ key: 'land', icon: PlaneLanding, label: ru.badges.landable, tone: 'muted' })
  return out
}

/**
 * Compact (list rows): signal counts with text, flags as icon chips with a tooltip.
 * Full (details): every badge with its label.
 * omitProgress: leave out what <BodyProgress> already shows (bio, DSS) when both sit side by side.
 */
export function BodyBadges({
  body,
  full = false,
  omitProgress = false,
}: {
  body: BodyView
  full?: boolean
  omitProgress?: boolean
}) {
  const badges = badgesFor(body, omitProgress)
  if (badges.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {badges.map((b) => {
        const Icon = b.icon
        const showText = full || b.count !== undefined
        return (
          <li
            key={b.key}
            title={describe(b)}
            className={`inline-flex h-6 items-center gap-1 rounded-md text-xs font-medium ring-1 ring-inset ${TONES[b.tone]} ${
              showText ? 'px-1.5' : 'w-6 justify-center'
            }`}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            {showText ? (
              <span>
                {b.label}
                {b.count !== undefined && <span className="ml-1">{b.count}</span>}
              </span>
            ) : (
              <span className="sr-only">{b.label}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function describe(b: BadgeSpec): string {
  return b.count !== undefined ? `${b.label}: ${b.count}` : b.label
}

const REASONS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  bio: { icon: Leaf, tone: 'value' },
  map: { icon: MapIcon, tone: 'value' },
  elw: { icon: Earth, tone: 'value' },
  ww: { icon: Droplets, tone: 'value' },
  aw: { icon: FlaskConical, tone: 'value' },
  terraformable: { icon: Sprout, tone: 'value' },
  first_discovery: { icon: Sparkles, tone: 'accent' },
  rare_star: { icon: Star, tone: 'accent' },
  landable_atmo: { icon: CloudSun, tone: 'neutral' },
  geo: { icon: Mountain, tone: 'neutral' },
  rings: { icon: Orbit, tone: 'neutral' },
}

const REASON_ORDER = Object.keys(REASONS)

function reasonLabel(code: string): string {
  const labels = ru.reasons as Record<string, string>
  return code !== 'title' && labels[code] ? labels[code] : code
}

/** "Why interesting" chips from body.reasons; unknown codes still show, as plain text. */
export function ReasonChips({ reasons, className = '' }: { reasons: readonly InterestReason[]; className?: string }) {
  if (reasons.length === 0) return null
  const sorted = [...new Set(reasons)].sort((a, b) => {
    const ia = REASON_ORDER.indexOf(a)
    const ib = REASON_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${className}`} aria-label={ru.reasons.title}>
      {sorted.map((code) => {
        const spec = REASONS[code] ?? { icon: Sparkles, tone: 'neutral' as Tone }
        const Icon = spec.icon
        return (
          <li
            key={code}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ${TONES[spec.tone]}`}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
            {reasonLabel(code)}
          </li>
        )
      })}
    </ul>
  )
}

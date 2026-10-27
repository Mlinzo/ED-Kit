import { CircleCheck, Crosshair, MapPin, Route } from 'lucide-react'
import { useCallback } from 'react'
import { BodyProgress } from '../components/BodyProgress'
import { CodexLine, CodexMark } from '../components/CodexBadge'
import { bodyCodex } from '../components/codex'
import { CreditRange, Credits } from '../components/Credits'
import { sourceMarker } from '../components/source'
import type { RouteTarget } from '../components/BodyBadges'
import { CommunityGlyph, SourceIcon } from '../components/SourceBadge'
import { t } from '../i18n'
import { bioLeft, bodyLabel } from '../lib/body'
import { formatLs } from '../lib/format'
import type { MapRegistry } from './context'
import type { MapNode } from './layout'
import { bodyColor } from './visuals/colors'

/**
 * Text above a body on the map: name + what is already collected (bio x/N, DSS ✓), a fuchsia book
 * with a count when species there would be new to your codex (faint and dashed while only
 * predicted), and a violet database icon when the data comes from Spansh / EDSM rather than
 * your own scan.
 * Becomes a compact card while hovered. The culler places it (--tx/--ty) and hides it.
 */
export function MapLabel({
  node,
  card,
  selected,
  current,
  left = false,
  gameTarget = false,
  routeTarget = null,
  priority,
  registry,
  onSelect,
}: {
  node: MapNode
  card: boolean
  selected: boolean
  current: boolean
  /** The ship was last here and flew off (the last known place). */
  left?: boolean
  /** Targeted in the game. */
  gameTarget?: boolean
  /** The stored route counts on this body. */
  routeTarget?: RouteTarget | null
  priority: number
  /** Passed explicitly: drei <Html> renders into its own React root (no map context there). */
  registry: MapRegistry
  onSelect: (node: MapNode) => void
}) {
  const body = node.body
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) registry.labels.set(node.id, { node, el, priority })
      else registry.labels.delete(node.id)
    },
    [node, priority, registry],
  )

  const dot = body ? bodyColor(body.visual, body.kind) : '#71717a'
  const marker = body ? sourceMarker(body) : null
  const name = body ? bodyLabel(body) : '?'
  const codex = body ? bodyCodex(body) !== null : false
  const progress = hasChips(node)
  const tone =
    selected || card
      ? 'text-white ring-white/25 bg-zinc-950/85'
      : body?.done && body.kind === 'planet'
        ? 'text-zinc-300 ring-white/10 bg-zinc-950/60'
        : node.interest === 'high'
          ? 'text-zinc-50 ring-white/15 bg-zinc-950/70'
          : node.kind === 'placeholder'
            ? 'text-zinc-500 ring-0 border border-dashed border-zinc-500/50 bg-zinc-950/40'
            : node.interest === 'medium' || node.kind === 'star'
              ? 'text-zinc-200 ring-white/10 bg-zinc-950/60'
              : 'text-zinc-400 ring-white/10 bg-zinc-950/60'

  return (
    <div
      ref={ref}
      data-hidden="true"
      className="absolute top-0 left-0 [transform:translate(var(--tx,-50%),var(--ty,-100%))] opacity-100 transition-[opacity,visibility] duration-200 motion-reduce:transition-none data-[hidden=true]:invisible data-[hidden=true]:opacity-0"
    >
      {card ? (
        <Card node={node} current={current} left={left} gameTarget={gameTarget} routeTarget={routeTarget} />
      ) : (
        <button
          type="button"
          disabled={!body}
          tabIndex={body ? 0 : -1}
          onClick={(e) => {
            // Handled here: the click must not reach the map's event source (a miss / a body behind).
            e.stopPropagation()
            onSelect(node)
          }}
          className={`focus-ring pointer-events-auto flex h-6 items-center gap-1.5 rounded-full py-0.5 pr-0.5 pl-2 text-[12px] leading-none font-medium whitespace-nowrap shadow-lg ring-1 shadow-black/40 backdrop-blur-sm transition-colors ring-inset ${tone} ${body ? 'cursor-pointer hover:bg-zinc-900/90' : 'cursor-default'}`}
        >
          {current ? (
            <MapPin className="size-3.5 shrink-0 text-accent" strokeWidth={2.5} aria-label={t.system.youAreHere} />
          ) : left ? (
            <MapPin className="size-3.5 shrink-0 text-zinc-500" strokeWidth={2.5} aria-label={t.map.lastSeen} />
          ) : (
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />
          )}
          <span className="proportional-nums">{name}</span>
          {gameTarget && (
            <Crosshair className="size-3.5 shrink-0 text-accent" strokeWidth={2.5} aria-label={t.map.gameTarget}>
              <title>{t.map.gameTarget}</title>
            </Crosshair>
          )}
          {routeTarget && (
            <Route
              className={`size-3.5 shrink-0 ${routeTarget === 'done' ? 'text-zinc-500' : 'text-accent'}`}
              strokeWidth={2.5}
              aria-label={routeTarget === 'done' ? t.badges.routeTargetDone : t.badges.routeTarget}
            >
              <title>{routeTarget === 'done' ? t.badges.routeTargetDone : t.badges.routeTarget}</title>
            </Route>
          )}
          {marker?.scope === 'body' && <SourceIcon marker={marker} />}
          {body?.done && <CircleCheck className="-ml-0.5 size-3.5 shrink-0 text-emerald-400" strokeWidth={2.5} aria-hidden />}
          {/* Chips end flush with the pill; text and icons get a little room on the right. */}
          {body && (progress || codex) ? (
            <span className="inline-flex items-center gap-1">
              {progress && <BodyProgress body={body} size="xs" />}
              {codex && <CodexMark body={body} size="xs" />}
            </span>
          ) : (
            <span className="-ml-1.5 w-1.5" aria-hidden />
          )}
        </button>
      )}
    </div>
  )
}

function hasChips(node: MapNode): boolean {
  const b = node.body
  if (!b) return false
  return b.signals.bio > 0 || (b.kind === 'planet' && (b.mappedByMe || b.worthMapping))
}

function Card({
  node,
  current,
  left,
  gameTarget,
  routeTarget,
}: {
  node: MapNode
  current: boolean
  left: boolean
  gameTarget: boolean
  routeTarget: RouteTarget | null
}) {
  const body = node.body
  if (!body) {
    return (
      <div className="w-max max-w-56 rounded-xl bg-zinc-950/85 px-3 py-2 text-sm text-zinc-400 shadow-xl ring-1 shadow-black/50 ring-zinc-500/30 backdrop-blur-md ring-inset">
        <span className="font-semibold text-zinc-200">?</span> · {t.map.unknownBody}
      </div>
    )
  }
  const marker = sourceMarker(body)
  const carto = body.kind === 'planet' && body.dssValue > 0 ? body.dssValue : body.fssValue
  const cartoLabel = body.kind === 'planet' && body.dssValue > 0 ? t.system.dss : t.system.fss
  const mapTone = body.worthMapping && !body.mappedByMe ? 'text-emerald-300' : 'text-zinc-200'
  const bio = bioLeft(body)
  return (
    <div className="pointer-events-none w-60 rounded-xl bg-zinc-950/88 p-3 shadow-2xl ring-1 shadow-black/60 ring-white/12 backdrop-blur-md ring-inset">
      <div className="flex items-baseline gap-2">
        <span
          className="size-2 shrink-0 translate-y-[-1px] self-center rounded-full"
          style={{ background: bodyColor(body.visual, body.kind) }}
          aria-hidden
        />
        <span className="min-w-0 truncate text-[15px] font-semibold text-zinc-50 proportional-nums">{bodyLabel(body)}</span>
        {body.done && <CircleCheck className="size-4 shrink-0 self-center text-emerald-400" aria-hidden />}
        <span className="ml-auto shrink-0 text-xs text-zinc-500">{formatLs(body.distanceLs)}</span>
      </div>
      <div className="mt-0.5 truncate text-xs text-zinc-400">{body.subtype}</div>
      {marker && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug whitespace-pre-line text-violet-200">
          <CommunityGlyph className="mt-px size-3.5" />
          <span className="min-w-0">{marker.title}</span>
        </p>
      )}
      {(current || left || gameTarget || routeTarget) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs font-medium text-accent">
          {current && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {t.system.youAreHere}
            </span>
          )}
          {left && (
            <span className="inline-flex items-center gap-1 text-zinc-400">
              <MapPin className="size-3.5" aria-hidden />
              {t.map.lastSeen}
            </span>
          )}
          {gameTarget && (
            <span className="inline-flex items-center gap-1">
              <Crosshair className="size-3.5" aria-hidden />
              {t.map.gameTarget}
            </span>
          )}
          {routeTarget && (
            <span className={`inline-flex items-center gap-1 ${routeTarget === 'done' ? 'text-zinc-500' : ''}`}>
              <Route className="size-3.5" aria-hidden />
              {routeTarget === 'done' ? t.badges.routeTargetDone : t.badges.routeTarget}
            </span>
          )}
        </div>
      )}
      {hasChips(node) && (
        <div className="mt-2">
          <BodyProgress body={body} size="sm" />
        </div>
      )}
      <CodexLine body={body} className="mt-2" />
      <dl className="mt-2.5 flex items-end gap-4 border-t border-white/8 pt-2">
        <div>
          <dt className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{cartoLabel}</dt>
          <dd className={`text-sm font-semibold ${mapTone}`}>
            <Credits value={carto} />
          </dd>
        </div>
        {body.bioValueMax > 0 && (
          <div>
            <dt className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase">{t.system.bio}</dt>
            <dd className="text-sm font-semibold text-emerald-300">
              <CreditRange min={bio.min} max={bio.max} />
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

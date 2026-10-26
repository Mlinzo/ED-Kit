// The Surface tab's planet globe with what goes around it: the layers and where each comes from,
// the card of the chosen mark (distance and heading from you, bookmark it), your bookmarks (a tap on
// the ground marks a spot), other players' finds (Canonn).

import { BookmarkPlus, Check, Database, LocateFixed, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BodyView, BookmarkCategory, GlobeView, LiveStatus } from '../../../api/types'
import { BookmarkBox } from '../../../components/Bookmark'
import { coords as formatCoords, type BookmarkTarget } from '../../../components/bookmarks'
import { Label } from '../../../components/States'
import { sourceDate } from '../../../components/source'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { t } from '../../../i18n'
import { formatDegrees, formatMeters } from '../../../lib/format'
import { bearingDeg, haversineM, type LatLon } from '../../../lib/geo'
import { writeStored, readStoredText } from '../../../lib/storage'
import { GlobeMap } from '.'
import type { GlobeFocus } from './GlobeCanvas'
import {
  LAYERS,
  LAYER_STYLE,
  SHIP_COLOR,
  YOU_COLOR,
  globePoints,
  layerCounts,
  pathLengthM,
  pathLines,
  sourceLabel,
  type GlobePoint,
  type LayerId,
} from './layers'

const HIDDEN_KEY = 'edk.globe.hidden'
/** On the ground the globe comes down this high over you: ~2.5 km around you in view. */
const GROUND_HEIGHT_M = 4_000

function readHidden(): Set<LayerId> {
  const stored = readStoredText(HIDDEN_KEY)?.split(',') ?? []
  return new Set(LAYERS.filter((l) => stored.includes(l)))
}

type Here = LatLon & { heading: number | null }

/** Where you are on this planet now (Status.json), or null. */
function hereOn(globe: GlobeView, status: LiveStatus | null): Here | null {
  if (!status?.hasLatLong || status.lat === null || status.lon === null || status.bodyName !== globe.bodyName) return null
  return { lat: status.lat, lon: status.lon, heading: status.heading }
}

/** Where the globe first looks: you, your ship, your latest mark here, someone's find, 0/0. */
function firstLook(globe: GlobeView, here: Here | null): LatLon {
  if (here) return here
  const ship = globe.ship
  if (ship && ship.lat !== null && ship.lon !== null) return { lat: ship.lat, lon: ship.lon }
  const latest = [...globe.marks].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0]
  if (latest) return latest
  const someone = globe.community[0]?.points[0]
  return someone ? { lat: someone[0], lon: someone[1] } : { lat: 0, lon: 0 }
}

function Dot({ color, className = 'size-2.5' }: { color: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ring-1 ring-black/40 ${className}`} style={{ background: color }} aria-hidden />
}

function coords(p: LatLon): string {
  return formatCoords(p.lat, p.lon)
}

/** The system of a body: the low 55 bits of its id64. */
function systemAddressOf(body: BodyView): string {
  return (BigInt(body.id64) & ((1n << 55n) - 1n)).toString()
}

/** What a bookmark of a spot on this planet marks. */
function spotTarget(body: BodyView, globe: GlobeView, spot: LatLon, title: string | null = null): BookmarkTarget {
  return { kind: 'place', systemAddress: systemAddressOf(body), bodyId: body.bodyId, bodyName: globe.bodyName, lat: spot.lat, lon: spot.lon, title }
}

/** The tag a bookmark of a mark starts with: biology for samples and life, geology for geology. */
function suggestedTag(point: GlobePoint): BookmarkCategory {
  if (point.layer === 'samples') return 'bio'
  if (point.layer === 'community') return point.detail === 'Biology' ? 'bio' : point.detail === 'Geology' ? 'geo' : 'other'
  return 'other'
}

/** Marks with a name worth keeping as the bookmark's name (not "Landing", not your ship). */
const NAMED: ReadonlySet<GlobePoint['layer']> = new Set(['samples', 'codex', 'settlements', 'community'])

/** The distance and heading from you to a point, or why there is none. */
function FromYou({ here, point, radiusM }: { here: Here | null; point: LatLon; radiusM: number }) {
  return (
    <p className="mt-3 text-sm">
      {here ? (
        <span className="font-semibold text-zinc-100 tabular-nums">
          {t.globe.fromYou(formatMeters(haversineM(here, point, radiusM)), formatDegrees(bearingDeg(here, point)))}
        </span>
      ) : (
        <span className="text-zinc-500">{t.globe.noYou}</span>
      )}
    </p>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      title={t.globe.close}
      aria-label={t.globe.close}
      className="focus-ring -mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
    >
      <X className="size-4" aria-hidden />
    </button>
  )
}

/** A spot you tapped on the ground (or where you are): its place, and bookmarking it. */
function SpotCard({
  spot,
  here,
  body,
  globe,
  editing,
  onClose,
}: {
  spot: LatLon
  here: Here | null
  body: BodyView
  globe: GlobeView
  /** Opened straight in the editor; closes with it. */
  editing: boolean
  onClose: () => void
}) {
  return (
    <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800" aria-live="polite">
      <div className="flex items-start gap-3">
        <Dot color={LAYER_STYLE.bookmarks.color} className="mt-1.5 size-3" />
        <p className="min-w-0 flex-1 font-semibold break-words text-zinc-50 tabular-nums">{t.bookmarks.spot(coords(spot))}</p>
        <CloseButton onClose={onClose} />
      </div>
      <FromYou here={here} point={spot} radiusM={globe.radiusM} />
      <BookmarkBox
        key={coords(spot)}
        bookmark={null}
        target={spotTarget(body, globe, spot)}
        onClose={editing ? onClose : undefined}
        className="mt-3"
      />
    </div>
  )
}

function MarkCard({
  point,
  others,
  here,
  body,
  globe,
  onChoose,
  onClose,
}: {
  point: GlobePoint
  others: GlobePoint[]
  here: Here | null
  body: BodyView
  globe: GlobeView
  onChoose: (p: GlobePoint) => void
  onClose: () => void
}) {
  const radiusM = globe.radiusM
  const style = LAYER_STYLE[point.layer]
  const community = point.layer === 'community'
  const date = sourceDate(point.at, true)
  return (
    <div className="rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800" aria-live="polite">
      <div className="flex items-start gap-3">
        <Dot color={style.color} className="mt-1.5 size-3" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words text-zinc-50">{point.title}</p>
          {point.detail && <p className="mt-0.5 text-sm text-zinc-400">{point.detail}</p>}
          <p className={`mt-1 flex items-center gap-1.5 text-xs ${community ? 'text-violet-300' : 'text-zinc-500'}`}>
            {community && <Database className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />}
            <span>
              {sourceLabel(style.source)}
              {date && ` · ${date}`}
            </span>
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <FromYou here={here} point={point} radiusM={radiusM} />
      <p className="mt-1 text-xs text-zinc-500 tabular-nums">{coords(point)}</p>
      <BookmarkBox
        key={point.id}
        bookmark={point.bookmark ?? null}
        target={spotTarget(body, globe, point, NAMED.has(point.layer) ? point.title : null)}
        suggest={suggestedTag(point)}
        compact
        className="mt-3"
      />
      {others.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <p className="text-xs text-zinc-500">{t.globe.nearby(others.length)}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {others.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onChoose(o)}
                  className="focus-ring flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-800/70 px-2.5 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  <Dot color={LAYER_STYLE[o.layer].color} className="size-2" />
                  <span className="break-words">{o.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Legend({
  globe,
  here,
  hidden,
  onToggle,
}: {
  globe: GlobeView
  here: Here | null
  hidden: Set<LayerId>
  onToggle: (layer: LayerId) => void
}) {
  const counts = layerCounts(globe)
  const ship = globe.ship
  const row = 'flex min-h-11 items-start gap-2.5 rounded-xl px-3 py-2 text-left ring-1 ring-inset'
  return (
    <section aria-label={t.globe.layers}>
      <Label as="h2">{t.globe.layers}</Label>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {here && (
          <li className={`${row} bg-zinc-900/40 ring-zinc-800`}>
            <Dot color={YOU_COLOR} className="mt-1 size-2.5" />
            <span className="min-w-0 text-sm">
              <span className="block font-medium text-zinc-100">{t.globe.layer.you}</span>
              <span className="block text-xs text-zinc-500">{t.globe.from.live}</span>
            </span>
          </li>
        )}
        {ship && (
          <li className={`${row} bg-zinc-900/40 ring-zinc-800`}>
            <Dot color={SHIP_COLOR} className="mt-1 size-2.5" />
            <span className="min-w-0 text-sm">
              <span className="block font-medium text-zinc-100">
                {t.globe.layer.ship} <span className="font-normal text-zinc-400">· {t.globe.ship[ship.state]}</span>
              </span>
              <span className="block text-xs text-zinc-500">{t.globe.from.journal}</span>
            </span>
          </li>
        )}
        {LAYERS.filter((l) => counts[l] > 0).map((layer) => {
          const on = !hidden.has(layer)
          const style = LAYER_STYLE[layer]
          return (
            <li key={layer}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(layer)}
                className={`focus-ring w-full ${row} transition-colors ${
                  on ? 'bg-zinc-900/60 ring-zinc-700 hover:bg-zinc-800/70' : 'bg-transparent ring-zinc-800 opacity-60 hover:opacity-90'
                }`}
              >
                <Dot color={on ? style.color : 'transparent'} className="mt-1 size-2.5" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-zinc-100">
                    {t.globe.layer[layer]}{' '}
                    <span className="font-normal text-zinc-400 tabular-nums">
                      · {layer === 'track' ? formatMeters(pathLengthM(globe)) : counts[layer]}
                    </span>
                  </span>
                  <span className={`block text-xs ${style.source === 'community' ? 'text-violet-300' : 'text-zinc-500'}`}>
                    {sourceLabel(style.source)}
                  </span>
                </span>
                {on && <Check className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CommunityFindsList({
  globe,
  find,
  onFind,
}: {
  globe: GlobeView
  find: string | null
  onFind: (name: string | null) => void
}) {
  const state = globe.communityState
  const points = globe.community.reduce((n, f) => n + f.points.length, 0)
  const date = sourceDate(globe.communityAt)
  const status =
    state === 'loading'
      ? t.globe.community.loading
      : state === 'failed'
        ? t.globe.community.failed
        : state === 'off'
          ? t.globe.community.off
          : globe.community.length === 0
            ? t.globe.community.none
            : `${t.globe.community.summary(globe.community.length, points)}${date ? ` · ${t.source.updated(date)}` : ''}`
  return (
    <section aria-labelledby="globe-community">
      <Label as="h2" id="globe-community" className="flex items-center gap-1.5">
        <Database className="size-3.5 text-violet-300" strokeWidth={2.25} aria-hidden />
        {t.globe.layer.community}
      </Label>
      <p className="mt-1.5 text-sm text-zinc-400">{status}</p>
      {globe.community.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {globe.community.map((f) => {
            const chosen = find === f.name
            return (
              <li key={`${f.category}:${f.name}`}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  title={t.globe.community.filter}
                  onClick={() => onFind(chosen ? null : f.name)}
                  className={`focus-ring flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 transition-colors ring-inset ${
                    chosen ? 'bg-violet-500/15 ring-violet-400/40' : 'bg-zinc-900/40 ring-zinc-800 hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium break-words text-zinc-100">{f.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {f.category !== 'Biology' && `${f.category} · `}
                      {t.globe.community.points(f.points.length)}
                    </span>
                  </span>
                  {f.yours && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-300">
                      <Check className="size-3.5" aria-hidden />
                      {t.globe.community.yours}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {find !== null && (
        <button
          type="button"
          onClick={() => onFind(null)}
          className="focus-ring mt-2 inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-violet-200 hover:bg-violet-500/10"
        >
          {t.globe.community.showAll}
        </button>
      )}
      {state === 'ok' && <p className="mt-2 text-xs text-zinc-500">{t.globe.community.hint}</p>}
    </section>
  )
}

export function PlanetGlobe({ globe, body, status }: { globe: GlobeView; body: BodyView; status: LiveStatus | null }) {
  const coarse = useMediaQuery('(pointer: coarse)')
  const here = hereOn(globe, status)
  const [hidden, setHidden] = useState(readHidden)
  const [find, setFind] = useState<string | null>(null)
  const [picked, setPickedState] = useState<string[]>([])
  // A spot on the ground: tapped (its card offers a bookmark), or where you are (its editor opens).
  const [spot, setSpot] = useState<{ at: LatLon; editing: boolean } | null>(null)
  const setPicked = (ids: string[]) => {
    setPickedState(ids)
    if (ids.length > 0) setSpot(null)
  }
  // Landed, on foot or in the SRV here: the globe looks at you from close by, at once or as you land.
  const grounded = here !== null && Boolean(status?.landed || status?.onFoot || status?.inSrv)
  const [focus, setFocus] = useState<GlobeFocus>(() =>
    grounded ? { ...firstLook(globe, here), heightM: GROUND_HEIGHT_M } : firstLook(globe, here),
  )
  const [wasGrounded, setWasGrounded] = useState(grounded)
  if (grounded !== wasGrounded) {
    setWasGrounded(grounded)
    if (grounded && here) setFocus({ lat: here.lat, lon: here.lon, heightM: GROUND_HEIGHT_M })
  }

  const all = useMemo(() => globePoints(globe, find), [globe, find])
  const hereLat = here?.lat
  const hereLon = here?.lon
  const path = useMemo(() => {
    if (hidden.has('track')) return []
    return pathLines(globe, hereLat !== undefined && hereLon !== undefined ? { lat: hereLat, lon: hereLon } : null)
  }, [globe, hidden, hereLat, hereLon])
  const shown = useMemo(() => all.filter((p) => p.layer === 'ship' || !hidden.has(p.layer)), [all, hidden])
  const pickedPoints = picked.map((id) => shown.find((p) => p.id === id)).filter((p): p is GlobePoint => Boolean(p))
  const spotPoint = useMemo<GlobePoint | null>(
    () => (spot ? { id: 'spot', layer: 'bookmarks', lat: spot.at.lat, lon: spot.at.lon, title: '', detail: null, at: null } : null),
    [spot],
  )
  const selected = pickedPoints[0] ?? spotPoint

  const toggle = (layer: LayerId) => {
    const next = new Set(hidden)
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    setHidden(next)
    writeStored(HIDDEN_KEY, [...next].join(','))
  }

  const choose = (p: GlobePoint) => {
    setPicked([p.id, ...picked.filter((id) => id !== p.id)])
    setFocus({ lat: p.lat, lon: p.lon })
  }

  const chooseFind = (name: string | null) => {
    setFind(name)
    if (name === null) return
    if (hidden.has('community')) toggle('community')
    // The point of that find nearest to you (or its first one) is chosen and turned to.
    const pts = globePoints(globe, name).filter((p) => p.layer === 'community')
    const nearest = here
      ? pts.reduce<GlobePoint | null>((n, p) => (!n || haversineM(here, p, 1) < haversineM(here, n, 1) ? p : n), null)
      : pts[0]
    if (nearest) {
      setPicked([nearest.id])
      setFocus({ lat: nearest.lat, lon: nearest.lon })
    }
  }

  return (
    <div className="space-y-5">
      <div className="relative">
        <div className="mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-9rem))]">
          <GlobeMap
            className="h-full w-full"
            visual={body.visual}
            seed={body.bodyId}
            radiusM={globe.radiusM}
            points={shown}
            path={path}
            here={here}
            selected={selected}
            onPick={setPicked}
            onGround={(at) => setSpot(at ? { at, editing: false } : null)}
            focus={focus}
            label={t.globe.label(globe.bodyName)}
          />
        </div>
        {here && (
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setFocus({ lat: here.lat, lon: here.lon })}
              title={t.globe.toYou}
              aria-label={t.globe.toYou}
              className="focus-ring flex size-10 items-center justify-center rounded-xl bg-zinc-950/60 text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm ring-inset hover:bg-zinc-900/80 hover:text-zinc-50 lg:size-9"
            >
              <LocateFixed className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setPickedState([])
                setSpot({ at: { lat: here.lat, lon: here.lon }, editing: true })
              }}
              title={t.bookmarks.bookmarkHere}
              aria-label={t.bookmarks.bookmarkHere}
              className="focus-ring flex size-10 items-center justify-center rounded-xl bg-zinc-950/60 text-amber-200 ring-1 ring-white/10 backdrop-blur-sm ring-inset hover:bg-zinc-900/80 hover:text-amber-100 lg:size-9"
            >
              <BookmarkPlus className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        {coarse ? t.globe.hintTouch : t.globe.hintMouse} · {t.bookmarks.spotHint}
        <br />
        {t.globe.unreal}
      </p>

      {pickedPoints[0] && (
        <MarkCard
          point={pickedPoints[0]}
          others={pickedPoints.slice(1, 6)}
          here={here}
          body={body}
          globe={globe}
          onChoose={choose}
          onClose={() => setPicked([])}
        />
      )}
      {spot && !pickedPoints[0] && (
        <SpotCard spot={spot.at} here={here} body={body} globe={globe} editing={spot.editing} onClose={() => setSpot(null)} />
      )}
      <Legend globe={globe} here={here} hidden={hidden} onToggle={toggle} />
      <CommunityFindsList globe={globe} find={find} onFind={chooseFind} />
    </div>
  )
}

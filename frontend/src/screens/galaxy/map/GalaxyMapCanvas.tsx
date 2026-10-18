// The galaxy map (lazy chunk): every system you visited on a sketch of the galaxy, your path,
// where you died, the routes ahead, the codex regions and, when asked, other players right now
// (EDDN). Hover names a system; a click opens yours on the System tab, copies another's name.

import { Canvas, useThree } from '@react-three/fiber'
import { Crosshair, Flag, Globe, Layers, Map as MapIcon, MapPin, Maximize2, Radio, Wrench } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Vector3 } from 'three'
import { useView } from '../../../api/hooks'
import type { GalaxyView, LiveView } from '../../../api/types'
import { Credits } from '../../../components/Credits'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { t } from '../../../i18n'
import { copyText } from '../../../lib/clipboard'
import { formatCredits, formatDateTime, formatLy, formatNumber } from '../../../lib/format'
import { readStored, writeStored } from '../../../lib/storage'
import { MapButton } from '../../../map/MapButton'
import { Ticker } from '../../../map/Ticker'
import { YOU_COLOR } from '../../route/map/colors'
import { pickNearest, type Projected, type Vec3 } from '../../route/map/geometry'
import { Anchor, LabelPlacer, PILL, type LabelEntry } from '../../route/map/labels'
import { Marker } from '../../route/map/layers'
import { RouteCamera, type RouteCameraApi } from '../../route/map/RouteCamera'
import { PickStore, usePick } from '../../route/map/store'
import { at, buildGalaxyScene, FOCUS_DISTANCE, GALAXY_LIMITS, GALAXY_RANGE, LANDMARKS, RING_STEP_LY, type GalaxyScene } from './geometry'
import { DEATH_COLOR, DOT_COLOR, ENGINEER_COLOR, LIVE_COLOR, PATH_NEW, PATH_OLD, PLOTTED_COLOR, REGION_LINE, ROUTE_COLOR, START_COLOR } from './colors'
import { EngineerMarks } from './engineerLayer'
import { buildEngineerPoints, type EngineerPoint } from './engineers'
import { Backdrop, Deaths, LandmarkMarks, Paths, Routes, Rings, StartMark, SystemDots } from './layers'
import { buildLivePoints, type LivePoint } from './live'
import { LiveDots } from './liveLayer'
import { RegionLayer } from './regionLayer'
import { regionAt, regionBounds, type RegionGrid } from './regions'
import { useRegionMap, type RegionMap } from './useRegionMap'

export interface GalaxyMapProps {
  view: GalaxyView
  onOpenSystem: (address: string) => void
  /** Frame this codex region (a new nonce frames it again). */
  focusRegion?: { id: number; nonce: number } | null
  className?: string
}

const REGIONS_KEY = 'edk.galaxyRegions'
const LIVE_KEY = 'edk.galaxyLive'
const ENGINEERS_KEY = 'edk.galaxyEngineers'
const NO_ENGINEERS: readonly EngineerPoint[] = []

/** A dot that is not one of your systems (another player's, an engineer's): a click copies its system's name. */
interface OtherPoint {
  key: string
  pos: Vec3
  size: number
  copy: string
}
/** While the layer is on, ask at least this often: the server hangs up on EDDN when nobody asks. */
const LIVE_KEEPALIVE_MS = 45_000
const NO_LIVE: readonly LivePoint[] = []

/** What the region layer shows: the grid, and which regions you have been to. */
interface RegionsShown {
  map: RegionMap
  visited: number[]
  here: number | null
  selected: number | null
}

/** Everything drawn depends on this: refetches that change nothing visible keep the scene. */
function sceneKey(view: GalaxyView): string {
  return JSON.stringify([
    view.systems.map((s) => [s.address, s.x, s.y, s.z, s.value, s.firsts]),
    view.path,
    view.current,
    view.deaths.map((d) => d.system),
    view.route,
    view.plotted,
  ])
}

function useScene(view: GalaxyView): GalaxyScene {
  const key = useMemo(() => sceneKey(view), [view])
  const [built, setBuilt] = useState(() => ({ key, scene: buildGalaxyScene(view) }))
  if (built.key !== key) {
    const next = { key, scene: buildGalaxyScene(view) }
    setBuilt(next)
    return next.scene
  }
  return built.scene
}

const isOnLabel = (e: PointerEvent) => e.target instanceof Element && e.target.closest('[data-map-label]') !== null

/**
 * Hover and click on the dots, picked on screen: your systems first (their addresses in the
 * store), then other players' (their `live:` keys).
 */
function Picking({
  scene,
  others,
  store,
  onOpen,
  onCopy,
}: {
  scene: GalaxyScene
  others: readonly OtherPoint[]
  store: PickStore
  onOpen: (address: string) => void
  onCopy: (name: string) => void
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined
  const invalidate = useThree((s) => s.invalidate)
  const sceneRef = useRef(scene)
  const othersRef = useRef(others)
  useLayoutEffect(() => {
    sceneRef.current = scene
    othersRef.current = others
  }, [scene, others])

  useEffect(() => {
    const el = connected ?? gl.domElement
    const v = new Vector3()
    // The nearest dot under the pointer, yours or another's; yours on a tie (listed last).
    const pick = (e: PointerEvent): string | null => {
      const items = [...othersRef.current, ...sceneRef.current.systems.map((s) => ({ key: s.address, pos: s.pos, size: s.size }))]
      const r = gl.domElement.getBoundingClientRect()
      const dots = items.map<Projected | null>((s) => {
        v.set(s.pos[0], s.pos[1], s.pos[2]).project(camera)
        if (v.z < -1 || v.z > 1) return null
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, radius: Math.max(4, s.size / 2) }
      })
      const i = pickNearest(dots, e.clientX - r.left, e.clientY - r.top, 4)
      return i < 0 ? null : items[i].key
    }
    const hover = (address: string | null) => {
      if (store.get().hovered === address) return
      store.set({ hovered: address })
      el.style.cursor = address ? 'pointer' : ''
      invalidate()
    }
    let down: [number, number] | null = null
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.buttons !== 0) return
      hover(isOnLabel(e) ? null : pick(e))
    }
    const onDown = (e: PointerEvent) => {
      down = e.button !== 0 || isOnLabel(e) ? null : [e.clientX, e.clientY]
    }
    const onUp = (e: PointerEvent) => {
      const start = down
      down = null
      if (!start || isOnLabel(e) || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return
      const key = pick(e)
      const other = key ? othersRef.current.find((p) => p.key === key) : undefined
      // A finger has no hover: a tap on a dot that is not yours shows its card instead.
      if (e.pointerType === 'touch' && (other || !key)) hover(other && store.get().hovered !== other.key ? other.key : null)
      else if (other) onCopy(other.copy)
      else if (key) onOpen(key)
    }
    const onLeave = () => hover(null)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onLeave)
      el.style.cursor = ''
    }
  }, [camera, connected, gl, invalidate, onOpen, onCopy, store])
  return null
}

/** Region names last: the ones you have been to first, yours before them. */
const PRIORITY = { hover: 60, you: 50, start: 45, landmark: 30, regionHere: 24, regionVisited: 20, region: 10 }

function HoverCard({ view, index }: { view: GalaxyView; index: number }) {
  const s = view.systems[index]
  const deaths = view.deaths.filter((d) => d.system === index)
  const region = s.region !== null ? view.regions.find((r) => r.id === s.region) : undefined
  const facts = [
    t.galaxy.map.visits(s.visits),
    s.firsts > 0 ? t.galaxy.map.firstsCount(s.firsts) : null,
    s.species > 0 ? t.galaxy.map.species(s.species) : null,
  ].filter(Boolean)
  return (
    <div className="pointer-events-none w-64 rounded-xl bg-zinc-950/90 p-3 shadow-2xl ring-1 shadow-black/60 ring-white/12 backdrop-blur-md ring-inset">
      <p className="truncate text-sm font-semibold text-zinc-50">{s.name}</p>
      <p className="mt-1 text-xs text-zinc-400">
        {facts.join(' · ')}
        <span className="block text-zinc-500">{t.galaxy.map.fromSol(formatLy(Math.hypot(s.x, s.y, s.z)))}</span>
        {region && <span className="block truncate text-zinc-500">{region.name}</span>}
      </p>
      {s.value > 0 && <Credits value={s.value} className="mt-1.5 block text-sm font-semibold text-emerald-300" />}
      {s.unsoldValue > 0 && <p className="text-xs text-amber-300">{t.galaxy.map.unsold(formatCredits(s.unsoldValue))}</p>}
      {deaths.map((d, i) => (
        <p key={i} className="mt-1.5 text-xs text-rose-300">
          {t.galaxy.map.died}
          {d.killers.length > 0 && ` ${t.galaxy.map.killedBy(d.killers.join(', '))}`}
          {d.lostValue > 0 && <span className="text-rose-300/70"> · {t.galaxy.map.lost(formatCredits(d.lostValue))}</span>}
        </p>
      ))}
      <p className="mt-2 border-t border-white/8 pt-2 text-[11px] text-zinc-500">{t.galaxy.map.open}</p>
    </div>
  )
}

/** Region names over their regions: brighter where you have been, brightest where you are. */
function regionLabels(regions: RegionsShown, entries: Map<string, LabelEntry>, layer: RefObject<HTMLElement>, positions: Map<number, Vec3>): ReactNode[] {
  const visited = new Set(regions.visited)
  return regions.map.labels.map((l) => {
    const here = l.id === regions.here
    const priority = here ? PRIORITY.regionHere : visited.has(l.id) ? PRIORITY.regionVisited : PRIORITY.region
    const tone = here ? 'text-sky-100/90' : visited.has(l.id) ? 'text-sky-200/65' : 'text-slate-300/40'
    return (
      <Anchor key={`region:${l.id}`} id={`region:${l.id}`} pos={positions.get(l.id)!} priority={priority} lift={0} centered entries={entries} layer={layer}>
        <span className={`block text-[10px] leading-none font-semibold tracking-[0.16em] whitespace-nowrap uppercase ${tone}`}>
          {regions.map.grid.names[l.id - 1]}
        </span>
      </Anchor>
    )
  })
}

/** An engineer: where, what they work on, how far you are with them. */
function EngineerCard({ point, from }: { point: EngineerPoint; from: { x: number; y: number; z: number } | null }) {
  const e = point.engineer
  const standing = e.progress
    ? [t.galaxy.engineers.progress[e.progress], e.progress === 'unlocked' && e.rank ? t.galaxy.engineers.rank(e.rank) : null].filter(Boolean).join(', ')
    : t.galaxy.engineers.unknown
  const tone = e.progress === 'unlocked' ? 'text-emerald-300' : e.progress ? 'text-zinc-300' : 'text-zinc-500'
  return (
    <div className="pointer-events-none w-64 rounded-xl bg-zinc-950/90 p-3 shadow-2xl ring-1 shadow-black/60 ring-white/12 backdrop-blur-md ring-inset">
      <p className="truncate text-sm font-semibold text-zinc-50">{e.name}</p>
      <p className="mt-0.5 text-xs" style={{ color: ENGINEER_COLOR }}>
        {e.kind === 'ship' ? t.galaxy.engineers.ship : t.galaxy.engineers.suit}
      </p>
      <p className="mt-1.5 truncate text-xs text-zinc-300">
        {e.base} · {e.system}
      </p>
      {from && <p className="text-xs text-zinc-500">{t.galaxy.engineers.away(formatLy(Math.hypot(e.x - from.x, e.y - from.y, e.z - from.z)))}</p>}
      <p className={`mt-1.5 text-xs ${tone}`}>{standing}</p>
      <p className="mt-2 border-t border-white/8 pt-2 text-[11px] text-zinc-500 pointer-coarse:hidden">{t.galaxy.engineers.copy}</p>
    </div>
  )
}

/** Another player's system: how we know someone was there (never who). */
function LiveCard({ point, grid }: { point: LivePoint; grid: RegionGrid | null }) {
  const s = point.system
  const region = grid ? regionAt(grid, s.x, s.z) : null
  const how = [
    s.arrived > 0 ? t.galaxy.live.arrived(s.arrived) : null,
    s.scans > 0 ? t.galaxy.live.scans(s.scans) : null,
    s.docked > 0 ? t.galaxy.live.docked(s.docked) : null,
    s.carriers > 0 ? t.galaxy.live.carriers(s.carriers) : null,
  ].filter(Boolean)
  return (
    <div className="pointer-events-none w-64 rounded-xl bg-zinc-950/90 p-3 shadow-2xl ring-1 shadow-black/60 ring-white/12 backdrop-blur-md ring-inset">
      <p className="truncate text-sm font-semibold text-zinc-50">{s.name}</p>
      <p className="mt-1 text-xs" style={{ color: LIVE_COLOR }}>
        {t.galaxy.live.players(s.players)} · {s.ageS < 60 ? t.time.justNow : t.time.minutesAgo(Math.floor(s.ageS / 60))}
      </p>
      {grid && region !== null && <p className="truncate text-xs text-zinc-500">{grid.names[region - 1]}</p>}
      {how.length > 0 && (
        <p className="mt-1.5 text-xs text-zinc-400">
          <span className="text-zinc-500">{t.galaxy.live.how} </span>
          {how.join(' · ')}
        </p>
      )}
      {s.codex.length > 0 && <p className="mt-1 text-xs text-amber-200/90">{t.galaxy.live.codex(s.codex.join(', '))}</p>}
      <p className="mt-2 border-t border-white/8 pt-2 text-[11px] text-zinc-500 pointer-coarse:hidden">{t.galaxy.live.copy}</p>
    </div>
  )
}

function Labels({
  view,
  scene,
  store,
  layer,
  hoverLayer,
  regions,
  live,
  engineers,
  grid,
}: {
  view: GalaxyView
  scene: GalaxyScene
  store: PickStore
  layer: RefObject<HTMLElement>
  /** Over the legend and the buttons: the card of what you point at. */
  hoverLayer: RefObject<HTMLElement>
  regions: RegionsShown | null
  live: readonly LivePoint[]
  engineers: readonly EngineerPoint[]
  grid: RegionGrid | null
}) {
  const { hovered } = usePick(store)
  const [entries] = useState(() => new Map<string, LabelEntry>())
  const landmarks = useMemo(() => LANDMARKS.map((l) => ({ ...l, pos: at(l) })), [])
  const labelMap = regions?.map
  const regionPositions = useMemo(() => new Map((labelMap?.labels ?? []).map((l) => [l.id, at({ x: l.x, y: 0, z: l.z })])), [labelMap])
  const byAddress = useMemo(() => new Map(scene.systems.map((s) => [s.address, s])), [scene.systems])
  const hover = hovered ? byAddress.get(hovered) : undefined
  const liveHover = hovered && !hover ? live.find((p) => p.key === hovered) : undefined
  const engineerHover = hovered && !hover && !liveHover ? engineers.find((p) => p.key === hovered) : undefined
  const current = view.current !== null ? view.systems[view.current] : null
  const labels: ReactNode[] = []
  if (hover) {
    labels.push(
      <Anchor key={`hover:${hover.address}`} id={`hover:${hover.address}`} pos={hover.pos} priority={PRIORITY.hover} lift={hover.size / 2 + 8} always beside entries={entries} layer={hoverLayer}>
        <HoverCard view={view} index={hover.index} />
      </Anchor>,
    )
  }
  if (liveHover) {
    labels.push(
      <Anchor key={`hover:${liveHover.key}`} id={`hover:${liveHover.key}`} pos={liveHover.pos} priority={PRIORITY.hover} lift={liveHover.size + 6} always beside entries={entries} layer={hoverLayer}>
        <LiveCard point={liveHover} grid={grid} />
      </Anchor>,
    )
  }
  if (engineerHover) {
    labels.push(
      <Anchor key={`hover:${engineerHover.key}`} id={`hover:${engineerHover.key}`} pos={engineerHover.pos} priority={PRIORITY.hover} lift={engineerHover.size / 2 + 8} always beside entries={entries} layer={hoverLayer}>
        <EngineerCard point={engineerHover} from={current} />
      </Anchor>,
    )
  }
  if (scene.you && current && hover?.index !== view.current) {
    labels.push(
      <Anchor key="you" id="you" pos={scene.you} priority={PRIORITY.you} lift={13} entries={entries} layer={layer}>
        <div className={`${PILL} bg-zinc-950/75 text-emerald-50 ring-emerald-400/40`}>
          <MapPin className="size-3.5 shrink-0" style={{ color: YOU_COLOR }} strokeWidth={2.5} aria-hidden />
          <span className="proportional-nums">{current.name}</span>
        </div>
      </Anchor>,
    )
  }
  const first = scene.start ? view.systems[scene.start.index] : null
  if (scene.start && first && hover?.index !== scene.start.index && scene.start.index !== view.current) {
    labels.push(
      <Anchor key="start" id="start" pos={scene.start.pos} priority={PRIORITY.start} lift={11} entries={entries} layer={layer}>
        <div className={`${PILL} bg-zinc-950/75 text-zinc-100 ring-white/20`}>
          <Flag className="size-3.5 shrink-0" style={{ color: START_COLOR }} aria-hidden />
          <span className="opacity-70">{t.galaxy.map.startLabel(formatDateTime(first.firstVisitAt))}</span>
          <span className="proportional-nums">{first.name}</span>
        </div>
      </Anchor>,
    )
  }
  for (const l of landmarks) {
    labels.push(
      <Anchor key={l.id} id={l.id} pos={l.pos} priority={PRIORITY.landmark} lift={8} entries={entries} layer={layer}>
        <div className={`${PILL} bg-zinc-950/60 text-zinc-300 ring-white/10`}>{l.name}</div>
      </Anchor>,
    )
  }
  if (regions) labels.push(...regionLabels(regions, entries, layer, regionPositions))
  return (
    <>
      {labels}
      <LabelPlacer entries={entries} />
    </>
  )
}

const Scene = memo(function Scene({
  view,
  scene,
  store,
  layer,
  hoverLayer,
  onOpen,
  onCopy,
  registerCamera,
  reducedMotion,
  regions,
  live,
  engineers,
  grid,
}: {
  view: GalaxyView
  scene: GalaxyScene
  store: PickStore
  layer: RefObject<HTMLElement>
  hoverLayer: RefObject<HTMLElement>
  onOpen: (address: string) => void
  onCopy: (name: string) => void
  registerCamera: (api: RouteCameraApi | null) => void
  reducedMotion: boolean
  regions: RegionsShown | null
  live: readonly LivePoint[]
  engineers: readonly EngineerPoint[]
  grid: RegionGrid | null
}) {
  const landmarks = useMemo(() => LANDMARKS.map((l) => at(l)), [])
  const others = useMemo<OtherPoint[]>(
    () => [
      ...live.map((p) => ({ key: p.key, pos: p.pos, size: p.size, copy: p.system.name })),
      ...engineers.map((p) => ({ key: p.key, pos: p.pos, size: p.size, copy: p.engineer.system })),
    ],
    [live, engineers],
  )
  return (
    <>
      {!reducedMotion && <Ticker fps={20} />}
      <Backdrop />
      {regions && <RegionLayer grid={regions.map.grid} visited={regions.visited} here={regions.here} selected={regions.selected} />}
      <Rings />
      <LandmarkMarks points={landmarks} />
      {live.length > 0 && <LiveDots points={live} />}
      {engineers.length > 0 && <EngineerMarks points={engineers} />}
      <Paths scene={scene} flow={!reducedMotion} />
      <Routes scene={scene} />
      <SystemDots scene={scene} />
      <Deaths scene={scene} />
      {scene.start && <StartMark pos={scene.start.pos} />}
      {scene.you && (
        <>
          <Marker pos={scene.you} color={YOU_COLOR} size={18} inner={0.76} order={6} />
          {!reducedMotion && <Marker pos={scene.you} color={YOU_COLOR} size={30} inner={0.9} opacity={0.7} pulse={2.4} order={6} />}
        </>
      )}
      <Hovered scene={scene} others={others} store={store} />
      <Labels view={view} scene={scene} store={store} layer={layer} hoverLayer={hoverLayer} regions={regions} live={live} engineers={engineers} grid={grid} />
      <Picking scene={scene} others={others} store={store} onOpen={onOpen} onCopy={onCopy} />
      <RouteCamera
        frame={scene.travels}
        routeKey="galaxy"
        reducedMotion={reducedMotion}
        register={registerCamera}
        range={GALAXY_RANGE}
        limits={GALAXY_LIMITS}
        focusDistance={FOCUS_DISTANCE}
      />
    </>
  )
})

function Hovered({ scene, others, store }: { scene: GalaxyScene; others: readonly OtherPoint[]; store: PickStore }) {
  const { hovered } = usePick(store)
  const s = hovered ? (scene.systems.find((x) => x.address === hovered) ?? others.find((p) => p.key === hovered)) : undefined
  return s ? <Marker pos={s.pos} color="#ffffff" size={s.size + 9} inner={0.76} opacity={0.8} order={7} /> : null
}

function Legend({ regions, live, engineers }: { regions: boolean; live: boolean; engineers: boolean }) {
  const dot = (color: string, hollow = false) => (
    <span className="size-2 rounded-full" style={hollow ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { background: color }} aria-hidden />
  )
  const line = (color: string, dashed = false) => (
    <span className="h-0 w-3.5 border-t-2" style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} aria-hidden />
  )
  const gradient = (
    <span className="h-0.5 w-6 rounded-full" style={{ background: `linear-gradient(to right, ${PATH_OLD}, ${PATH_NEW})` }} aria-hidden />
  )
  const items: [ReactNode, string][] = [
    [<Flag key="start" className="size-3" style={{ color: START_COLOR }} aria-hidden />, t.galaxy.map.legend.start],
    [gradient, t.galaxy.map.legend.path],
    [dot(DOT_COLOR.earned), t.galaxy.map.legend.earned],
    [dot(DOT_COLOR.firsts), t.galaxy.map.legend.firsts],
    [dot(DEATH_COLOR, true), t.galaxy.map.legend.death],
    [line(ROUTE_COLOR, true), t.galaxy.map.legend.route],
    [line(PLOTTED_COLOR), t.galaxy.map.legend.plotted],
    [<MapPin key="you" className="size-3" style={{ color: YOU_COLOR }} strokeWidth={2.5} aria-hidden />, t.galaxy.map.legend.you],
  ]
  if (regions) items.push([line(REGION_LINE), t.galaxy.map.legend.regions])
  if (live) items.push([dot(LIVE_COLOR), t.galaxy.live.legend])
  if (engineers) items.push([dot(ENGINEER_COLOR, true), t.galaxy.engineers.legend])
  return (
    <ul className="pointer-events-none absolute top-3 left-3 z-30 hidden max-w-[60%] flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400 ring-1 ring-white/10 backdrop-blur-sm ring-inset sm:flex">
      {items.map(([mark, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          {mark}
          {label}
        </li>
      ))}
    </ul>
  )
}

/** The region layer's state: shown or not (remembered per browser), and the grid once loaded. */
function useRegions(view: GalaxyView, focus: { id: number; nonce: number } | null) {
  const map = useRegionMap()
  const [show, setShow] = useState(() => readStored(REGIONS_KEY, ['on', 'off'], 'on') === 'on')
  const toggle = useCallback(() => {
    setShow((v) => {
      writeStored(REGIONS_KEY, v ? 'off' : 'on')
      return !v
    })
  }, [])
  // Asked to frame a region: show the layer (not remembered: the switch stays the viewer's).
  const [focused, setFocused] = useState<number | null>(null)
  if (focus && focus.nonce !== focused) {
    setFocused(focus.nonce)
    setShow(true)
  }
  const visitedKey = view.regions.map((r) => (r.systems > 0 ? r.id : 0)).join(',')
  const visited = useMemo(() => visitedKey.split(',').map(Number).filter(Boolean), [visitedKey])
  const selected = focus?.id ?? null
  const shown = useMemo<RegionsShown | null>(
    () => (map && show ? { map, visited, here: view.region, selected } : null),
    [map, show, visited, view.region, selected],
  )
  return { map, show, toggle, shown }
}

/**
 * Other players (EDDN): the switch, remembered per browser and off by default (while it is on,
 * the server downloads the whole EDDN feed), and the latest view while it is on.
 */
function useLive() {
  const [show, setShow] = useState(() => readStored(LIVE_KEY, ['on', 'off'], 'off') === 'on')
  const [view, setView] = useState<LiveView | null>(null)
  const toggle = useCallback(() => {
    setShow((v) => {
      writeStored(LIVE_KEY, v ? 'off' : 'on')
      return !v
    })
  }, [])
  const shownView = show ? view : null
  const points = useMemo(() => (shownView ? buildLivePoints(shownView) : NO_LIVE), [shownView])
  return { show, toggle, view: shownView, setView, points }
}

/** Fetches the live view while mounted (the layer is on); unmounted, the server hangs up. */
function LiveFeed({ onView }: { onView: (view: LiveView | null) => void }) {
  const { data, refetch } = useView('live')
  useEffect(() => onView(data), [data, onView])
  useEffect(() => () => onView(null), [onView])
  useEffect(() => {
    const id = setInterval(refetch, LIVE_KEEPALIVE_MS)
    return () => clearInterval(id)
  }, [refetch])
  return null
}

function liveStatus(view: LiveView | null): string {
  if (view && !view.available) return t.galaxy.live.offline
  if (!view || (view.state !== 'live' && view.systems.length === 0)) return t.galaxy.live.connecting
  // Listening for a minute shows a minute of players, not the window's worth.
  const minutes = Math.min(view.windowMin, Math.max(1, Math.ceil(view.spanS / 60)))
  return t.galaxy.live.status(view.players, view.systems.length, minutes)
}

/** Engineers: the switch (remembered per browser, on by default) and their markers. */
function useEngineers(view: GalaxyView) {
  const [show, setShow] = useState(() => readStored(ENGINEERS_KEY, ['on', 'off'], 'on') === 'on')
  const toggle = useCallback(() => {
    setShow((v) => {
      writeStored(ENGINEERS_KEY, v ? 'off' : 'on')
      return !v
    })
  }, [])
  // Rebuilt only when an engineer's standing changes, not on every refetch of the view.
  const key = JSON.stringify(view.engineers)
  const all = useMemo(() => buildEngineerPoints(JSON.parse(key)), [key])
  return { show, toggle, points: show ? all : NO_ENGINEERS }
}

/** "Copied: <name>" for a moment after a click on another player's system. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback((name: string) => {
    void copyText(name).then((ok) => ok && setCopied(name))
  }, [])
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 2_500)
    return () => clearTimeout(id)
  }, [copied])
  return { copied, copy }
}

export default function GalaxyMapCanvas({ view, onOpenSystem, focusRegion = null, className = '' }: GalaxyMapProps) {
  const scene = useScene(view)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const [store] = useState(() => new PickStore())
  const camera = useRef<RouteCameraApi | null>(null)
  const labelLayer = useRef<HTMLDivElement>(null)
  const hoverLayer = useRef<HTMLDivElement>(null)
  const eventSource = useRef<HTMLDivElement>(null)
  const openRef = useRef(onOpenSystem)
  useLayoutEffect(() => {
    openRef.current = onOpenSystem
  }, [onOpenSystem])
  const open = useCallback((address: string) => openRef.current(address), [])
  const registerCamera = useCallback((api: RouteCameraApi | null) => {
    camera.current = api
  }, [])
  const regions = useRegions(view, focusRegion)
  const live = useLive()
  const engineers = useEngineers(view)
  const { copied, copy } = useCopied()
  const grid = regions.map?.grid
  const focusNonce = focusRegion?.nonce
  const focusId = focusRegion?.id
  useEffect(() => {
    if (!grid || focusId === undefined || focusNonce === undefined) return
    const b = regionBounds(grid, focusId)
    if (!b) return
    camera.current?.show([
      at({ x: b.x0, y: 0, z: b.z0 }),
      at({ x: b.x1, y: 0, z: b.z0 }),
      at({ x: b.x0, y: 0, z: b.z1 }),
      at({ x: b.x1, y: 0, z: b.z1 }),
    ])
  }, [grid, focusId, focusNonce])

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl ring-1 ring-zinc-800/80 ${className}`}
      style={{ background: 'radial-gradient(140% 120% at 50% 40%, #070b14 0%, #020308 75%)' }}
      role="group"
      aria-label={t.galaxy.map.label(view.systems.length)}
    >
      <div ref={eventSource} className="absolute inset-0">
        <Canvas
          flat
          dpr={[1, 2]}
          frameloop="demand"
          camera={{ fov: 40, near: 0.005, far: 20_000, position: [0, 600, 600] }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          eventSource={eventSource as RefObject<HTMLElement>}
          style={{ position: 'absolute', inset: 0 }}
        >
          <Scene
            view={view}
            scene={scene}
            store={store}
            layer={labelLayer as RefObject<HTMLElement>}
            hoverLayer={hoverLayer as RefObject<HTMLElement>}
            onOpen={open}
            onCopy={copy}
            registerCamera={registerCamera}
            reducedMotion={reducedMotion}
            regions={regions.shown}
            live={live.points}
            engineers={engineers.points}
            grid={grid ?? null}
          />
        </Canvas>
        <div ref={labelLayer} className="pointer-events-none absolute inset-0 isolate z-10 overflow-hidden" />
        <div ref={hoverLayer} className="pointer-events-none absolute inset-0 isolate z-40 overflow-hidden" />
      </div>
      {live.show && <LiveFeed onView={live.setView} />}

      <Legend regions={regions.shown !== null} live={live.show} engineers={engineers.show} />
      {/* The views, and below them the layers. */}
      <div className="pointer-events-none absolute top-0 right-0 z-30 flex flex-col items-end gap-1.5 p-3">
        <div className="flex gap-1.5">
          {scene.you && (
            <MapButton label={t.galaxy.map.you} onClick={() => camera.current?.focus(scene.you as Vec3)}>
              <Crosshair className="size-4" aria-hidden />
            </MapButton>
          )}
          <MapButton label={t.galaxy.map.top} onClick={() => camera.current?.top()}>
            <MapIcon className="size-4" aria-hidden />
          </MapButton>
          <MapButton label={t.galaxy.map.whole} onClick={() => camera.current?.show(scene.galaxy)}>
            <Globe className="size-4" aria-hidden />
          </MapButton>
          <MapButton label={t.galaxy.map.travels} onClick={() => camera.current?.fit(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </MapButton>
        </div>
        <div className="flex gap-1.5">
          {regions.map && (
            <MapButton label={t.galaxy.map.regions} onClick={regions.toggle} pressed={regions.show}>
              <Layers className="size-4" aria-hidden />
            </MapButton>
          )}
          <MapButton label={t.galaxy.engineers.toggle} onClick={engineers.toggle} pressed={engineers.show}>
            <Wrench className="size-4" aria-hidden />
          </MapButton>
          <MapButton label={t.galaxy.live.toggle} onClick={live.toggle} pressed={live.show}>
            <Radio className="size-4" aria-hidden />
          </MapButton>
        </div>
      </div>
      <div role="status" className="pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2">
        {copied && (
          <span className="block max-w-[80vw] truncate rounded-full bg-zinc-950/85 px-3 py-1.5 text-xs text-zinc-100 shadow-lg ring-1 ring-white/15 backdrop-blur-sm">
            {t.galaxy.live.copied(copied)}
          </span>
        )}
      </div>
      <div className="pointer-events-none absolute bottom-2.5 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-col gap-0.5 text-[11px] text-zinc-500 select-none">
        {live.show && (
          <>
            <span style={{ color: LIVE_COLOR }}>{liveStatus(live.view)}</span>
            <span className="text-zinc-600">{t.galaxy.live.source}</span>
          </>
        )}
        <span>{t.galaxy.map.rings(`${formatNumber(RING_STEP_LY)} ${t.units.ly}`)}</span>
        <span className="text-zinc-600">{t.galaxy.map.backdrop}</span>
        <span className="text-zinc-600">{coarse ? t.galaxy.map.hintTouch : t.galaxy.map.hintMouse}</span>
      </div>
    </div>
  )
}

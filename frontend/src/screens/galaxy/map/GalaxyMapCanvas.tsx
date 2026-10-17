// The galaxy map (lazy chunk): every system you visited on a sketch of the galaxy, your path,
// where you died and the routes ahead. Hover names a system; a click opens it on the System tab.

import { Canvas, useThree } from '@react-three/fiber'
import { Crosshair, Flag, Globe, Map as MapIcon, MapPin, Maximize2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { GalaxyView } from '../../../api/types'
import { Credits } from '../../../components/Credits'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { t } from '../../../i18n'
import { formatCredits, formatDateTime, formatLy, formatNumber } from '../../../lib/format'
import { MapButton } from '../../../map/MapButton'
import { Ticker } from '../../../map/Ticker'
import { YOU_COLOR } from '../../route/map/colors'
import { pickNearest, type Projected, type Vec3 } from '../../route/map/geometry'
import { Anchor, LabelPlacer, PILL, type LabelEntry } from '../../route/map/labels'
import { Marker } from '../../route/map/layers'
import { RouteCamera, type RouteCameraApi } from '../../route/map/RouteCamera'
import { PickStore, usePick } from '../../route/map/store'
import { at, buildGalaxyScene, FOCUS_DISTANCE, GALAXY_LIMITS, GALAXY_RANGE, LANDMARKS, RING_STEP_LY, type GalaxyScene } from './geometry'
import { DEATH_COLOR, DOT_COLOR, PATH_NEW, PATH_OLD, PLOTTED_COLOR, ROUTE_COLOR, START_COLOR } from './colors'
import { Backdrop, Deaths, LandmarkMarks, Paths, Routes, Rings, StartMark, SystemDots } from './layers'

export interface GalaxyMapProps {
  view: GalaxyView
  onOpenSystem: (address: string) => void
  className?: string
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

/** Hover and click on the systems' dots, picked on screen. Addresses in the store. */
function Picking({ scene, store, onOpen }: { scene: GalaxyScene; store: PickStore; onOpen: (address: string) => void }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined
  const invalidate = useThree((s) => s.invalidate)
  const sceneRef = useRef(scene)
  useLayoutEffect(() => {
    sceneRef.current = scene
  }, [scene])

  useEffect(() => {
    const el = connected ?? gl.domElement
    const v = new Vector3()
    const pick = (e: PointerEvent): string | null => {
      const systems = sceneRef.current.systems
      const r = gl.domElement.getBoundingClientRect()
      const dots = systems.map<Projected | null>((s) => {
        v.set(s.pos[0], s.pos[1], s.pos[2]).project(camera)
        if (v.z < -1 || v.z > 1) return null
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, radius: Math.max(4, s.size / 2) }
      })
      const i = pickNearest(dots, e.clientX - r.left, e.clientY - r.top, 4)
      return i < 0 ? null : systems[i].address
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
      const address = pick(e)
      if (address) onOpen(address)
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
  }, [camera, connected, gl, invalidate, onOpen, store])
  return null
}

const PRIORITY = { hover: 60, you: 50, start: 45, landmark: 30 }

function HoverCard({ view, index }: { view: GalaxyView; index: number }) {
  const s = view.systems[index]
  const deaths = view.deaths.filter((d) => d.system === index)
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

function Labels({ view, scene, store, layer }: { view: GalaxyView; scene: GalaxyScene; store: PickStore; layer: RefObject<HTMLElement> }) {
  const { hovered } = usePick(store)
  const [entries] = useState(() => new Map<string, LabelEntry>())
  const landmarks = useMemo(() => LANDMARKS.map((l) => ({ ...l, pos: at(l) })), [])
  const byAddress = useMemo(() => new Map(scene.systems.map((s) => [s.address, s])), [scene.systems])
  const hover = hovered ? byAddress.get(hovered) : undefined
  const current = view.current !== null ? view.systems[view.current] : null
  const labels: ReactNode[] = []
  if (hover) {
    labels.push(
      <Anchor key={`hover:${hover.address}`} id={`hover:${hover.address}`} pos={hover.pos} priority={PRIORITY.hover} lift={hover.size / 2 + 8} always entries={entries} layer={layer}>
        <HoverCard view={view} index={hover.index} />
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
  onOpen,
  registerCamera,
  reducedMotion,
}: {
  view: GalaxyView
  scene: GalaxyScene
  store: PickStore
  layer: RefObject<HTMLElement>
  onOpen: (address: string) => void
  registerCamera: (api: RouteCameraApi | null) => void
  reducedMotion: boolean
}) {
  const landmarks = useMemo(() => LANDMARKS.map((l) => at(l)), [])
  return (
    <>
      {!reducedMotion && <Ticker fps={20} />}
      <Backdrop />
      <Rings />
      <LandmarkMarks points={landmarks} />
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
      <Hovered scene={scene} store={store} />
      <Labels view={view} scene={scene} store={store} layer={layer} />
      <Picking scene={scene} store={store} onOpen={onOpen} />
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

function Hovered({ scene, store }: { scene: GalaxyScene; store: PickStore }) {
  const { hovered } = usePick(store)
  const s = hovered ? scene.systems.find((x) => x.address === hovered) : undefined
  return s ? <Marker pos={s.pos} color="#ffffff" size={s.size + 9} inner={0.76} opacity={0.8} order={7} /> : null
}

function Legend() {
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

export default function GalaxyMapCanvas({ view, onOpenSystem, className = '' }: GalaxyMapProps) {
  const scene = useScene(view)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const [store] = useState(() => new PickStore())
  const camera = useRef<RouteCameraApi | null>(null)
  const labelLayer = useRef<HTMLDivElement>(null)
  const eventSource = useRef<HTMLDivElement>(null)
  const openRef = useRef(onOpenSystem)
  useLayoutEffect(() => {
    openRef.current = onOpenSystem
  }, [onOpenSystem])
  const open = useCallback((address: string) => openRef.current(address), [])
  const registerCamera = useCallback((api: RouteCameraApi | null) => {
    camera.current = api
  }, [])

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
            onOpen={open}
            registerCamera={registerCamera}
            reducedMotion={reducedMotion}
          />
        </Canvas>
        <div ref={labelLayer} className="pointer-events-none absolute inset-0 isolate z-10 overflow-hidden" />
      </div>

      <Legend />
      <div className="pointer-events-none absolute top-0 right-0 z-30 flex gap-1.5 p-3">
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
      <div className="pointer-events-none absolute bottom-2.5 left-3 z-20 flex flex-col gap-0.5 text-[11px] text-zinc-500 select-none">
        <span>{t.galaxy.map.rings(`${formatNumber(RING_STEP_LY)} ${t.units.ly}`)}</span>
        <span className="text-zinc-600">{t.galaxy.map.backdrop}</span>
        <span className="text-zinc-600">{coarse ? t.galaxy.map.hintTouch : t.galaxy.map.hintMouse}</span>
      </div>
    </div>
  )
}

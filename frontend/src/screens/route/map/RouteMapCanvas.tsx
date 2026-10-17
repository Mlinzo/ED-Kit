// The 3D route map (lazy chunk: three.js, react-three-fiber, drei): the stops in galactic space
// with the path through them, the corridor or search radius, where you are. Hover names a stop,
// a click selects it (the screen shows its card over the map).

import { Canvas, useThree } from '@react-three/fiber'
import { Crosshair, Map as MapIcon, MapPin, Maximize2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { RouteStopView, RouteView } from '../../../api/types'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { ru } from '../../../i18n/ru'
import { formatLy, formatNumber } from '../../../lib/format'
import { Starfield } from '../../../map/Starfield'
import { Ticker } from '../../../map/Ticker'
import { buildScene, framePoints, pickNearest, type Projected, type RouteScene } from './geometry'
import { Labels, type LabelNames } from './labels'
import { NEXT_GLOW, STATE_COLOR, YOU_COLOR } from './colors'
import { Corridor, Endpoints, Floor, Marker, Paths, SearchRing, Stalks, StopDots } from './layers'
import { RouteCamera, type RouteCameraApi } from './RouteCamera'
import { PickStore, usePick } from './store'

export interface RouteMapProps {
  route: RouteView
  /** Address of the selected stop. */
  selected: string | null
  onSelect: (address: string | null) => void
  className?: string
  /** Shown over the map (the selected stop's card). */
  overlay?: ReactNode
}

/** Everything drawn depends on this: refetches that change nothing visible keep the scene. */
function sceneKey(route: RouteView): string {
  const p = route.params
  return JSON.stringify([
    route.createdAt,
    p?.mode,
    p?.radiusLy,
    p?.deviationLy,
    route.source,
    route.destination,
    route.currentPosition,
    route.nextSeq,
    route.stops.map((s) => [s.address, s.seq, s.x, s.y, s.z, s.value, s.done, s.skipped, s.here]),
  ])
}

function useScene(route: RouteView): RouteScene {
  const key = useMemo(() => sceneKey(route), [route])
  const [built, setBuilt] = useState(() => ({ key, scene: buildScene(route) }))
  if (built.key !== key) {
    const next = { key, scene: buildScene(route) }
    setBuilt(next)
    return next.scene
  }
  return built.scene
}

/** Marks for the next stop (a steady glow and a pulse), you, the hovered and the selected stop. */
const Highlights = memo(function Highlights({ scene, store, reducedMotion }: { scene: RouteScene; store: PickStore; reducedMotion: boolean }) {
  const { hovered, selected } = usePick(store)
  const find = (address: string | null) => (address === null ? undefined : scene.stops.find((s) => s.address === address))
  const next = scene.stops.find((s) => s.state === 'next')
  const hover = find(hovered)
  const pick = find(selected)
  const youAtStop = scene.stops.some((s) => s.here)
  return (
    <>
      {next && <Marker pos={next.pos} color={NEXT_GLOW} size={next.size * 3.4} shape="glow" opacity={0.85} additive order={3} />}
      {next && !reducedMotion && <Marker pos={next.pos} color={STATE_COLOR.next} size={next.size * 3} inner={0.86} opacity={0.8} pulse={1.8} />}
      {scene.you && (
        <>
          {!youAtStop && <Marker pos={scene.you} color={YOU_COLOR} size={7} shape="disc" order={6} />}
          <Marker pos={scene.you} color={YOU_COLOR} size={18} inner={0.76} order={6} />
          {!reducedMotion && <Marker pos={scene.you} color={YOU_COLOR} size={30} inner={0.9} opacity={0.7} pulse={2.4} order={6} />}
        </>
      )}
      {pick && <Marker pos={pick.pos} color="#ffffff" size={pick.size + 12} inner={0.72} order={7} />}
      {hover && hover !== pick && <Marker pos={hover.pos} color="#ffffff" size={hover.size + 9} inner={0.76} opacity={0.75} order={7} />}
    </>
  )
})

const isOnLabel = (e: PointerEvent) => e.target instanceof Element && e.target.closest('[data-map-label]') !== null

/**
 * Hover and click on the stops' dots, picked on screen (a dot is a few pixels whatever the zoom).
 * A click is a press and release that did not drag the view.
 */
function Picking({ scene, store, onSelect }: { scene: RouteScene; store: PickStore; onSelect: (address: string | null) => void }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined
  const invalidate = useThree((s) => s.invalidate)
  // Read at event time: the listeners (and a press in progress) outlive scene rebuilds.
  const sceneRef = useRef(scene)
  useLayoutEffect(() => {
    sceneRef.current = scene
  }, [scene])

  useEffect(() => {
    const el = connected ?? gl.domElement
    const v = new Vector3()
    const pick = (e: PointerEvent): string | null => {
      const stops = sceneRef.current.stops
      const r = gl.domElement.getBoundingClientRect()
      const dots = stops.map<Projected | null>((s) => {
        v.set(s.pos[0], s.pos[1], s.pos[2]).project(camera)
        if (v.z < -1 || v.z > 1) return null
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, radius: Math.max(5, s.size / 2) }
      })
      const i = pickNearest(dots, e.clientX - r.left, e.clientY - r.top)
      return i < 0 ? null : stops[i].address
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
      // The left button (or a touch) picks; the others pan and zoom.
      down = e.button !== 0 || isOnLabel(e) ? null : [e.clientX, e.clientY]
    }
    const onUp = (e: PointerEvent) => {
      const start = down
      down = null
      if (!start || isOnLabel(e) || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return
      onSelect(pick(e))
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
  }, [camera, connected, gl, invalidate, onSelect, store])
  return null
}

/** Memoized: re-renders when the scene (or the stops' progress, for the labels) changes. */
const Scene = memo(function Scene({
  scene,
  store,
  live,
  names,
  layer,
  select,
  registerCamera,
  routeKey,
  reducedMotion,
}: {
  scene: RouteScene
  store: PickStore
  live: Map<string, RouteStopView>
  names: LabelNames
  layer: RefObject<HTMLElement>
  select: (address: string | null) => void
  registerCamera: (api: RouteCameraApi | null) => void
  routeKey: string
  reducedMotion: boolean
}) {
  const frame = useMemo(() => framePoints(scene), [scene])
  return (
    <>
      {/* The pulses; with reduced motion frames come from the controls only. */}
      {!reducedMotion && <Ticker fps={24} />}
      <Starfield animate={!reducedMotion} />
      <Floor floorY={scene.floorY} cell={scene.gridLy * scene.scale} />
      {scene.corridor && <Corridor from={scene.corridor.from} to={scene.corridor.to} radius={scene.corridor.radius} />}
      {scene.ring && <SearchRing center={scene.ring.center} radius={scene.ring.radius} />}
      <Stalks scene={scene} />
      <Paths scene={scene} />
      <Endpoints source={scene.source} destination={scene.destination} />
      <StopDots scene={scene} />
      <Highlights scene={scene} store={store} reducedMotion={reducedMotion} />
      <Labels scene={scene} live={live} names={names} store={store} layer={layer} onSelect={select} />
      <Picking scene={scene} store={store} onSelect={select} />
      <RouteCamera frame={frame} routeKey={routeKey} reducedMotion={reducedMotion} register={registerCamera} />
    </>
  )
})

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring pointer-events-auto flex size-10 items-center justify-center rounded-xl bg-zinc-950/60 text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm transition-colors ring-inset hover:bg-zinc-900/80 hover:text-zinc-50 lg:size-9"
    >
      {children}
    </button>
  )
}

function Legend() {
  const items = [
    { key: 'done', color: STATE_COLOR.done, hollow: false },
    { key: 'next', color: STATE_COLOR.next, hollow: false },
    { key: 'ahead', color: STATE_COLOR.ahead, hollow: false },
    { key: 'skipped', color: STATE_COLOR.skipped, hollow: true },
  ] as const
  return (
    <ul className="pointer-events-none absolute top-3 left-3 z-30 hidden flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400 ring-1 ring-white/10 backdrop-blur-sm ring-inset sm:flex">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={i.hollow ? { boxShadow: `inset 0 0 0 1.5px ${i.color}` } : { background: i.color }}
            aria-hidden
          />
          {ru.route.map.legend[i.key]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <MapPin className="size-3" style={{ color: YOU_COLOR }} strokeWidth={2.5} aria-hidden />
        {ru.route.map.legend.you}
      </li>
    </ul>
  )
}

export default function RouteMapCanvas({ route, selected, onSelect, className = '', overlay }: RouteMapProps) {
  const scene = useScene(route)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const [store] = useState(() => new PickStore())
  const camera = useRef<RouteCameraApi | null>(null)
  const labelLayer = useRef<HTMLDivElement>(null)
  const eventSource = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  useLayoutEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  const select = useCallback((address: string | null) => onSelectRef.current(address), [])
  const registerCamera = useCallback((api: RouteCameraApi | null) => {
    camera.current = api
  }, [])

  useLayoutEffect(() => {
    store.set({ selected })
  }, [store, selected])

  const live = useMemo(() => new Map(route.stops.map((s) => [s.address, s])), [route.stops])
  const source = route.source?.name ?? null
  const destination = route.destination?.name ?? null
  const current = route.currentPosition?.name ?? null
  const names = useMemo<LabelNames>(() => ({ source, destination, current }), [source, destination, current])
  const next = scene.stops.find((s) => s.state === 'next')

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl ring-1 ring-zinc-800/80 ${className}`}
      style={{
        background:
          'radial-gradient(120% 90% at 18% 0%, rgba(56,189,248,0.07), transparent 55%),' +
          'radial-gradient(90% 80% at 100% 100%, rgba(129,140,248,0.07), transparent 60%),' +
          'radial-gradient(140% 120% at 50% 50%, #070b14 0%, #03050a 70%)',
      }}
      role="group"
      aria-label={ru.route.map.label(route.stops.length)}
    >
      {/* Canvas and labels share one event source: a drag that starts on a label still turns the view. */}
      <div ref={eventSource} className="absolute inset-0">
        {/* flat: no tone mapping, so lines and grid show their sRGB colours like the custom shaders. */}
        <Canvas
          flat
          dpr={[1, 2]}
          frameloop="demand"
          camera={{ fov: 40, near: 0.05, far: 12_000, position: [0, 90, 120] }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          eventSource={eventSource as RefObject<HTMLElement>}
          style={{ position: 'absolute', inset: 0 }}
        >
          <Scene
            scene={scene}
            store={store}
            live={live}
            names={names}
            layer={labelLayer as RefObject<HTMLElement>}
            select={select}
            registerCamera={registerCamera}
            routeKey={route.createdAt ?? ''}
            reducedMotion={reducedMotion}
          />
        </Canvas>
        {/* Its own stacking context: label z-indices stay under the overlay (card, buttons, legend). */}
        <div ref={labelLayer} className="pointer-events-none absolute inset-0 isolate z-10 overflow-hidden" />
      </div>

      <Legend />
      <div className="pointer-events-none absolute top-0 right-0 z-30 flex gap-1.5 p-3">
        {next && (
          <MapButton label={ru.route.map.focusNext} onClick={() => camera.current?.focus(next.pos)}>
            <Crosshair className="size-4" aria-hidden />
          </MapButton>
        )}
        <MapButton label={ru.route.map.top} onClick={() => camera.current?.top()}>
          <MapIcon className="size-4" aria-hidden />
        </MapButton>
        <MapButton label={ru.route.map.fit} onClick={() => camera.current?.fit(true)}>
          <Maximize2 className="size-4" aria-hidden />
        </MapButton>
      </div>
      <div className="pointer-events-none absolute bottom-2.5 left-3 z-20 flex flex-col gap-0.5 text-[11px] text-zinc-500 select-none">
        {scene.youFarLy !== null && <span className="text-zinc-300">{ru.route.map.farFromRoute(formatLy(scene.youFarLy))}</span>}
        <span>{ru.route.map.grid(`${formatNumber(scene.gridLy)} ${ru.units.ly}`)}</span>
        <span className="text-zinc-600">{coarse ? ru.route.map.hintTouch : ru.route.map.hintMouse}</span>
      </div>
      {overlay}
    </div>
  )
}

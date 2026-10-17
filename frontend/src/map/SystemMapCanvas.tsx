// The 3D system map (lazy chunk: three.js, react-three-fiber, drei).

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import { Maximize2 } from 'lucide-react'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { PointLight, type PerspectiveCamera } from 'three'
import type { BodyView, SystemView } from '../api/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { ru } from '../i18n/ru'
import { CameraRig } from './CameraRig'
import { MapContext, useMap, type CameraApi, type MapContextValue, type MapRegistry } from './context'
import { InteractionStore } from './interaction'
import { cullLabels } from './labels'
import { layoutSystem, localPosition, nodeAngle, type MapNode, type SystemLayout } from './layout'
import { LIGHT_POOL, STAR_LIGHT_INTENSITY, litStars } from './lights'
import { NodeTree } from './NodeTree'
import { SizerSlot } from './sizing'
import { Starfield } from './Starfield'
import { Ticker } from './Ticker'

export interface SystemMapProps {
  system: SystemView
  /** id64 of the selected body. */
  selectedId: string | null
  onSelect: (id64: string) => void
  /** Body id -> done, for the bodies the stored route counts on. */
  routeTargets?: ReadonlyMap<number, boolean>
  className?: string
}

const NO_TARGETS: ReadonlyMap<number, boolean> = new Map()

interface Built {
  key: string
  layout: SystemLayout
  startedAt: number
}

/**
 * Rebuilds the layout only when bodies/barycentres actually change, and keeps the previous
 * `visual` objects when they are equal, so procedural meshes are not regenerated on every refetch.
 */
function build(system: SystemView, key: string, prev: Built | null): Built {
  const previous = new Map<string, BodyView>()
  if (prev) for (const n of prev.layout.nodes.values()) if (n.body) previous.set(n.body.id64, n.body)
  const bodies = system.bodies.map((b) => {
    const old = previous.get(b.id64)
    return old && JSON.stringify(old.visual) === JSON.stringify(b.visual) ? { ...b, visual: old.visual } : b
  })
  return { key, layout: layoutSystem({ bodies, barycentres: system.barycentres }), startedAt: Date.now() }
}

function useLayout(system: SystemView): Built {
  const key = useMemo(() => JSON.stringify([system.bodies, system.barycentres]), [system.bodies, system.barycentres])
  const [built, setBuilt] = useState(() => build(system, key, null))
  if (built.key !== key) {
    const next = build(system, key, built)
    setBuilt(next)
    return next
  }
  return built
}

const LABEL_INTERVAL = 1 / 12

/** Pointer position relative to the canvas, whichever element (canvas or label) got the event. */
function onCreated(state: RootState) {
  state.setEvents({
    compute: (event, s) => {
      const r = s.gl.domElement.getBoundingClientRect()
      s.pointer.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1)
      s.raycaster.setFromCamera(s.pointer, s.camera)
    },
  })
}

/** Memoized: re-renders only when the layout (context) or the system changes. */
const Scene = memo(function Scene({ systemKey }: { systemKey: string }) {
  const { layout, registry, reducedMotion, startedAt, interaction } = useMap()
  const size = useThree((s) => s.size)
  const sinceCull = useRef(LABEL_INTERVAL)
  // A fixed pool of star lights (see lights.ts): the light count never changes.
  const lights = useMemo(
    () =>
      Array.from({ length: LIGHT_POOL }, () => {
        const l = new PointLight('#ffffff', 0, 0, 0)
        l.position.set(0, -1e4, 0)
        return l
      }),
    [],
  )
  const lit = useMemo(() => litStars(layout), [layout])

  useFrame((state, dt) => {
    // Bodies move along their orbits in real time (imperceptibly slow except for close moons).
    const now = reducedMotion ? startedAt : Date.now()
    if (!reducedMotion) {
      for (const node of layout.nodes.values()) {
        if (!node.parent) continue
        const g = registry.groups.get(node.id)
        if (g) {
          const [x, z] = localPosition(node, now)
          g.position.set(x, 0, z)
        }
        const o = registry.orbits.get(node.id)
        if (o) o.rotation.y = nodeAngle(node, now)
      }
    }

    // Magnify what is too small on screen where there is room (see sizing.ts); with reduced
    // motion the sizes jump instead of easing.
    const sizer = registry.sizer.for(layout, systemKey)
    const camera = state.camera as PerspectiveCamera
    sizer.solve(camera, size.width, size.height, now, reducedMotion ? 0 : dt, interaction.get().currentId)
    sizer.nodes.forEach((node, i) => {
      registry.groups.get(node.id)?.scale.setScalar(sizer.zoom[i])
      registry.bodies.get(node.id)?.scale.setScalar(sizer.body[i])
    })
    lights.forEach((light, k) => {
      const i = k < lit.length ? sizer.index.get(lit[k].id) : undefined
      if (i === undefined) {
        light.intensity = 0
        return
      }
      light.intensity = STAR_LIGHT_INTENSITY
      light.position.set(sizer.worldX[i], 0, sizer.worldZ[i])
    })

    sinceCull.current += dt
    if (sinceCull.current >= LABEL_INTERVAL) {
      sinceCull.current = 0
      cullLabels(registry, layout, state.camera, size.width, size.height)
    }
  })

  return (
    <>
      {/* With reduced motion only labels need the odd refresh. */}
      <Ticker fps={reducedMotion ? 10 : 30} />
      <ambientLight intensity={0.14} />
      {lights.map((l, k) => (
        <primitive key={k} object={l} />
      ))}
      <Starfield animate={!reducedMotion} />
      {layout.roots.map((r) => (
        <NodeTree key={r.id} node={r} />
      ))}
      <CameraRig systemKey={systemKey} />
    </>
  )
})

export default function SystemMapCanvas({ system, selectedId, onSelect, routeTargets = NO_TARGETS, className = '' }: SystemMapProps) {
  const { layout, startedAt } = useLayout(system)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const [interaction] = useState(() => new InteractionStore())
  const registry = useMemo<MapRegistry>(
    () => ({ groups: new Map(), bodies: new Map(), orbits: new Map(), labels: new Map(), sizer: new SizerSlot() }),
    [],
  )
  const camera = useRef<CameraApi | null>(null)
  const labelLayer = useRef<HTMLDivElement>(null)
  const eventSource = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  useLayoutEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Selection and "you are here" come from the screen; pushed into the store, not the context.
  const selectedNodeId = useMemo(() => {
    if (!selectedId) return null
    for (const n of layout.nodes.values()) if (n.body?.id64 === selectedId) return n.id
    return null
  }, [layout, selectedId])
  const currentId = system.currentBodyId != null && layout.nodes.get(system.currentBodyId)?.body ? system.currentBodyId : null
  useLayoutEffect(() => {
    interaction.set({ selectedId: selectedNodeId, currentId })
  }, [interaction, selectedNodeId, currentId])
  // A body that disappears from the layout cannot stay hovered.
  useLayoutEffect(() => {
    const h = interaction.get().hoveredId
    if (h !== null && !layout.nodes.has(h)) interaction.set({ hoveredId: null })
  }, [interaction, layout])

  const registerCamera = useCallback((api: CameraApi | null) => {
    camera.current = api
  }, [])

  const select = useCallback((node: MapNode) => {
    if (!node.body) return
    onSelectRef.current(node.body.id64)
    camera.current?.focus(node.id)
  }, [])

  const value = useMemo<MapContextValue>(
    () => ({
      layout,
      registry,
      startedAt,
      reducedMotion,
      interaction,
      select,
      routeTargets,
      registerCamera,
      labelLayer: labelLayer as RefObject<HTMLElement>,
    }),
    [layout, registry, startedAt, reducedMotion, interaction, select, routeTargets, registerCamera],
  )

  const systemKey = system.address ?? system.name ?? '?'

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl ring-1 ring-zinc-800/80 ${className}`}
      style={{
        background:
          'radial-gradient(120% 90% at 18% 0%, rgba(56,189,248,0.07), transparent 55%),' +
          'radial-gradient(90% 80% at 100% 100%, rgba(129,140,248,0.07), transparent 60%),' +
          'radial-gradient(140% 120% at 50% 50%, #070b14 0%, #03050a 70%)',
      }}
      // Not role="img": it contains the label buttons and the fit button.
      role="group"
      aria-label={`${ru.map.label}: ${system.name ?? ''}, ${ru.map.bodiesCount(system.bodies.length)}`}
    >
      {/*
        Canvas and labels share one event source: a drag that starts on a label still turns the
        view (and on touch the browser does not take it for a page scroll), and pointer positions
        are computed against the canvas whatever element is under the pointer.
      */}
      <div ref={eventSource} className="absolute inset-0">
        <Canvas
          dpr={[1, 2]}
          frameloop="demand"
          camera={{ fov: 40, near: 0.1, far: 12_000, position: [0, 60, 100] }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          eventSource={eventSource as RefObject<HTMLElement>}
          onCreated={onCreated}
          onPointerMissed={() => interaction.set({ hoveredId: null })}
          style={{ position: 'absolute', inset: 0 }}
        >
          <MapContext value={value}>
            <Scene systemKey={systemKey} />
          </MapContext>
        </Canvas>
        <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" />
      </div>
      {layout.nodes.size === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-lg font-medium text-zinc-300">{ru.system.emptyList}</p>
          <p className="max-w-sm text-sm text-zinc-500">{ru.system.honkUnknown}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-end p-3">
        <button
          type="button"
          onClick={() => camera.current?.fit(true, true)}
          title={ru.map.fit}
          aria-label={ru.map.fit}
          className="focus-ring pointer-events-auto flex size-10 items-center justify-center rounded-xl bg-zinc-950/60 text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm transition-colors ring-inset hover:bg-zinc-900/80 hover:text-zinc-50 lg:size-9"
        >
          <Maximize2 className="size-4" aria-hidden />
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2.5 left-3 text-[11px] text-zinc-600 select-none">
        {coarse ? ru.map.hintTouch : ru.map.hintMouse}
      </p>
    </div>
  )
}

// Labels on the route map (drei <Html>, portalled into one fixed layer): the next stop, where you
// are, the start and the destination, the selected stop, and a card for the hovered one. Only a
// handful at a time: the rest of the stops are dots, named on hover. Every frame they are placed
// around their points without overlapping (placeLabels), the less important ones hidden.

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Flag, MapPin } from 'lucide-react'
import { memo, useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Vector3 } from 'three'
import type { RouteStopView } from '../../../api/types'
import { CreditRange } from '../../../components/Credits'
import { ru } from '../../../i18n/ru'
import { formatLy } from '../../../lib/format'
import { BodyChips } from '../kinds'
import { STATE_COLOR, YOU_COLOR } from './colors'
import { placeLabels, type LabelBox, type MapStop, type RouteScene, type StopState, type Vec3 } from './geometry'
import { usePick, type PickStore } from './store'

export interface LabelNames {
  source: string | null
  destination: string | null
  current: string | null
}

type StopLabel = 'hover' | 'selected' | 'here' | 'next'

/** Placement order (and stacking): the first ones get the best spots. */
const PRIORITY: Record<StopLabel | 'you' | 'destination' | 'start', number> = {
  hover: 60,
  selected: 55,
  here: 50,
  next: 48,
  you: 45,
  destination: 42,
  start: 40,
}

interface LabelEntry {
  el: HTMLElement
  pos: Vec3
  priority: number
  lift: number
  always: boolean
}

const PILL =
  'flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] leading-none font-medium whitespace-nowrap shadow-lg ring-1 shadow-black/40 backdrop-blur-sm ring-inset'

const STATUS: Record<StopState, string> = {
  done: ru.route.status.done,
  next: ru.route.status.next,
  skipped: ru.route.status.skipped,
  ahead: ru.route.map.legend.ahead,
}

/**
 * A label at a point, `lift` px away from it on the side the placer picks (--tx / --ty), hidden
 * until placed. Marked so a click on it is not a click on the map behind.
 */
function Anchor({
  id,
  pos,
  priority,
  lift,
  always = false,
  entries,
  layer,
  children,
}: {
  id: string
  pos: Vec3
  priority: number
  lift: number
  always?: boolean
  entries: Map<string, LabelEntry>
  layer: RefObject<HTMLElement>
  children: ReactNode
}) {
  // A label starts hidden until a frame places it; the canvas renders on demand, so request one
  // when it appears (its own react-dom root may commit after the frame that rendered it) and
  // whenever its size changes.
  const invalidate = useThree((s) => s.invalidate)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      observer.current?.disconnect()
      observer.current = null
      if (el) {
        entries.set(id, { el, pos, priority, lift, always })
        observer.current = new ResizeObserver(() => invalidate())
        observer.current.observe(el)
        invalidate()
      } else {
        entries.delete(id)
      }
    },
    [entries, id, pos, priority, lift, always, invalidate],
  )
  return (
    <Html position={pos} portal={layer} zIndexRange={[priority, priority]} style={{ pointerEvents: 'none' }}>
      <div
        ref={ref}
        data-map-label=""
        data-hidden="true"
        className="absolute top-0 left-0 w-max [transform:translate(var(--tx,-50%),var(--ty,-100%))] transition-opacity duration-150 motion-reduce:transition-none data-[hidden=true]:invisible data-[hidden=true]:opacity-0"
      >
        {children}
      </div>
    </Html>
  )
}

const anchor = new Vector3()

/** Places the labels every frame (a handful: cheap), around their points as the view turns. */
function LabelPlacer({ entries }: { entries: Map<string, LabelEntry> }) {
  useFrame(({ camera, size }) => {
    const items = [...entries.values()].sort((a, b) => b.priority - a.priority)
    // Reads first (positions, sizes), writes after: no layout thrashing.
    const boxes = items.map<LabelBox>((it) => {
      anchor.set(it.pos[0], it.pos[1], it.pos[2]).project(camera)
      const x = ((anchor.x + 1) / 2) * size.width
      const y = ((1 - anchor.y) / 2) * size.height
      return {
        x,
        y,
        w: it.el.offsetWidth,
        h: it.el.offsetHeight,
        lift: it.lift,
        always: it.always,
        visible: anchor.z > -1 && anchor.z < 1 && x >= 0 && x <= size.width && y >= 0 && y <= size.height,
      }
    })
    placeLabels(boxes, size.width, size.height).forEach((at, i) => {
      const el = items[i].el
      if (at) {
        el.style.setProperty('--tx', `${at[0].toFixed(1)}px`)
        el.style.setProperty('--ty', `${at[1].toFixed(1)}px`)
      }
      const hidden = at ? 'false' : 'true'
      if (el.dataset.hidden !== hidden) el.dataset.hidden = hidden
    })
  })
  return null
}

function StopPill({ stop, kind, onSelect }: { stop: MapStop; kind: Exclude<StopLabel, 'hover'>; onSelect: (address: string) => void }) {
  const tone =
    kind === 'selected'
      ? 'bg-zinc-950/85 text-white ring-white/30'
      : kind === 'here'
        ? 'bg-zinc-950/75 text-emerald-50 ring-emerald-400/40'
        : 'bg-zinc-950/75 text-sky-50 ring-sky-400/40'
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect(stop.address)
      }}
      className={`focus-ring pointer-events-auto cursor-pointer hover:bg-zinc-900/90 ${PILL} ${tone}`}
    >
      {kind === 'here' ? (
        <MapPin className="size-3.5 shrink-0" style={{ color: YOU_COLOR }} strokeWidth={2.5} aria-label={ru.route.youAreHere} />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATE_COLOR[stop.state] }} aria-hidden />
      )}
      {kind === 'next' && <span className="text-sky-300">{ru.route.status.next}</span>}
      <span className="proportional-nums">{stop.name}</span>
    </button>
  )
}

function HoverCard({ stop, view }: { stop: MapStop; view: RouteStopView }) {
  const status =
    view.here ? ru.route.status.here : stop.state === 'ahead' && view.visited ? ru.route.status.visited : STATUS[stop.state]
  return (
    <div className="pointer-events-none w-64 rounded-xl bg-zinc-950/90 p-3 shadow-2xl ring-1 shadow-black/60 ring-white/12 backdrop-blur-md ring-inset">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{view.seq}</span>
        <span className="min-w-0 truncate text-sm font-semibold text-zinc-50">{view.name}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: STATE_COLOR[stop.state] }} aria-hidden />
          {status}
        </span>
        <span className="tabular-nums">{ru.route.map.hop(formatLy(view.hopLy))}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {view.bodies.map((b) => (
          <BodyChips key={b.bodyId} body={b} dim={b.done || view.skipped} />
        ))}
      </div>
      <div className="mt-2 border-t border-white/8 pt-2">
        <CreditRange min={view.valueMin} max={view.value} className="text-sm font-semibold text-emerald-300" />
      </div>
    </div>
  )
}

function PointPill({ icon, label, name, tone }: { icon: ReactNode; label: string; name: string | null; tone: string }) {
  return (
    <div className={`${PILL} ${tone}`}>
      {icon}
      <span className="opacity-70">{label}</span>
      {name && <span className="proportional-nums">{name}</span>}
    </div>
  )
}

const near = (a: Vec3 | null, b: Vec3 | null) => a !== null && b !== null && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3

export const Labels = memo(function Labels({
  scene,
  live,
  names,
  store,
  layer,
  onSelect,
}: {
  scene: RouteScene
  /** The stops as last fetched (progress inside them changes without moving anything). */
  live: Map<string, RouteStopView>
  names: LabelNames
  store: PickStore
  layer: RefObject<HTMLElement>
  onSelect: (address: string) => void
}) {
  const { hovered, selected } = usePick(store)
  const byAddress = useMemo(() => new Map(scene.stops.map((s) => [s.address, s])), [scene.stops])
  const [entries] = useState(() => new Map<string, LabelEntry>())

  const labels: ReactNode[] = []
  const used = new Set<string>()
  // One label per stop, the most telling kind first.
  const add = (stop: MapStop | undefined, kind: StopLabel) => {
    if (!stop || used.has(stop.address)) return
    const lift = stop.size / 2 + 6
    // A pill keeps its element when its kind changes (next -> selected), so keyboard focus stays.
    const id = kind === 'hover' ? `hover:${stop.address}` : `stop:${stop.address}`
    const always = kind === 'hover' || kind === 'selected'
    if (kind === 'hover') {
      const view = live.get(stop.address)
      if (!view) return
      used.add(stop.address)
      labels.push(
        <Anchor key={id} id={id} pos={stop.pos} priority={PRIORITY.hover} lift={lift + 4} always entries={entries} layer={layer}>
          <HoverCard stop={stop} view={view} />
        </Anchor>,
      )
      return
    }
    used.add(stop.address)
    labels.push(
      <Anchor key={id} id={id} pos={stop.pos} priority={PRIORITY[kind]} lift={lift} always={always} entries={entries} layer={layer}>
        <StopPill stop={stop} kind={kind} onSelect={onSelect} />
      </Anchor>,
    )
  }
  add(hovered ? byAddress.get(hovered) : undefined, 'hover')
  add(selected ? byAddress.get(selected) : undefined, 'selected')
  add(
    scene.stops.find((s) => s.here),
    'here',
  )
  add(
    scene.stops.find((s) => s.state === 'next'),
    'next',
  )

  const point = 'bg-zinc-950/70 text-zinc-200 ring-white/10'
  if (scene.you && !scene.stops.some((s) => s.here)) {
    labels.push(
      <Anchor key="you" id="you" pos={scene.you} priority={PRIORITY.you} lift={13} entries={entries} layer={layer}>
        <PointPill
          icon={<MapPin className="size-3.5 shrink-0" style={{ color: YOU_COLOR }} strokeWidth={2.5} aria-hidden />}
          label={ru.route.youAreHere}
          name={names.current}
          tone="bg-zinc-950/75 text-emerald-50 ring-emerald-400/40"
        />
      </Anchor>,
    )
  }
  if (scene.source && !near(scene.source, scene.you)) {
    labels.push(
      <Anchor key="start" id="start" pos={scene.source} priority={PRIORITY.start} lift={10} entries={entries} layer={layer}>
        <PointPill icon={null} label={ru.route.map.start} name={names.source} tone={point} />
      </Anchor>,
    )
  }
  if (scene.destination) {
    labels.push(
      <Anchor key="destination" id="destination" pos={scene.destination} priority={PRIORITY.destination} lift={12} entries={entries} layer={layer}>
        <PointPill
          icon={<Flag className="size-3.5 shrink-0 text-amber-300" aria-hidden />}
          label={ru.route.map.destination}
          name={names.destination}
          tone={point}
        />
      </Anchor>,
    )
  }
  return (
    <>
      {labels}
      <LabelPlacer entries={entries} />
    </>
  )
})

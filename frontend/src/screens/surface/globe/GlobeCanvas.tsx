// The planet globe (lazy chunk: three.js, react-three-fiber, drei). Marks are WebGL points, one
// draw per layer; you, your ship, your landings and take-offs and your bookmarks are HTML icons
// kept over their spot every frame.

import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import { Navigation2, Rocket } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  ShaderMaterial,
  Spherical,
  Vector3,
  type Camera,
  type Group,
  type PerspectiveCamera,
} from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BodyVisual } from '../../../api/types'
import { CATEGORY_STYLE } from '../../../components/bookmarks'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import type { LatLon } from '../../../lib/geo'
import { PlanetSurface } from '../../../map/visuals'
import {
  facesCamera,
  gridLine,
  greatCircle,
  headingVector,
  pickNear,
  sideBySide,
  toLatLon,
  toVector,
  viewAngles,
  type ScreenPoint,
  type Vec3,
} from './geometry'
import { LAYER_ICON, LAYER_STYLE, SHIP_COLOR, YOU_COLOR, type GlobePoint, type LayerStyle } from './layers'

/** Where the view turns to, and how high over the ground it comes down to (if given). */
export type GlobeFocus = LatLon & { heightM?: number }

export interface GlobeCanvasProps {
  visual: BodyVisual
  /** As on the system map (the body id), so the planet looks the same there. */
  seed: number
  /** The planet's radius: the closest look is MIN_HEIGHT_M over its ground. */
  radiusM: number
  /** The marks to draw (hidden layers already left out). */
  points: readonly GlobePoint[]
  /** Your path as lines (empty when hidden). */
  path: readonly (readonly LatLon[])[]
  here: (LatLon & { heading: number | null }) | null
  selected: GlobePoint | null
  /** Ids of the marks under a click or tap, nearest first ([] on empty ground). */
  onPick: (ids: string[]) => void
  /** Where on the ground a click or tap with no mark under it landed (null: past the planet). */
  onGround?: (spot: LatLon | null) => void
  /** The view turns (and comes down) to this whenever a new object is passed. */
  focus: GlobeFocus
  label: string
  className?: string
}

// The grid floats over the unit sphere (the planet's facets lie inside it) and hides when you look
// closer than GRID_MIN_HEIGHT; marks and the line to a mark ride lower the lower you are (markLift).
const R_GRID = 1.0015
const GRID_MIN_HEIGHT = 0.005
const START_DISTANCE = 3.7 // the whole globe fits the fov with a margin
const MAX_DISTANCE = 6
/** The closest look: from this height over the ground the view is ~300 m across (fov 35°). */
const MIN_HEIGHT_M = 500
/** Per wheel px: one notch (100 px) takes the camera ~28 % higher or lower. */
const WHEEL_ZOOM = 0.0025
/** Landing, take-off and ship icons this close stand side by side (you land and fly off from one
 * spot: under a metre apart in the journal), this far apart on screen. */
const SAME_SPOT_M = 10
const ICON_STEP_PX = 28
/** In a row of icons on one spot: by time, the landing before the take-off, the ship last. */
const ROW_RANK: Partial<Record<GlobePoint['layer'], number>> = { landings: 0, takeoffs: 1, ship: 2 }

/** How far marks sit over the unit sphere for a camera `d` from the centre: 0.4 % of the radius
 * from afar, a twentieth of the camera's height close up (so never past the camera). */
function markLift(d: number): number {
  return Math.min(0.004, (d - 1) * 0.05)
}

const spherical = new Spherical()
const projected = new Vector3()
const ahead = new Vector3()
const ray = new Vector3()
const lightOffset = new Vector3()

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Round marks with a dark rim, fading out toward the horizon. Colours are written as sRGB (no
// colour management in a raw ShaderMaterial), so they match the CSS legend dots.
const MARK_VERT = /* glsl */ `
uniform float uSize;
uniform float uDpr;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uDpr;
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
  vFade = smoothstep(0.02, 0.22, dot(normalize(world), normalize(cameraPosition - world)));
}`

const MARK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRing;
varying float vFade;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  float alpha = (1.0 - smoothstep(0.86, 1.0, r)) * vFade;
  vec3 dark = vec3(0.035, 0.035, 0.05);
  vec3 col;
  if (uRing > 0.5) {
    // Selection: a bright ring with a dark edge on both sides, empty inside.
    float band = smoothstep(0.58, 0.66, r) * (1.0 - smoothstep(0.8, 0.88, r));
    if (band < 0.01 && r < 0.6) discard;
    col = mix(dark, uColor, band);
  } else {
    col = mix(uColor, dark, smoothstep(0.7, 0.8, r));
  }
  gl_FragColor = vec4(col, alpha);
}`

/** `size` in CSS px, times the canvas pixel ratio. */
function markMaterial(color: string, size: number, dpr: number, ring = false): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: MARK_VERT,
    fragmentShader: MARK_FRAG,
    uniforms: {
      uColor: { value: rgb(color) },
      uSize: { value: size },
      uDpr: { value: dpr },
      uRing: { value: ring ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
  })
}

/** On the unit sphere: `Lifted` raises them. */
function pointsGeometry(points: readonly LatLon[]): BufferGeometry {
  const positions = new Float32Array(points.length * 3)
  points.forEach((p, i) => positions.set(toVector(p), i * 3))
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  return g
}

function MarkLayer({ points, style }: { points: readonly GlobePoint[]; style: LayerStyle }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const geometry = useMemo(() => pointsGeometry(points), [points])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(() => markMaterial(style.color, style.size, dpr), [style, dpr])
  useEffect(() => () => material.dispose(), [material])
  return <points geometry={geometry} material={material} renderOrder={10} frustumCulled={false} />
}

function SelectionRing({ point }: { point: LatLon }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const geometry = useMemo(() => pointsGeometry([point]), [point])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(() => markMaterial('#fafafa', 26, dpr, true), [dpr])
  useEffect(() => () => material.dispose(), [material])
  return <points geometry={geometry} material={material} renderOrder={11} frustumCulled={false} />
}

/** Marks and the line to a mark, raised over the ground as high as the camera allows (markLift). */
function Lifted({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => group.current?.scale.setScalar(1 + markLift(camera.position.length())))
  return <group ref={group}>{children}</group>
}

/** Parallels and meridians every 30°, the equator brighter; hidden close to the ground. */
function Grid() {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => {
    if (group.current) group.current.visible = camera.position.length() - 1 > GRID_MIN_HEIGHT
  })
  const [lines, equator] = useMemo(() => {
    const segments = (polylines: Vec3[][]) => {
      const out: number[] = []
      for (const line of polylines) for (let i = 1; i < line.length; i++) out.push(...line[i - 1], ...line[i])
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(out), 3))
      return g
    }
    const rest: Vec3[][] = []
    for (const lat of [-60, -30, 30, 60]) rest.push(gridLine(lat, false, R_GRID))
    for (let lon = -150; lon <= 180; lon += 30) rest.push(gridLine(lon, true, R_GRID))
    return [segments(rest), segments([gridLine(0, false, R_GRID)])]
  }, [])
  useEffect(
    () => () => {
      lines.dispose()
      equator.dispose()
    },
    [lines, equator],
  )
  return (
    <group ref={group}>
      <lineSegments geometry={lines} renderOrder={2}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.09} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={equator} renderOrder={2}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.2} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

/** A light from over the viewer's shoulder: the side you look at is lit, and relief still reads. */
function Lights() {
  const light = useMemo(() => new DirectionalLight('#ffffff', 2.7), [])
  useFrame(({ camera }) => {
    lightOffset.set(-0.45, 0.55, 0).applyQuaternion(camera.quaternion).multiplyScalar(camera.position.length())
    light.position.copy(camera.position).add(lightOffset)
  })
  return (
    <>
      <ambientLight intensity={0.32} />
      <primitive object={light} />
    </>
  )
}

/** Keeps an HTML icon over a surface point; `--heading` turns it along the heading on screen. */
function place(el: HTMLElement | null, mark: (LatLon & { heading?: number | null }) | null, camera: Camera, w: number, h: number) {
  if (!el) return
  if (!mark) {
    el.style.opacity = '0'
    return
  }
  const dist = camera.position.length()
  const v = toVector(mark, 1 + markLift(dist))
  const visible = facesCamera(v, camera.position.toArray() as Vec3)
  projected.set(...v).project(camera)
  const x = ((projected.x + 1) / 2) * w
  const y = ((1 - projected.y) / 2) * h
  if (mark.heading !== null && mark.heading !== undefined) {
    const d = headingVector(mark, mark.heading)
    const s = Math.min(0.01, (dist - 1) * 0.1) // a step along the heading, inside the view
    ahead.set(v[0] + d[0] * s, v[1] + d[1] * s, v[2] + d[2] * s).project(camera)
    const angle = Math.atan2(((ahead.x - projected.x) * w) / 2, ((ahead.y - projected.y) * h) / 2)
    el.style.setProperty('--heading', `${(angle * 180) / Math.PI}deg`)
  }
  el.style.transform = `translate(${x}px, ${y}px)`
  el.style.opacity = visible ? '1' : '0'
}

function Trackers({
  here,
  ship,
  pins,
  youRef,
  shipRef,
  pinRefs,
}: {
  here: GlobeCanvasProps['here']
  ship: LatLon | null
  pins: readonly GlobePoint[]
  youRef: RefObject<HTMLDivElement | null>
  shipRef: RefObject<HTMLDivElement | null>
  pinRefs: RefObject<Map<string, HTMLDivElement>>
}) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [here, ship, pins, invalidate])
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld() // CameraRig moved it this frame, before the render does this
    place(youRef.current, here, camera, size.width, size.height)
    place(shipRef.current, ship, camera, size.width, size.height)
    for (const p of pins) place(pinRefs.current.get(p.id) ?? null, p, camera, size.width, size.height)
  })
  return null
}

/** The spot on the unit sphere under a point of the view (fractions of its width and height), or null past the planet. */
function groundAt(camera: PerspectiveCamera, fx: number, fy: number): LatLon | null {
  const eye = camera.position
  ray.set(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(camera).sub(eye).normalize()
  const b = eye.dot(ray)
  const disc = b * b - (eye.lengthSq() - 1)
  if (disc < 0) return null
  const hit = -b - Math.sqrt(disc)
  if (hit < 0) return null
  return toLatLon([eye.x + ray.x * hit, eye.y + ray.y * hit, eye.z + ray.z * hit])
}

/**
 * Orbit controls around the planet; slower to turn the closer you look; flights to `focus`. Zoom
 * goes by the height over the ground (`zoomRef`: a factor the wheel and pinch gather between frames),
 * so it slows near the ground instead of stopping far above it; OrbitControls' own dolly is off
 * (zoomSpeed 0) but it still keeps the page from scrolling under the wheel.
 */
function CameraRig({
  focus,
  reducedMotion,
  radiusM,
  zoomRef,
}: {
  focus: GlobeFocus
  reducedMotion: boolean
  radiusM: number
  zoomRef: RefObject<number>
}) {
  const minDistance = 1 + MIN_HEIGHT_M / radiusM
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const invalidate = useThree((s) => s.invalidate)
  const flight = useRef<{ phi: number; theta: number } | null>(null)
  const height = useRef<number | null>(null) // the height the camera eases to
  const drawn = useRef(new Vector3()) // where the last frame had the camera
  const placed = useRef(false)

  useEffect(() => {
    const goal = viewAngles(focus)
    const down = focus.heightM === undefined ? null : Math.min(MAX_DISTANCE - 1, Math.max(minDistance - 1, focus.heightM / radiusM))
    if (!placed.current || reducedMotion) {
      // The first view (and every one with reduced motion) jumps there.
      placed.current = true
      spherical.set(down !== null ? 1 + down : camera.position.length() || START_DISTANCE, goal.phi, goal.theta)
      camera.position.setFromSpherical(spherical)
      camera.lookAt(0, 0, 0)
      controls.current?.update()
    } else {
      flight.current = goal
      if (down !== null) height.current = down
    }
    invalidate()
  }, [focus, camera, invalidate, reducedMotion, minDistance, radiusM])

  useFrame((state, dt) => {
    const now = camera.position.length() - 1
    const c = controls.current
    // About 2.5 times the ground under the finger, whatever the height (0.1 h would keep pace).
    if (c) c.rotateSpeed = Math.min(0.6, now * 0.25)
    if (zoomRef.current !== 1) {
      const want = (height.current ?? now) * zoomRef.current
      height.current = Math.min(MAX_DISTANCE - 1, Math.max(minDistance - 1, want))
      zoomRef.current = 1
    }
    const f = flight.current
    if (f) {
      state.invalidate()
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5)
      spherical.setFromVector3(camera.position)
      const dTheta = Math.atan2(Math.sin(f.theta - spherical.theta), Math.cos(f.theta - spherical.theta))
      const dPhi = f.phi - spherical.phi
      // Landed when off by a pixel or so at any height (sin phi: theta steps shrink at the poles).
      const close = 0.002 * Math.min(1, now)
      const done = Math.abs(dPhi) < close && Math.abs(dTheta * Math.sin(spherical.phi)) < close
      spherical.phi = done ? f.phi : spherical.phi + dPhi * k
      spherical.theta = done ? spherical.theta + dTheta : spherical.theta + dTheta * k
      camera.position.setFromSpherical(spherical)
      camera.lookAt(0, 0, 0)
      if (done) flight.current = null
    }
    const h = height.current
    if (h !== null) {
      state.invalidate()
      const step = Math.log(h / now)
      const done = Math.abs(step) < 1e-3
      camera.position.setLength(1 + (done ? h : now * Math.exp(step * (1 - Math.exp(-Math.min(dt, 0.1) * 14)))))
      if (done) height.current = null
    }
    // The near plane follows the camera down, so the ground under it is never cut away.
    const cam = state.camera as PerspectiveCamera
    const near = Math.min(0.01, (cam.position.length() - 1) * 0.5)
    if (Math.abs(cam.near - near) > near * 0.01) {
      cam.near = near
      cam.updateProjectionMatrix()
    }
    // OrbitControls asks for a frame only once the camera moved 1e-3 radii (more than the whole
    // view close up): while it still glides by over a tenth of a pixel, the next frame comes here.
    const glide = (cam.position.length() - 1) * 1e-4
    if (cam.position.distanceToSquared(drawn.current) > glide * glide) state.invalidate()
    drawn.current.copy(cam.position)
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.1}
      zoomSpeed={0}
      minDistance={minDistance}
      maxDistance={MAX_DISTANCE}
      onStart={() => {
        flight.current = null
      }}
    />
  )
}

const DRAG_PX = 6

export default function GlobeCanvas({
  visual,
  seed,
  radiusM,
  points,
  path,
  here,
  selected,
  onPick,
  onGround,
  focus,
  label,
  className = '',
}: GlobeCanvasProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const eventSource = useRef<HTMLDivElement>(null)
  const youRef = useRef<HTMLDivElement>(null)
  const shipRef = useRef<HTMLDivElement>(null)
  const pinRefs = useRef(new Map<string, HTMLDivElement>())
  const camera = useRef<PerspectiveCamera | null>(null)
  const invalidate = useRef<(() => void) | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const zoom = useRef(1)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null) // the distance between the two fingers
  const twoFingers = useRef(false) // in this gesture: it picks nothing

  const layers = useMemo(() => {
    const by = new Map<keyof typeof LAYER_STYLE, GlobePoint[]>()
    // Your ship, landings, take-offs and bookmarks are icons over the globe, not WebGL points.
    for (const p of points) {
      if (p.layer !== 'ship' && p.layer !== 'bookmarks' && !LAYER_ICON[p.layer]) by.set(p.layer, [...(by.get(p.layer) ?? []), p])
    }
    return [...by.entries()]
  }, [points])
  const pins = useMemo(() => points.filter((p) => p.layer === 'bookmarks'), [points])
  const icons = useMemo(() => points.filter((p) => LAYER_ICON[p.layer]), [points])
  const tracked = useMemo(() => [...icons, ...pins], [icons, pins])
  const shipPoint = points.find((p) => p.layer === 'ship') ?? null
  const ship = useMemo(() => (shipPoint ? { lat: shipPoint.lat, lon: shipPoint.lon } : null), [shipPoint])
  const offsets = useMemo(() => {
    const row = [...icons, ...(shipPoint ? [shipPoint] : [])]
    row.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || (ROW_RANK[a.layer] ?? 0) - (ROW_RANK[b.layer] ?? 0))
    return sideBySide(row, radiusM, SAME_SPOT_M, ICON_STEP_PX)
  }, [icons, shipPoint, radiusM])
  // An icon moved aside shows it is chosen itself: the ring would circle the spot between icons.
  const ringed = selected && !offsets.has(selected.id) ? selected : null
  const line = useMemo(
    // Fine steps: the chords stay over the ground however low the marks ride.
    () => (here && selected ? greatCircle(here, selected, 1, 0.2) : null),
    [here, selected],
  )

  // Pairs of ends, every stretch in one draw; points metres apart: straight chords hug the ground.
  const pathPairs = useMemo(() => {
    const out: Vec3[] = []
    for (const line of path) for (let i = 1; i < line.length; i++) out.push(toVector(line[i - 1]), toVector(line[i]))
    return out
  }, [path])

  const onCreated = (state: RootState) => {
    camera.current = state.camera as PerspectiveCamera
    invalidate.current = state.invalidate
  }

  const zoomBy = (factor: number) => {
    zoom.current *= factor
    invalidate.current?.()
  }
  const spread = () => {
    const [a, b] = [...touches.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const release = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId)
    pinch.current = touches.current.size === 2 ? spread() : null
  }

  const onWheel = (e: ReactWheelEvent) => {
    const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)
    zoomBy(Math.exp(Math.max(-300, Math.min(300, px)) * WHEEL_ZOOM))
  }
  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
    if (e.pointerType !== 'touch') return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.size === 2) {
      pinch.current = spread()
      twoFingers.current = true
    }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    // A drag turns the camera here, between frames: draw it (OrbitControls may not ask, see CameraRig).
    if (down.current || touches.current.size > 0) invalidate.current?.()
    if (!touches.current.has(e.pointerId)) return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const before = pinch.current
    if (touches.current.size !== 2 || !before) return
    const now = spread()
    if (now > 0) zoomBy(before / now)
    pinch.current = now
  }
  const onPointerCancel = (e: ReactPointerEvent) => {
    release(e)
    down.current = null
    if (touches.current.size === 0) twoFingers.current = false
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    release(e)
    const pinched = twoFingers.current
    if (touches.current.size === 0) twoFingers.current = false
    const start = down.current
    down.current = null
    const cam = camera.current
    const el = eventSource.current
    if (pinched || !start || !cam || !el || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_PX) return
    const r = el.getBoundingClientRect()
    const eye = cam.position.toArray() as Vec3
    const lifted = 1 + markLift(cam.position.length())
    const screen: ScreenPoint[] = []
    for (const p of points) {
      const v = toVector(p, lifted)
      if (!facesCamera(v, eye)) continue
      projected.set(...v).project(cam)
      screen.push({ id: p.id, x: ((projected.x + 1) / 2) * r.width + (offsets.get(p.id) ?? 0), y: ((1 - projected.y) / 2) * r.height })
    }
    const picked = pickNear(screen, e.clientX - r.left, e.clientY - r.top, coarse ? 22 : 14)
    onPick(picked)
    if (picked.length === 0) onGround?.(groundAt(cam, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height))
  }

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl ring-1 ring-zinc-800/80 ${className}`}
      style={{ background: 'radial-gradient(70% 70% at 50% 50%, #0b1220 0%, #03050a 100%)' }}
      role="group"
      aria-label={label}
    >
      <div
        ref={eventSource}
        className="absolute inset-0"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <Canvas
          dpr={[1, 2]}
          frameloop="demand"
          camera={{ fov: 35, near: 0.01, far: 50, position: [START_DISTANCE, 0, 0] }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          eventSource={eventSource as RefObject<HTMLElement>}
          onCreated={onCreated}
          style={{ position: 'absolute', inset: 0 }}
        >
          {/* First: the camera moves before anything that follows it reads where it is. */}
          <CameraRig focus={focus} reducedMotion={reducedMotion} radiusM={radiusM} zoomRef={zoom} />
          <Lights />
          <PlanetSurface visual={visual} seed={seed} />
          <Grid />
          <Lifted>
            {pathPairs.length > 0 && (
              <Line
                points={pathPairs}
                segments
                color={LAYER_STYLE.track.color}
                lineWidth={LAYER_STYLE.track.size}
                transparent
                opacity={0.9}
                depthWrite={false}
                renderOrder={8}
              />
            )}
            {layers.map(([layer, pts]) => (
              <MarkLayer key={layer} points={pts} style={LAYER_STYLE[layer]} />
            ))}
            {ringed && <SelectionRing point={ringed} />}
            {line && (
              <Line points={line} color={YOU_COLOR} lineWidth={2} transparent opacity={0.85} depthWrite={false} renderOrder={9} />
            )}
          </Lifted>
          <Trackers here={here} ship={ship} pins={tracked} youRef={youRef} shipRef={shipRef} pinRefs={pinRefs} />
        </Canvas>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {icons.map((p) => {
            const Icon = LAYER_ICON[p.layer]
            if (!Icon) return null
            const chosen = p.id === selected?.id && offsets.has(p.id)
            return (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) pinRefs.current.set(p.id, el)
                  else pinRefs.current.delete(p.id)
                }}
                className="absolute top-0 left-0 opacity-0"
                style={{ willChange: 'transform' }}
              >
                <span
                  className={`flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-950/85 ${
                    chosen ? 'ring-2 ring-zinc-50' : 'ring-1 ring-zinc-400/60'
                  }`}
                  style={{ color: LAYER_STYLE[p.layer].color, marginLeft: offsets.get(p.id) ?? 0 }}
                >
                  <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
                </span>
              </div>
            )
          })}
          {pins.map((p) => {
            const style = CATEGORY_STYLE[p.bookmark?.category ?? 'other']
            const Icon = style.icon
            return (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) pinRefs.current.set(p.id, el)
                  else pinRefs.current.delete(p.id)
                }}
                className="absolute top-0 left-0 opacity-0"
                style={{ willChange: 'transform' }}
              >
                <span
                  className="flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-950/85 ring-1"
                  style={{ color: style.hex, boxShadow: `inset 0 0 0 1.5px ${style.hex}` }}
                >
                  <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
                </span>
              </div>
            )
          })}
          <div ref={shipRef} className="absolute top-0 left-0 opacity-0" style={{ willChange: 'transform' }}>
            <span
              className={`flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-950/80 ${
                selected?.id === 'ship' && offsets.has('ship') ? 'ring-2 ring-zinc-50' : 'ring-1 ring-zinc-400/60'
              }`}
              style={{ color: SHIP_COLOR, marginLeft: offsets.get('ship') ?? 0 }}
            >
              <Rocket className="size-4" strokeWidth={2.25} aria-hidden />
            </span>
          </div>
          <div ref={youRef} className="absolute top-0 left-0 opacity-0" style={{ willChange: 'transform' }}>
            <span
              className="flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-sky-400/15 ring-1 ring-sky-400/50"
              style={{ color: YOU_COLOR }}
            >
              {here?.heading !== null && here?.heading !== undefined ? (
                <Navigation2
                  className="size-5"
                  fill="currentColor"
                  strokeWidth={1.5}
                  style={{ transform: 'rotate(var(--heading, 0deg))' }}
                  aria-hidden
                />
              ) : (
                <span className="size-3 rounded-full bg-current" />
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

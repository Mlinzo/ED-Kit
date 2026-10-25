// The planet globe (lazy chunk: three.js, react-three-fiber, drei). Marks are WebGL points, one
// draw per layer; you and your ship are HTML icons kept over their spot every frame.

import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import { Navigation2, Rocket } from 'lucide-react'
import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  ShaderMaterial,
  Spherical,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BodyVisual } from '../../../api/types'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import type { LatLon } from '../../../lib/geo'
import { PlanetSurface } from '../../../map/visuals'
import { facesCamera, gridLine, greatCircle, headingVector, pickNear, toVector, viewAngles, type ScreenPoint, type Vec3 } from './geometry'
import { LAYER_STYLE, SHIP_COLOR, YOU_COLOR, type GlobePoint, type LayerStyle } from './layers'

export interface GlobeCanvasProps {
  visual: BodyVisual
  /** As on the system map (the body id), so the planet looks the same there. */
  seed: number
  /** The marks to draw (hidden layers already left out). */
  points: readonly GlobePoint[]
  here: (LatLon & { heading: number | null }) | null
  selected: GlobePoint | null
  /** Ids of the marks under a click or tap, nearest first ([] on empty ground). */
  onPick: (ids: string[]) => void
  /** The view turns to this point whenever a new object is passed. */
  focus: LatLon
  label: string
  className?: string
}

// Heights above the unit sphere: grid, marks, the line to a mark (none sink into the facets).
const R_GRID = 1.0015
const R_MARK = 1.004
const R_LINE = 1.003
const START_DISTANCE = 3.7 // the whole globe fits the fov with a margin
const MIN_DISTANCE = 1.12
const MAX_DISTANCE = 6

const spherical = new Spherical()
const projected = new Vector3()
const ahead = new Vector3()
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
  vec3 toCamera = normalize(cameraPosition - position);
  vFade = smoothstep(0.02, 0.22, dot(normalize(position), toCamera));
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

function pointsGeometry(points: readonly LatLon[]): BufferGeometry {
  const positions = new Float32Array(points.length * 3)
  points.forEach((p, i) => positions.set(toVector(p, R_MARK), i * 3))
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

/** Parallels and meridians every 30°, the equator brighter. */
function Grid() {
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
    <>
      <lineSegments geometry={lines} renderOrder={2}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.09} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={equator} renderOrder={2}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.2} depthWrite={false} />
      </lineSegments>
    </>
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
  const v = toVector(mark, R_MARK)
  const visible = facesCamera(v, camera.position.toArray() as Vec3)
  projected.set(...v).project(camera)
  const x = ((projected.x + 1) / 2) * w
  const y = ((1 - projected.y) / 2) * h
  if (mark.heading !== null && mark.heading !== undefined) {
    const d = headingVector(mark, mark.heading)
    ahead.set(v[0] + d[0] * 0.01, v[1] + d[1] * 0.01, v[2] + d[2] * 0.01).project(camera)
    const angle = Math.atan2(((ahead.x - projected.x) * w) / 2, ((ahead.y - projected.y) * h) / 2)
    el.style.setProperty('--heading', `${(angle * 180) / Math.PI}deg`)
  }
  el.style.transform = `translate(${x}px, ${y}px)`
  el.style.opacity = visible ? '1' : '0'
}

function Trackers({
  here,
  ship,
  youRef,
  shipRef,
}: {
  here: GlobeCanvasProps['here']
  ship: LatLon | null
  youRef: RefObject<HTMLDivElement | null>
  shipRef: RefObject<HTMLDivElement | null>
}) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => invalidate(), [here, ship, invalidate])
  useFrame(({ camera, size }) => {
    place(youRef.current, here, camera, size.width, size.height)
    place(shipRef.current, ship, camera, size.width, size.height)
  })
  return null
}

/** Orbit controls around the planet; slower to turn the closer you look; flights to `focus`. */
function CameraRig({ focus, reducedMotion }: { focus: LatLon; reducedMotion: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const flight = useRef<{ phi: number; theta: number } | null>(null)
  const placed = useRef(false)

  useEffect(() => {
    const goal = viewAngles(focus)
    if (!placed.current || reducedMotion) {
      // The first view (and every one with reduced motion) jumps there.
      placed.current = true
      spherical.set(camera.position.length() || START_DISTANCE, goal.phi, goal.theta)
      camera.position.setFromSpherical(spherical)
      camera.lookAt(0, 0, 0)
      controls.current?.update()
    } else {
      flight.current = goal
    }
    invalidate()
  }, [focus, camera, invalidate, reducedMotion])

  useFrame((state, dt) => {
    const c = controls.current
    if (c) c.rotateSpeed = Math.min(0.6, Math.max(0.04, (camera.position.length() - 1) * 0.45))
    const f = flight.current
    if (!f) return
    state.invalidate()
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5)
    spherical.setFromVector3(camera.position)
    const dTheta = Math.atan2(Math.sin(f.theta - spherical.theta), Math.cos(f.theta - spherical.theta))
    const dPhi = f.phi - spherical.phi
    spherical.phi += dPhi * k
    spherical.theta += dTheta * k
    camera.position.setFromSpherical(spherical)
    camera.lookAt(0, 0, 0)
    if (Math.abs(dPhi) < 1e-3 && Math.abs(dTheta) < 1e-3) flight.current = null
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.1}
      zoomSpeed={0.8}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      onStart={() => {
        flight.current = null
      }}
    />
  )
}

const DRAG_PX = 6

export default function GlobeCanvas({ visual, seed, points, here, selected, onPick, focus, label, className = '' }: GlobeCanvasProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const eventSource = useRef<HTMLDivElement>(null)
  const youRef = useRef<HTMLDivElement>(null)
  const shipRef = useRef<HTMLDivElement>(null)
  const camera = useRef<PerspectiveCamera | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)

  const layers = useMemo(() => {
    const by = new Map<keyof typeof LAYER_STYLE, GlobePoint[]>()
    for (const p of points) if (p.layer !== 'ship') by.set(p.layer, [...(by.get(p.layer) ?? []), p])
    return [...by.entries()]
  }, [points])
  const shipPoint = points.find((p) => p.layer === 'ship') ?? null
  const ship = useMemo(() => (shipPoint ? { lat: shipPoint.lat, lon: shipPoint.lon } : null), [shipPoint])
  const line = useMemo(
    () => (here && selected ? greatCircle(here, selected, R_LINE) : null),
    [here, selected],
  )

  const onCreated = (state: RootState) => {
    camera.current = state.camera as PerspectiveCamera
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = down.current
    down.current = null
    const cam = camera.current
    const el = eventSource.current
    if (!start || !cam || !el || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_PX) return
    const r = el.getBoundingClientRect()
    const eye = cam.position.toArray() as Vec3
    const screen: ScreenPoint[] = []
    for (const p of points) {
      const v = toVector(p, R_MARK)
      if (!facesCamera(v, eye)) continue
      projected.set(...v).project(cam)
      screen.push({ id: p.id, x: ((projected.x + 1) / 2) * r.width, y: ((1 - projected.y) / 2) * r.height })
    }
    onPick(pickNear(screen, e.clientX - r.left, e.clientY - r.top, coarse ? 22 : 14))
  }

  return (
    <div
      className={`relative isolate overflow-hidden rounded-2xl ring-1 ring-zinc-800/80 ${className}`}
      style={{ background: 'radial-gradient(70% 70% at 50% 50%, #0b1220 0%, #03050a 100%)' }}
      role="group"
      aria-label={label}
    >
      <div ref={eventSource} className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <Canvas
          dpr={[1, 2]}
          frameloop="demand"
          camera={{ fov: 35, near: 0.01, far: 50, position: [START_DISTANCE, 0, 0] }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          eventSource={eventSource as RefObject<HTMLElement>}
          onCreated={onCreated}
          style={{ position: 'absolute', inset: 0 }}
        >
          <Lights />
          <PlanetSurface visual={visual} seed={seed} />
          <Grid />
          {layers.map(([layer, pts]) => (
            <MarkLayer key={layer} points={pts} style={LAYER_STYLE[layer]} />
          ))}
          {selected && <SelectionRing point={selected} />}
          {line && (
            <Line points={line} color={YOU_COLOR} lineWidth={2} transparent opacity={0.85} depthWrite={false} renderOrder={9} />
          )}
          <Trackers here={here} ship={ship} youRef={youRef} shipRef={shipRef} />
          <CameraRig focus={focus} reducedMotion={reducedMotion} />
        </Canvas>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div ref={shipRef} className="absolute top-0 left-0 opacity-0" style={{ willChange: 'transform' }}>
            <span
              className="flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-950/80 ring-1 ring-zinc-400/60"
              style={{ color: SHIP_COLOR }}
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

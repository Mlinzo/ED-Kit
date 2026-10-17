// What the route map draws, back to front: the floor grid, the corridor (line mode) or the search
// radius (riches mode), the stalks that drop each system to the floor, the paths, the stops,
// and the markers on top (next target, you, hover, selection).

import { Grid, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  NormalBlending,
  Quaternion,
  Vector3,
  type ShaderMaterial,
} from 'three'
import { DESTINATION_COLOR, rgb, STALK_COLOR, START_COLOR, STATE_COLOR, YOU_COLOR } from './colors'
import { circle, SCENE_RADIUS, type RouteScene, type Vec3 } from './geometry'

/** A geometry of the given attributes (position first). */
function geometryOf(attributes: Record<string, [Float32Array, number]>): BufferGeometry {
  const g = new BufferGeometry()
  for (const [name, [array, itemSize]] of Object.entries(attributes)) g.setAttribute(name, new BufferAttribute(array, itemSize))
  return g
}

/** Frees a memoized geometry's GPU buffers when it is replaced or unmounted. */
function useDisposed(geometry: BufferGeometry): BufferGeometry {
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

export const Floor = memo(function Floor({ floorY, cell }: { floorY: number; cell: number }) {
  return (
    <Grid
      position={[0, floorY, 0]}
      args={[SCENE_RADIUS * 10, SCENE_RADIUS * 10]}
      cellSize={cell}
      sectionSize={cell * 5}
      cellThickness={1}
      sectionThickness={1.4}
      cellColor="#1f3350"
      sectionColor="#2f4d70"
      fadeDistance={SCENE_RADIUS * 4}
      fadeStrength={1.6}
      fadeFrom={0}
      side={DoubleSide}
      renderOrder={-1}
    />
  )
})

/** Line mode: the tube searched around the straight line, faint, with its axis dashed. */
export const Corridor = memo(function Corridor({ from, to, radius }: { from: Vec3; to: Vec3; radius: number }) {
  const { mid, quaternion, length } = useMemo(() => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    return {
      mid: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), len > 0 ? dir.normalize() : new Vector3(0, 1, 0)),
      length: len,
    }
  }, [from, to])
  const ring = useMemo(() => circle(radius, 64), [radius])
  const axis = useMemo<Vec3[]>(
    () => [
      [0, -length / 2, 0],
      [0, length / 2, 0],
    ],
    [length],
  )
  if (length <= 0) return null
  return (
    <group position={mid} quaternion={quaternion}>
      <mesh renderOrder={1}>
        <cylinderGeometry args={[radius, radius, length, 48, 1, true]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.035} side={DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={ring} position={[0, -length / 2, 0]} color="#38bdf8" lineWidth={1} transparent opacity={0.25} depthWrite={false} />
      <Line points={ring} position={[0, length / 2, 0]} color="#38bdf8" lineWidth={1} transparent opacity={0.25} depthWrite={false} />
      <Line
        points={axis}
        color="#a1a1aa"
        lineWidth={1}
        dashed
        dashSize={1.2}
        gapSize={0.9}
        transparent
        opacity={0.4}
        depthWrite={false}
      />
    </group>
  )
})

/** Riches mode: the search radius around the start, dashed, in the horizontal plane. */
export const SearchRing = memo(function SearchRing({ center, radius }: { center: Vec3; radius: number }) {
  const points = useMemo(() => circle(radius, 128), [radius])
  return (
    <Line
      points={points}
      position={center}
      color="#52525b"
      lineWidth={1}
      dashed
      dashSize={radius * 0.03}
      gapSize={radius * 0.025}
      transparent
      opacity={0.55}
      depthWrite={false}
    />
  )
})

/** A vertical line from every system down to the floor, and a dot where it lands: depth cues. */
export const Stalks = memo(function Stalks({ scene }: { scene: RouteScene }) {
  const points = useMemo(
    () =>
      [...scene.stops.map((s) => s.pos), scene.source, scene.destination, scene.youFramed ? scene.you : null].filter(
        (p): p is Vec3 => p !== null,
      ),
    [scene],
  )
  const floorY = scene.floorY
  const lines = useDisposed(
    useMemo(() => {
      const arr = new Float32Array(points.length * 6)
      points.forEach((p, i) => arr.set([p[0], p[1], p[2], p[0], floorY, p[2]], i * 6))
      return geometryOf({ position: [arr, 3] })
    }, [points, floorY]),
  )
  const feet = useDisposed(
    useMemo(() => {
      const arr = new Float32Array(points.length * 3)
      points.forEach((p, i) => arr.set([p[0], floorY, p[2]], i * 3))
      return geometryOf({ position: [arr, 3] })
    }, [points, floorY]),
  )
  return (
    <>
      <lineSegments geometry={lines} renderOrder={2} frustumCulled={false}>
        <lineBasicMaterial color={STALK_COLOR} transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
      <points geometry={feet} renderOrder={2} frustumCulled={false}>
        {/* On the floor, under nothing but the grid (which writes depth): not depth-tested. */}
        <pointsMaterial color={STALK_COLOR} size={2.5} sizeAttenuation={false} transparent opacity={0.55} depthWrite={false} depthTest={false} />
      </points>
    </>
  )
})

const AHEAD_NEAR = new Color('#38bdf8')
const AHEAD_FAR = new Color('#1e4f73')

/**
 * The path flown so far (faint emerald), the path ahead (sky, fading towards its end so the
 * direction reads), the last stretch to the destination (dashed) and you → the next stop (dashed).
 */
export const Paths = memo(function Paths({ scene }: { scene: RouteScene }) {
  const aheadColors = useMemo(
    () => scene.aheadPath.map((_, i, a) => AHEAD_NEAR.clone().lerp(AHEAD_FAR, a.length > 1 ? (i / (a.length - 1)) * 0.75 : 0)),
    [scene.aheadPath],
  )
  const next = scene.stops.find((s) => s.state === 'next')
  const you = scene.you
  const toNext = useMemo<Vec3[] | null>(() => (you && next && !next.here ? [you, next.pos] : null), [you, next])
  const dash = SCENE_RADIUS * 0.02
  return (
    <>
      {scene.donePath.length > 0 && (
        <Line points={scene.donePath} color="#34d399" lineWidth={1.5} transparent opacity={0.4} depthWrite={false} renderOrder={3} />
      )}
      {scene.aheadPath.length > 0 && (
        <Line points={scene.aheadPath} vertexColors={aheadColors} lineWidth={2.2} transparent opacity={0.95} depthWrite={false} renderOrder={3} />
      )}
      {scene.tailPath.length > 0 && (
        <Line
          points={scene.tailPath}
          color="#a1a1aa"
          lineWidth={1.2}
          dashed
          dashSize={dash}
          gapSize={dash}
          transparent
          opacity={0.5}
          depthWrite={false}
          renderOrder={3}
        />
      )}
      {toNext && (
        <Line
          points={toNext}
          color={YOU_COLOR}
          lineWidth={1.4}
          dashed
          dashSize={dash * 0.6}
          gapSize={dash * 0.6}
          transparent
          opacity={0.7}
          depthWrite={false}
          renderOrder={3}
        />
      )}
    </>
  )
})

const dotVertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  attribute float hollow;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vHollow;
  varying float vPx;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vPx = size * uPixelRatio;
    gl_PointSize = vPx;
    vColor = color;
    vHollow = hollow;
  }
`

const dotFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vHollow;
  varying float vPx;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float aa = 2.0 / max(vPx, 1.0);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    vec3 col = vColor;
    if (vHollow > 0.5) {
      alpha *= smoothstep(0.5 - aa, 0.5, d);
    } else {
      // A dark rim keeps a dot readable over the lines and the grid.
      col = mix(vColor, vec3(0.02, 0.03, 0.05), smoothstep(0.68 - aa, 0.68, d) * 0.85);
    }
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`

/** Every stop as a round dot: colour by state, size by value; skipped stops hollow. */
export const StopDots = memo(function StopDots({ scene }: { scene: RouteScene }) {
  const stops = scene.stops
  const geometry = useDisposed(
    useMemo(() => {
      const n = stops.length
      const pos = new Float32Array(n * 3)
      const col = new Float32Array(n * 3)
      const size = new Float32Array(n)
      const hollow = new Float32Array(n)
      stops.forEach((s, i) => {
        pos.set(s.pos, i * 3)
        col.set(rgb(STATE_COLOR[s.state]), i * 3)
        size[i] = s.size
        hollow[i] = s.state === 'skipped' ? 1 : 0
      })
      return geometryOf({ position: [pos, 3], color: [col, 3], size: [size, 1], hollow: [hollow, 1] })
    }, [stops]),
  )
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uPixelRatio: { value: 1 } }), [])
  useFrame((state) => {
    if (material.current) material.current.uniforms.uPixelRatio.value = state.viewport.dpr
  })
  return (
    <points geometry={geometry} renderOrder={4} frustumCulled={false}>
      <shaderMaterial ref={material} vertexShader={dotVertex} fragmentShader={dotFragment} uniforms={uniforms} transparent depthWrite={false} />
    </points>
  )
})

const markerVertex = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio;
  }
`

const markerFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uInner;
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float aa = 2.0 / max(uSize * uPixelRatio, 1.0);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    // A ring from uInner to the edge, a disc (uInner < 0) or a soft glow (uInner = 0).
    if (uInner > 0.0) alpha *= smoothstep(uInner - aa, uInner, d);
    else if (uInner == 0.0) alpha *= (1.0 - d) * (1.0 - d);
    alpha *= uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

type MarkerShape = 'ring' | 'disc' | 'glow'

/**
 * One screen-space marker at a point (size in CSS px): a ring (`inner` = its inner edge, 0–1 of
 * the radius), a disc or a soft glow. `pulse` (seconds) grows and fades it in a loop.
 */
export function Marker({
  pos,
  color,
  size,
  shape = 'ring',
  inner = 0.6,
  opacity = 1,
  pulse = 0,
  additive = false,
  order = 5,
}: {
  pos: Vec3
  color: string
  size: number
  shape?: MarkerShape
  inner?: number
  opacity?: number
  pulse?: number
  additive?: boolean
  order?: number
}) {
  const [x, y, z] = pos
  const geometry = useDisposed(useMemo(() => geometryOf({ position: [new Float32Array([x, y, z]), 3] }), [x, y, z]))
  // Created once (a ShaderMaterial keeps the uniforms object it was compiled with) and set before
  // every frame through the material.
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uColor: { value: new Vector3() },
      uSize: { value: 1 },
      uInner: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: 1 },
    }),
    [],
  )
  useFrame((state) => {
    const u = material.current?.uniforms
    if (!u) return
    u.uColor.value.set(...rgb(color))
    u.uInner.value = shape === 'ring' ? Math.max(0.01, inner) : shape === 'disc' ? -1 : 0
    u.uPixelRatio.value = state.viewport.dpr
    if (pulse > 0) {
      const t = (state.clock.elapsedTime % pulse) / pulse
      u.uSize.value = size * (0.6 + 0.8 * t)
      u.uOpacity.value = opacity * (1 - t)
    } else {
      u.uSize.value = size
      u.uOpacity.value = opacity
    }
  })
  return (
    <points geometry={geometry} renderOrder={order} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={markerVertex}
        fragmentShader={markerFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={additive ? AdditiveBlending : NormalBlending}
      />
    </points>
  )
}

/** Start and destination of the route: a pale ring and an amber one with a dot inside. */
export const Endpoints = memo(function Endpoints({ source, destination }: { source: Vec3 | null; destination: Vec3 | null }) {
  return (
    <>
      {source && <Marker pos={source} color={START_COLOR} size={11} inner={0.55} opacity={0.9} order={4} />}
      {destination && (
        <>
          <Marker pos={destination} color={DESTINATION_COLOR} size={15} inner={0.62} order={4} />
          <Marker pos={destination} color={DESTINATION_COLOR} size={5} shape="disc" order={4} />
        </>
      )}
    </>
  )
})

// What the galaxy map draws, back to front: the sketched galaxy and the rings around its core,
// your path, the visited systems, deaths, the routes ahead, and the landmarks.

import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, type PerspectiveCamera, type ShaderMaterial } from 'three'
import { rgb } from '../../route/map/colors'
import { circle, type Vec3 } from '../../route/map/geometry'
import { Marker } from '../../route/map/layers'
import { buildBackdrop } from './backdrop'
import { DEATH_COLOR, DOT_COLOR, LANDMARK_COLOR, PATH_NEW, PATH_OLD, PLOTTED_COLOR, ROUTE_COLOR } from './colors'
import { at, CORE, DISK_RADIUS_LY, RING_STEP_LY, SCALE, type GalaxyScene } from './geometry'

function useDisposed(geometry: BufferGeometry): BufferGeometry {
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

const backdropVertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uProjection;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // World-sized points: a disk of stars from afar, nothing in your face up close.
    float px = size * uProjection / max(-mv.z, 1e-3);
    float shown = clamp(px, 0.0, 2.6);
    vAlpha = min(1.0, px / 0.6) * min(1.0, pow(2.6 / max(px, 2.6), 2.0));
    gl_PointSize = max(shown, 1.0) * uPixelRatio;
    vColor = color;
  }
`

const backdropFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.4, 1.0, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`

/** The sketched galaxy: ~60 000 points, built once. */
export const Backdrop = memo(function Backdrop() {
  const geometry = useDisposed(
    useMemo(() => {
      const b = buildBackdrop()
      const pos = new Float32Array(b.count * 3)
      for (let i = 0; i < b.count; i++) {
        const p = at({ x: b.positions[i * 3], y: b.positions[i * 3 + 1], z: b.positions[i * 3 + 2] })
        pos.set(p, i * 3)
      }
      const sizes = b.sizes.map((s) => s * SCALE)
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(pos, 3))
      g.setAttribute('color', new BufferAttribute(b.colors, 3))
      g.setAttribute('size', new BufferAttribute(sizes, 1))
      return g
    }, []),
  )
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uProjection: { value: 1 }, uPixelRatio: { value: 1 } }), [])
  useFrame((state) => {
    const u = material.current?.uniforms
    if (!u) return
    const camera = state.camera as PerspectiveCamera
    // Pixels per scene unit at distance 1.
    u.uProjection.value = state.size.height / (2 * Math.tan(((camera.fov ?? 40) * Math.PI) / 360))
    u.uPixelRatio.value = state.viewport.dpr
  })
  return (
    <points geometry={geometry} renderOrder={0} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={backdropVertex}
        fragmentShader={backdropFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        blending={AdditiveBlending}
      />
    </points>
  )
})

/** Rings around the core in the galactic plane, every RING_STEP_LY: a sense of scale. */
export const Rings = memo(function Rings() {
  const core = at(CORE)
  const rings = useMemo(() => {
    const out: Vec3[][] = []
    for (let r = RING_STEP_LY; r <= DISK_RADIUS_LY; r += RING_STEP_LY) out.push(circle(r * SCALE, 160))
    return out
  }, [])
  return (
    <group position={core}>
      {rings.map((points, i) => (
        <Line key={i} points={points} color="#334155" lineWidth={1} transparent opacity={0.45} depthWrite={false} depthTest={false} renderOrder={1} />
      ))}
    </group>
  )
})

const OLD = new Color(PATH_OLD)
const NEW = new Color(PATH_NEW)

/** Your travels: one line per run, fading from dark (oldest) to sky (latest). */
export const Paths = memo(function Paths({ scene }: { scene: GalaxyScene }) {
  const runs = useMemo(() => {
    const total = scene.paths.reduce((n, run) => n + run.length, 0)
    // Where each run starts in the whole path: the colour keeps fading across the breaks.
    const starts = scene.paths.map((_, k) => scene.paths.slice(0, k).reduce((n, run) => n + run.length, 0))
    return scene.paths.map((run, k) => ({
      run,
      colors: run.map((_, i) => OLD.clone().lerp(NEW, total > 1 ? (starts[k] + i) / (total - 1) : 1)),
    }))
  }, [scene.paths])
  return (
    <>
      {runs.map(({ run, colors }, i) => (
        <Line key={i} points={run} vertexColors={colors} lineWidth={1.5} transparent opacity={0.9} depthWrite={false} depthTest={false} renderOrder={2} />
      ))}
    </>
  )
})

const dotVertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vPx;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vPx = size * uPixelRatio;
    gl_PointSize = vPx;
    vColor = color;
  }
`

const dotFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vPx;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float aa = 2.0 / max(vPx, 1.0);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    vec3 col = mix(vColor, vec3(0.02, 0.03, 0.05), smoothstep(0.66 - aa, 0.66, d) * 0.8);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`

/** Every visited system as a dot: grey, emerald where you earned, amber where you were first. */
export const SystemDots = memo(function SystemDots({ scene }: { scene: GalaxyScene }) {
  const geometry = useDisposed(
    useMemo(() => {
      const n = scene.systems.length
      const pos = new Float32Array(n * 3)
      const col = new Float32Array(n * 3)
      const size = new Float32Array(n)
      scene.systems.forEach((s, i) => {
        pos.set(s.pos, i * 3)
        col.set(rgb(DOT_COLOR[s.kind]), i * 3)
        size[i] = s.size
      })
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(pos, 3))
      g.setAttribute('color', new BufferAttribute(col, 3))
      g.setAttribute('size', new BufferAttribute(size, 1))
      return g
    }, [scene.systems]),
  )
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uPixelRatio: { value: 1 } }), [])
  useFrame((state) => {
    if (material.current) material.current.uniforms.uPixelRatio.value = state.viewport.dpr
  })
  return (
    <points geometry={geometry} renderOrder={4} frustumCulled={false}>
      <shaderMaterial ref={material} vertexShader={dotVertex} fragmentShader={dotFragment} uniforms={uniforms} transparent depthWrite={false} depthTest={false} />
    </points>
  )
})

/** The routes ahead: the planned one (dashed sky) and the one plotted in the game (violet). */
export const Routes = memo(function Routes({ scene }: { scene: GalaxyScene }) {
  return (
    <>
      {scene.route.length > 1 && (
        <Line points={scene.route} color={ROUTE_COLOR} lineWidth={1.4} dashed dashSize={0.4} gapSize={0.3} transparent opacity={0.75} depthWrite={false} depthTest={false} renderOrder={3} />
      )}
      {scene.plotted.length > 1 && (
        <Line points={scene.plotted} color={PLOTTED_COLOR} lineWidth={1.8} transparent opacity={0.85} depthWrite={false} depthTest={false} renderOrder={3} />
      )}
      {scene.route.slice(1).map((p, i) => (
        <Marker key={`r${i}`} pos={p} color={ROUTE_COLOR} size={6} shape="disc" opacity={0.85} order={4} />
      ))}
      {scene.plotted.length > 1 && <Marker pos={scene.plotted.at(-1)!} color={PLOTTED_COLOR} size={9} inner={0.5} order={4} />}
    </>
  )
})

/** Where you died: a rose ring with a dot. */
export const Deaths = memo(function Deaths({ scene }: { scene: GalaxyScene }) {
  return (
    <>
      {scene.deaths.map((d, i) => (
        <group key={i}>
          <Marker pos={d.pos} color={DEATH_COLOR} size={14} inner={0.66} order={5} />
          <Marker pos={d.pos} color={DEATH_COLOR} size={4} shape="disc" order={5} />
        </group>
      ))}
    </>
  )
})

/** Sol, the core, Colonia, Beagle Point: pale rings (named by the labels). */
export const LandmarkMarks = memo(function LandmarkMarks({ points }: { points: Vec3[] }) {
  return (
    <>
      {points.map((p, i) => (
        <Marker key={i} pos={p} color={LANDMARK_COLOR} size={9} inner={0.55} opacity={0.7} order={3} />
      ))}
    </>
  )
})

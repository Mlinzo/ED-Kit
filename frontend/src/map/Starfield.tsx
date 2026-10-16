import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, ShaderMaterial, type Points } from 'three'

const COUNT = 4200
const RADIUS = 4_000

/** Deterministic PRNG so the sky is the same on every load. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildSky(): BufferGeometry {
  const rand = mulberry32(20_260_916)
  const pos = new Float32Array(COUNT * 3)
  const col = new Float32Array(COUNT * 3)
  const size = new Float32Array(COUNT)
  // A faint galactic band: a share of the stars cluster around a tilted great circle.
  const tilt = 0.5
  for (let i = 0; i < COUNT; i++) {
    let x: number
    let y: number
    let z: number
    if (rand() < 0.35) {
      const lon = rand() * Math.PI * 2
      const lat = (rand() + rand() + rand() - 1.5) * 0.16
      x = Math.cos(lat) * Math.cos(lon)
      y = Math.sin(lat)
      z = Math.cos(lat) * Math.sin(lon)
      const ty = y * Math.cos(tilt) - z * Math.sin(tilt)
      const tz = y * Math.sin(tilt) + z * Math.cos(tilt)
      y = ty
      z = tz
    } else {
      const u = rand() * 2 - 1
      const t = rand() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      x = r * Math.cos(t)
      y = u
      z = r * Math.sin(t)
    }
    pos.set([x * RADIUS, y * RADIUS, z * RADIUS], i * 3)
    // Mostly faint; a few bright ones. Slight blue / warm tints.
    const m = Math.pow(rand(), 3.2)
    const b = 0.18 + 0.82 * m
    const tint = rand()
    const [r, g, bl] = tint < 0.2 ? [0.75, 0.85, 1] : tint > 0.88 ? [1, 0.86, 0.7] : [0.92, 0.94, 1]
    col.set([r * b, g * b, bl * b], i * 3)
    size[i] = 0.7 + 2.3 * m
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('color', new BufferAttribute(col, 3))
  geo.setAttribute('size', new BufferAttribute(size, 1))
  return geo
}

const vertexShader = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uPixelRatio;
  uniform float uTime;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.85 + 0.15 * sin(uTime * 0.8 + position.x * 0.013 + position.z * 0.007);
    vColor = color * twinkle;
    gl_PointSize = size * uPixelRatio;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`

/** Distant stars that follow the camera (always "at infinity"), drawn behind everything. */
export function Starfield({ animate }: { animate: boolean }) {
  const ref = useRef<Points>(null)
  const geometry = useMemo(() => buildSky(), [])
  const uniforms = useMemo(() => ({ uPixelRatio: { value: 1 }, uTime: { value: 0 } }), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const p = ref.current
    if (!p) return
    p.position.copy(state.camera.position)
    const u = (p.material as ShaderMaterial).uniforms
    u.uPixelRatio.value = state.viewport.dpr
    if (animate) u.uTime.value = state.clock.elapsedTime
  })

  return (
    <points ref={ref} geometry={geometry} frustumCulled={false} renderOrder={-10}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}

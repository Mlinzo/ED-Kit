// Other players on the galaxy map: a violet dot with a soft halo per system with someone in it
// lately, bigger where several were, fading with age (live.ts).

import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, type ShaderMaterial } from 'three'
import { rgb } from '../../route/map/colors'
import { LIVE_COLOR } from './colors'
import type { LivePoint } from './live'

const vertex = /* glsl */ `
  attribute float size;
  attribute float alpha;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vPx;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Room for the halo around the dot.
    vPx = size * 2.0 * uPixelRatio;
    gl_PointSize = vPx;
    vAlpha = alpha;
  }
`

const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vPx;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float aa = 2.0 / max(vPx, 1.0);
    float core = 1.0 - smoothstep(0.5 - aa, 0.5, d);
    float halo = (1.0 - smoothstep(0.5, 1.0, d)) * 0.35;
    float a = max(core, halo) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export const LiveDots = memo(function LiveDots({ points }: { points: readonly LivePoint[] }) {
  const geometry = useMemo(() => {
    const n = points.length
    const pos = new Float32Array(n * 3)
    const size = new Float32Array(n)
    const alpha = new Float32Array(n)
    points.forEach((p, i) => {
      pos.set(p.pos, i * 3)
      size[i] = p.size
      alpha[i] = p.alpha
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('size', new BufferAttribute(size, 1))
    g.setAttribute('alpha', new BufferAttribute(alpha, 1))
    return g
  }, [points])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uPixelRatio: { value: 1 }, uColor: { value: rgb(LIVE_COLOR) } }), [])
  useFrame((state) => {
    if (material.current) material.current.uniforms.uPixelRatio.value = state.viewport.dpr
  })
  return (
    <points geometry={geometry} renderOrder={3} frustumCulled={false}>
      <shaderMaterial ref={material} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} depthTest={false} />
    </points>
  )
})

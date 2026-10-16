// Asteroid belts around stars: a sparse field of points rather than a solid ring, which
// is how belts read on the in-game system map. Positions are in star radii (the parent
// group is scaled by the star radius); point size follows the group's world scale.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, type IUniform } from 'three'
import { DIM_GLSL } from './glsl'
import { hash01 } from './palette'

export interface BeltBand {
  inner: number
  outer: number
  color: string
}

const PARTICLES_PER_UNIT_AREA = 70 // per square star radius
const MAX_PARTICLES_PER_BAND = 2200

/** Deterministic point cloud for the given bands (flat disc in the XZ plane). */
export function createBeltGeometry(bands: BeltBand[], seed: number): BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const sizes: number[] = []
  const color = new Color()
  let k = 0
  bands.forEach((band, b) => {
    const width = band.outer - band.inner
    const area = Math.PI * (band.outer ** 2 - band.inner ** 2)
    const count = Math.min(MAX_PARTICLES_PER_BAND, Math.round(area * PARTICLES_PER_UNIT_AREA))
    color.set(band.color)
    for (let i = 0; i < count; i++, k++) {
      const h = (n: number) => hash01(seed * 131 + b * 7907 + i, n)
      // Denser in the middle of the band: average of two uniforms (triangular profile).
      const t = (h(1) + h(2)) / 2
      const r = band.inner + width * t
      const a = h(3) * Math.PI * 2
      const y = (h(4) - 0.5) * width * 0.08
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r)
      const shade = 0.45 + 0.55 * h(5) ** 1.5
      colors.push(color.r * shade, color.g * shade, color.b * shade)
      // Mostly dust, a few larger rocks.
      sizes.push(h(6) > 0.97 ? 0.05 + 0.03 * h(7) : 0.012 + 0.022 * h(7))
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1))
  geometry.computeBoundingSphere()
  return geometry
}

const BELT_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 color;
uniform float uHalfHeight; // drawing-buffer height / 2, in pixels
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float scale = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float px = aSize * scale * projectionMatrix[1][1] * uHalfHeight / max(-mv.z, 1e-4);
  gl_PointSize = clamp(px, 1.0, 7.0);
  vColor = color;
  gl_Position = projectionMatrix * mv;
}
`

const BELT_FRAG = /* glsl */ `
uniform float uDim;
uniform float uOpacity;
varying vec3 vColor;
${DIM_GLSL}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float alpha = smoothstep(0.25, 0.02, d) * uOpacity * (1.0 - 0.5 * uDim);
  vec3 col = edkDim(vColor, uDim, 0.7, 0.7);
  gl_FragColor = vec4(col * alpha, alpha);
  #include <colorspace_fragment>
}
`

export function createBeltMaterial(dim: IUniform<number>, halfHeight: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BELT_VERT,
    fragmentShader: BELT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uHalfHeight: { value: halfHeight },
      uDim: dim,
      uOpacity: { value: 0.85 },
    },
  })
}

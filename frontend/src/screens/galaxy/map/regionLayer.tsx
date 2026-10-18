// The codex regions on the galactic plane: their borders, a faint tint where you have been,
// brighter where you are. One quad and a shader over the region grid (a texel per cell): a border
// is where a pixel's neighbour on screen lies in another region, so the lines stay about a pixel
// thin at any zoom, as blocky as the grid (~49 ly) up close.

import { useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, NearestFilter, RedFormat, UnsignedByteType, Vector2, Vector3, Vector4 } from 'three'
import { rgb } from '../../route/map/colors'
import { REGION_LINE, REGION_SELECTED, REGION_VISITED } from './colors'
import { at, CORE, DISK_RADIUS_LY } from './geometry'
import type { RegionGrid } from './regions'

/** Region numbers fit (the game has 42). */
const SLOTS = 64

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  uniform sampler2D uCells;
  uniform float uSize;
  uniform vec4 uTint[${SLOTS}];
  uniform vec3 uLine;
  uniform float uLineAlpha;
  // The core and the disk's edge, in cells: the outer regions' borders run on to the map's edge.
  uniform vec2 uCore;
  uniform vec2 uFade;
  varying vec2 vUv;

  float regionAt(vec2 p) {
    ivec2 c = ivec2(clamp(floor(p), vec2(0.0), vec2(uSize - 1.0)));
    return floor(texelFetch(uCells, c, 0).r * 255.0 + 0.5);
  }

  // 1 where the point lies in another region (outside the galaxy does not count).
  float other(float id, vec2 p) {
    float n = regionAt(p);
    return n != id && n > 0.0 ? 1.0 : 0.0;
  }

  void main() {
    vec2 p = vUv * uSize;
    float id = regionAt(p);
    if (id < 0.5) discard;
    // One and half a pixel away on screen, in cells: a soft line two pixels wide.
    vec2 dx = dFdx(p);
    vec2 dy = dFdy(p);
    float far = max(max(other(id, p + dx), other(id, p - dx)), max(other(id, p + dy), other(id, p - dy)));
    float near = max(max(other(id, p + dx * 0.5), other(id, p - dx * 0.5)), max(other(id, p + dy * 0.5), other(id, p - dy * 0.5)));
    // Near the horizon a pixel spans dozens of cells: fade the lines rather than draw noise.
    float cellsPerPx = max(length(dx), length(dy));
    float inDisk = 1.0 - smoothstep(uFade.x, uFade.y, length(p - uCore));
    float line = (0.4 * far + 0.6 * near) * uLineAlpha * inDisk * (1.0 - smoothstep(12.0, 40.0, cellsPerPx));
    vec4 fill = uTint[int(id)];
    float a = line + fill.a * (1.0 - line);
    if (a < 0.004) discard;
    gl_FragColor = vec4((uLine * line + fill.rgb * fill.a * (1.0 - line)) / a, a);
  }
`

const TINT = { visited: 0.05, here: 0.09, selected: 0.12 }

export const RegionLayer = memo(function RegionLayer({
  grid,
  visited,
  here,
  selected,
}: {
  grid: RegionGrid
  visited: readonly number[]
  here: number | null
  selected: number | null
}) {
  const invalidate = useThree((s) => s.invalidate)
  const texture = useMemo(() => {
    const tex = new DataTexture(grid.cells, grid.size, grid.size, RedFormat, UnsignedByteType)
    tex.magFilter = NearestFilter
    tex.minFilter = NearestFilter
    tex.generateMipmaps = false
    tex.unpackAlignment = 1
    tex.needsUpdate = true
    return tex
  }, [grid])
  useEffect(() => () => texture.dispose(), [texture])

  const geometry = useMemo(() => {
    const x1 = grid.x0 + grid.size * grid.cellLy
    const z1 = grid.z0 + grid.size * grid.cellLy
    const corners = [
      at({ x: grid.x0, y: 0, z: grid.z0 }),
      at({ x: x1, y: 0, z: grid.z0 }),
      at({ x: x1, y: 0, z: z1 }),
      at({ x: grid.x0, y: 0, z: z1 }),
    ]
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(corners.flat()), 3))
    // u along x, v along z: texel rows are the grid's rows, the minimum z first.
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
    g.setIndex([0, 1, 2, 0, 2, 3])
    return g
  }, [grid])
  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(
    () => ({
      uCells: { value: texture },
      uSize: { value: grid.size },
      uTint: { value: Array.from({ length: SLOTS }, () => new Vector4()) },
      uLine: { value: new Vector3(...rgb(REGION_LINE)) },
      uLineAlpha: { value: 0.4 },
      uCore: { value: new Vector2((CORE.x - grid.x0) / grid.cellLy, (CORE.z - grid.z0) / grid.cellLy) },
      uFade: { value: new Vector2((DISK_RADIUS_LY * 0.9) / grid.cellLy, (DISK_RADIUS_LY * 1.08) / grid.cellLy) },
    }),
    [texture, grid],
  )

  useEffect(() => {
    const tint = uniforms.uTint.value
    for (const v of tint) v.set(0, 0, 0, 0)
    const paint = (id: number, color: string, alpha: number) => tint[id]?.set(...rgb(color), alpha)
    for (const id of visited) paint(id, REGION_VISITED, TINT.visited)
    if (here !== null) paint(here, REGION_VISITED, TINT.here)
    if (selected !== null) paint(selected, REGION_SELECTED, TINT.selected)
    invalidate()
  }, [uniforms, visited, here, selected, invalidate])

  return (
    <mesh geometry={geometry} renderOrder={1} frustumCulled={false}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} depthTest={false} side={DoubleSide} />
    </mesh>
  )
})

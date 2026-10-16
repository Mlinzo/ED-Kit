import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Quaternion, Vector3, type Group, type Mesh } from 'three'
import type { BodyVisual } from '../../api/types'
import type { BakeEntry } from './bake'
import { MOTION, useBake, useCompiled, useDetail, useDisposable, useEasedUniform, useShared, useTimeUniform } from './hooks'
import {
  createAtmosphereMaterials,
  createCloudMaterial,
  createRingMaterial,
  createSurfaceMaterial,
} from './planetMaterials'
import { planetRecipe } from './recipe'
import { Reticle } from './Reticle'
import {
  SPHERE,
  SPHERE_LOW,
  SPHERE_MID,
  createRingTexture,
  noRaycast,
  ringGeometry,
  ringTextureKey,
} from './shared'
import { bakeSpec } from './surfaces'

export interface PlanetProps {
  visual: BodyVisual
  radius: number
  seed: number
  dim: boolean
  selected: boolean
  hovered: boolean
  /** Bake order (see useBake); clouds come after every surface of the same priority. */
  priority?: number
}

export function Planet({ visual, radius, seed, dim, selected, hovered, priority = 0 }: PlanetProps) {
  // The API hands out a fresh object on every refetch: key everything on content.
  const vkey = JSON.stringify(visual)
  const recipe = useMemo(() => planetRecipe(JSON.parse(vkey) as BodyVisual, seed), [vkey, seed])
  const dimU = useEasedUniform(dim ? 1 : 0)
  useTimeUniform() // reticle ticks

  const surfaceSpec = useMemo(() => bakeSpec(recipe.surface.program, recipe.surface.params), [recipe])
  const cloudSpec = useMemo(() => (recipe.clouds ? bakeSpec('clouds', recipe.clouds) : null), [recipe])
  const surface = useBake(surfaceSpec, priority * 2 + 1)!
  const clouds = useBake(cloudSpec, priority * 2)

  const rings = recipe.rings
  const ringKey = rings ? ringTextureKey(rings.bands, rings.inner, rings.outer, rings.seed) : null
  const makeRingTexture = useCallback(
    () => createRingTexture(rings!.bands, rings!.inner, rings!.outer, rings!.seed),
    [rings],
  )
  const ringTex = useShared(ringKey, makeRingTexture)

  const surfaceMat = useDisposable(
    useMemo(
      () =>
        createSurfaceMaterial({
          map: surface.texture,
          recipe,
          dim: dimU,
          ring: rings && ringTex ? { texture: ringTex, inner: rings.inner, outer: rings.outer } : null,
        }),
      [surface, recipe, dimU, rings, ringTex],
    ),
  )
  const cloudMat = useDisposable(useMemo(() => (clouds ? createCloudMaterial(clouds.texture, dimU) : null), [clouds, dimU]))
  const atmo = useMemo(
    () => (recipe.atmosphere ? createAtmosphereMaterials(recipe.atmosphere, dimU) : null),
    [recipe, dimU],
  )
  useDisposable(atmo?.inner)
  useDisposable(atmo?.outer)
  const ringMat = useDisposable(
    useMemo(
      () =>
        rings && ringTex
          ? createRingMaterial({ texture: ringTex, inner: rings.inner, outer: rings.outer, dim: dimU })
          : null,
      [rings, ringTex, dimU],
    ),
  )

  const tilt = useMemo(
    () =>
      new Quaternion().setFromAxisAngle(
        new Vector3(Math.cos(recipe.tiltAzimuth), 0, Math.sin(recipe.tiltAzimuth)),
        recipe.tilt,
      ),
    [recipe],
  )

  // Hidden until the surface texture is baked and the materials are compiled (in the
  // background), so nothing pops in half-drawn and the first draw never blocks.
  const rootRef = useRef<Group>(null)
  const bodyRef = useRef<Group>(null)
  const surfRef = useRef<Mesh>(null)
  const cloudRef = useRef<Mesh>(null)
  const [baked, setBaked] = useState<BakeEntry | null>(null)
  useEffect(() => surface.onReady(() => setBaked(surface)), [surface])
  const compiled = useCompiled(rootRef, surfaceMat) // includes the reticle
  const visible = compiled && baked === surface
  // Small on screen: coarser spheres (the shells must match the surface tessellation).
  const fine = useDetail(rootRef)
  const sphere = fine ? SPHERE : SPHERE_MID

  useFrame((_, dt) => {
    const w = recipe.spin * MOTION
    if (surfRef.current) surfRef.current.rotation.y += w * dt
    if (cloudRef.current) cloudRef.current.rotation.y += (w * 1.15 + 0.006 * MOTION) * dt
  })

  return (
    <group ref={rootRef} scale={radius}>
      <group ref={bodyRef} quaternion={tilt} visible={visible}>
        <mesh ref={surfRef} geometry={sphere} material={surfaceMat} />
        {cloudMat && (
          <mesh ref={cloudRef} geometry={sphere} material={cloudMat} scale={1.008} raycast={noRaycast} />
        )}
        {/* Shells close to the surface share its tessellation, or facets would poke through. */}
        {atmo && (
          <>
            <mesh geometry={sphere} material={atmo.inner} scale={1.012} raycast={noRaycast} />
            <mesh
              geometry={fine ? SPHERE_LOW : SPHERE_MID}
              material={atmo.outer}
              scale={recipe.atmosphere!.scale}
              raycast={noRaycast}
            />
          </>
        )}
        {rings && ringMat && (
          <mesh geometry={ringGeometry(rings.inner, rings.outer)} material={ringMat} rotation-x={-Math.PI / 2} />
        )}
      </group>
      <Reticle size={1.3} selected={selected} hovered={hovered} />
    </group>
  )
}

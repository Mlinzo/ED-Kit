import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshBasicMaterial, Quaternion, Vector3, type Group, type IUniform, type Mesh } from 'three'
import type { BodyVisual } from '../../api/types'
import { MOTION, useCompiled, useDisposable, useEasedUniform, useTimeUniform } from './hooks'
import { hash01, mixHex, ringTint, starLook, type StarLook } from './palette'
import { createBeltGeometry, createBeltMaterial } from './belt'
import { viewFriendlyTilt } from './recipe'
import { Reticle } from './Reticle'
import {
  QUAD,
  SPHERE,
  SPHERE_LOW,
  jetGeometry,
  noRaycast,
  ringGeometry,
} from './shared'
import {
  createAccretionMaterial,
  createDustDiskMaterial,
  createGlowMaterial,
  createJetMaterial,
  createLensMaterial,
  createNebulaMaterial,
  createStarSurfaceMaterial,
} from './starMaterials'

export interface StarProps {
  visual: BodyVisual
  radius: number
  seed: number
  dim: boolean
  selected: boolean
  hovered: boolean
}

interface PartProps {
  look: StarLook
  visual: BodyVisual
  seed: number
  dimU: IUniform<number>
}

/** Orientation of a disc around the star (dust disc, accretion disc, belts): see viewFriendlyTilt. */
function tiltQuaternion(visual: BodyVisual, seed: number, minDeg: number, maxDeg: number): Quaternion {
  const real = visual.axialTiltRad ?? (hash01(seed, 130) - 0.5) * 0.8
  const { tilt, azimuth } = viewFriendlyTilt(real, hash01(seed, 131), minDeg, maxDeg)
  return new Quaternion().setFromAxisAngle(new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)), tilt)
}

export function Star({ visual, radius, seed, dim, selected, hovered }: StarProps) {
  const vkey = JSON.stringify(visual)
  const parsed = useMemo(() => JSON.parse(vkey) as BodyVisual, [vkey])
  const look = useMemo(() => starLook(parsed), [parsed])
  const dimU = useEasedUniform(dim ? 1 : 0)
  useTimeUniform()

  // Shown once its materials have compiled in the background (see useCompiled).
  const bodyRef = useRef<Group>(null)
  const compiled = useCompiled(bodyRef, look)

  const reticle = look.family === 'black_hole' ? (look.supermassive ? 1.15 : 1.0) : look.coreScale * 1.4
  return (
    <group ref={bodyRef} scale={radius} visible={compiled}>
      {look.family === 'black_hole' ? (
        <BlackHole look={look} visual={parsed} seed={seed} dimU={dimU} />
      ) : (
        <Luminous look={look} visual={parsed} seed={seed} dimU={dimU} />
      )}
      <Belts visual={parsed} seed={seed} dimU={dimU} inner={look.family === 'black_hole' ? 3.0 : 2.1} />
      <Reticle size={reticle} selected={selected} hovered={hovered} />
    </group>
  )
}

function Luminous({ look, visual, seed, dimU }: PartProps) {
  const surfaceMat = useDisposable(
    useMemo(
      () =>
        createStarSurfaceMaterial({
          core: look.core,
          mid: look.mid,
          limb: look.limb,
          intensity: look.intensity,
          granScale: look.granScale,
          granAmp: look.granAmp,
          spots: look.spots,
          bands: look.bands,
          seed: [hash01(seed, 1) * 60, hash01(seed, 2) * 60, hash01(seed, 3) * 60],
          dim: dimU,
        }),
      [look, seed, dimU],
    ),
  )
  const glowMat = useDisposable(
    useMemo(
      () =>
        createGlowMaterial({
          color: look.glow,
          core: mixHex(look.core, look.mid, 0.3),
          size: look.glowSize * look.coreScale,
          disc: look.coreScale,
          strength: look.glowStrength,
          rays: look.rays,
          spikes: look.spikes,
          seed: hash01(seed, 9) * 100,
          dim: dimU,
        }),
      [look, seed, dimU],
    ),
  )
  const tilt = useMemo(() => tiltQuaternion(visual, seed, 12, 30), [visual, seed])
  const sphereRef = useRef<Mesh>(null)
  useFrame((_, dt) => {
    if (sphereRef.current) sphereRef.current.rotation.y += 0.04 * MOTION * dt
  })

  return (
    <>
      <mesh ref={sphereRef} geometry={SPHERE} material={surfaceMat} scale={look.coreScale} />
      <mesh geometry={QUAD} material={glowMat} frustumCulled={false} raycast={noRaycast} />
      {look.jets && <Jets look={look} visual={visual} seed={seed} dimU={dimU} />}
      {look.disk && (
        <group quaternion={tilt}>
          <DustDisk color={look.disk} seed={seed} dimU={dimU} />
        </group>
      )}
      {look.nebula && <Nebula color={look.nebula} seed={seed} dimU={dimU} />}
    </>
  )
}

function Jets({ look, seed, dimU }: PartProps) {
  const mat = useDisposable(
    useMemo(() => createJetMaterial({ color: mixHex(look.glow, '#ffffff', 0.25), strength: 0.9, dim: dimU }), [look, dimU]),
  )
  const spinRef = useRef<Group>(null)
  const axisTilt = 0.32 + hash01(seed, 140) * 0.2
  useFrame((_, dt) => {
    if (spinRef.current) spinRef.current.rotation.y += 0.7 * MOTION * dt
  })
  const geo = jetGeometry()
  return (
    <group ref={spinRef}>
      <group rotation-z={axisTilt}>
        <mesh geometry={geo} material={mat} scale={[1.5, 4.2, 1.5]} raycast={noRaycast} />
        <mesh geometry={geo} material={mat} scale={[1.5, 4.2, 1.5]} rotation-z={Math.PI} raycast={noRaycast} />
      </group>
    </group>
  )
}

function DustDisk({ color, seed, dimU }: { color: string; seed: number; dimU: IUniform<number> }) {
  const inner = 1.55
  const outer = 4.4
  const mat = useDisposable(
    useMemo(
      () => createDustDiskMaterial({ inner, outer, color, seed: hash01(seed, 150) * 50, dim: dimU }),
      [color, seed, dimU],
    ),
  )
  return <mesh geometry={ringGeometry(inner, outer)} material={mat} rotation-x={-Math.PI / 2} raycast={noRaycast} />
}

function Nebula({ color, seed, dimU }: { color: string; seed: number; dimU: IUniform<number> }) {
  const mat = useDisposable(
    useMemo(
      () => createNebulaMaterial({ color, size: 5.2, shell: 3.4, seed: hash01(seed, 160) * 50, dim: dimU }),
      [color, seed, dimU],
    ),
  )
  return <mesh geometry={QUAD} material={mat} frustumCulled={false} raycast={noRaycast} />
}

const BLACK = new MeshBasicMaterial({ color: '#000000' })

function bhColors(smbh: boolean) {
  return smbh
    ? { hot: '#f4f6ff', warm: '#ffc47e', cool: '#a34a7a' }
    : { hot: '#fff3dc', warm: '#ffa04a', cool: '#b23a22' }
}

function BlackHole({ look, visual, seed, dimU }: PartProps) {
  const smbh = look.supermassive
  const shadow = 0.5
  const inner = 0.72
  const outer = smbh ? 2.8 : 2.2
  const diskMat = useDisposable(
    useMemo(
      () =>
        createAccretionMaterial({
          inner: 0.72,
          outer: smbh ? 2.8 : 2.2,
          ...bhColors(smbh),
          strength: smbh ? 1.0 : 0.85,
          seed: hash01(seed, 170) * 50,
          dim: dimU,
        }),
      [smbh, seed, dimU],
    ),
  )
  const lensMat = useDisposable(
    useMemo(() => {
      const c = bhColors(smbh)
      return createLensMaterial({
        size: smbh ? 1.9 : 1.6,
        shadow: 0.5,
        hot: c.hot,
        warm: c.warm,
        strength: smbh ? 1.5 : 1.25,
        dim: dimU,
      })
    }, [smbh, dimU]),
  )
  const tilt = useMemo(() => tiltQuaternion(visual, seed, 8, 24), [visual, seed])
  return (
    <>
      <mesh geometry={SPHERE_LOW} material={BLACK} scale={shadow} />
      <group quaternion={tilt}>
        <mesh geometry={ringGeometry(inner, outer)} material={diskMat} rotation-x={-Math.PI / 2} raycast={noRaycast} />
        <mesh geometry={QUAD} material={lensMat} frustumCulled={false} raycast={noRaycast} />
      </group>
    </>
  )
}

/** Asteroid belts of a star: a sparse field of rocks close to the star (the map is not to scale). */
function Belts({
  visual,
  seed,
  dimU,
  inner,
}: {
  visual: BodyVisual
  seed: number
  dimU: IUniform<number>
  inner: number
}) {
  const rings = visual.rings
  const outer = inner + 0.5 + Math.min(rings?.length ?? 0, 3) * 0.35
  const geometry = useDisposable(
    useMemo(() => {
      const n = rings?.length ?? 0
      if (!rings || n === 0) return null
      const step = (outer - inner) / n
      const bands = rings.map((r, i) => ({
        inner: inner + i * step + step * 0.1,
        outer: inner + (i + 1) * step - step * 0.1,
        color: ringTint(r.ringClass),
      }))
      return createBeltGeometry(bands, seed)
    }, [rings, inner, outer, seed]),
  )
  const halfHeight = useThree((state) => (state.size.height * state.viewport.dpr) / 2)
  const mat = useDisposable(
    useMemo(() => (geometry ? createBeltMaterial(dimU, halfHeight) : null), [geometry, dimU, halfHeight]),
  )
  const tilt = useMemo(() => tiltQuaternion(visual, seed + 1, 10, 30), [visual, seed])
  if (!geometry || !mat) return null
  return (
    <group quaternion={tilt}>
      <points geometry={geometry} material={mat} raycast={noRaycast} />
    </group>
  )
}

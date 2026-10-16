import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh, ShaderMaterial } from 'three'
import { useDisposable } from './hooks'
import { QUAD, noRaycast } from './shared'
import { createReticleMaterial } from './starMaterials'

const ACCENT = '#38bdf8' // sky-400, the app accent

/** Selection / hover reticle: a crisp camera-facing ring (+ rotating ticks when selected). */
export function Reticle({ size, selected, hovered }: { size: number; selected: boolean; hovered: boolean }) {
  const mat = useDisposable(useMemo(() => createReticleMaterial({ color: ACCENT, size: size * 1.35 }), [size]))
  const ref = useRef<Mesh>(null)
  useEffect(() => {
    if (ref.current) ref.current.visible = selected || hovered
  }, [selected, hovered])
  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    const k = 1 - Math.exp(-dt * 10)
    const { uSel, uHov } = (mesh.material as ShaderMaterial).uniforms
    uSel.value += ((selected ? 1 : 0) - uSel.value) * k
    uHov.value += ((hovered && !selected ? 1 : 0) - uHov.value) * k
    mesh.visible = uSel.value > 0.01 || uHov.value > 0.01 || selected || hovered
  })
  return (
    <mesh ref={ref} geometry={QUAD} material={mat} renderOrder={10} frustumCulled={false} raycast={noRaycast} />
  )
}

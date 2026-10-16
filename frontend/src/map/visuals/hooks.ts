import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { IUniform, Object3D, PerspectiveCamera } from 'three'
import { acquireBake, releaseBake, retainBake, type BakeEntry, type BakeSpec } from './bake'
import { acquireShared, releaseShared, retainShared } from './shared'
import { TIME } from './starMaterials'

/** Users who asked for less motion get a near-still map. */
export const MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.15 : 1

/** Uniform whose value eases toward a target; mutated only from the frame loop. */
class EasedUniform implements IUniform<number> {
  value: number
  constructor(v: number) {
    this.value = v
  }
  step(target: number, dt: number, speed: number) {
    const d = target - this.value
    if (Math.abs(d) < 1e-3) this.value = target
    else this.value += d * (1 - Math.exp(-dt * speed))
  }
}

/** A uniform that eases toward `target` (0..1) — used for dim transitions. */
export function useEasedUniform(target: number, speed = 6): IUniform<number> {
  const [u] = useState(() => new EasedUniform(target))
  useFrame((_, dt) => u.step(target, dt, speed))
  return u
}

/** Advances the shared animation clock. */
export function useTimeUniform() {
  useFrame((state) => {
    TIME.value = state.clock.elapsedTime * MOTION
  })
}

/**
 * Baked texture for a spec (null spec -> null). Ref-counted for the component's lifetime. Bakes
 * run outside the render loop: the canvas (frameloop "demand") is asked for a frame when this one
 * is ready, so it shows at once. Higher `priority` bakes first (interesting bodies before dull ones).
 */
export function useBake(spec: BakeSpec | null, priority = 0): BakeEntry | null {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  // Priority only orders the first bake; it must not re-acquire the entry.
  const [initialPriority] = useState(priority)
  const entry = useMemo(() => (spec ? acquireBake(gl, spec, initialPriority) : null), [gl, spec, initialPriority])
  useEffect(() => {
    if (!entry) return
    retainBake(gl, entry)
    const unsubscribe = entry.onReady(() => invalidate())
    return () => {
      unsubscribe()
      releaseBake(gl, entry)
    }
  }, [gl, entry, invalidate])
  return entry
}

/** Renderer-independent shared resource (e.g. ring texture), ref-counted by key. */
export function useShared<T extends { dispose(): void }>(key: string | null, create: () => T): T | null {
  // `create` only runs on a cache miss for `key` (callers derive both from the same inputs).
  const value = useMemo(() => (key ? acquireShared(key, create) : null), [key, create])
  useEffect(() => {
    if (!key) return
    retainShared(key)
    return () => releaseShared(key)
  }, [key])
  return value
}

/** Dispose a material (or several) when it is replaced or the component unmounts. */
export function useDisposable<T extends { dispose(): void } | null | undefined>(value: T): T {
  useEffect(() => {
    return () => value?.dispose()
  }, [value])
  return value
}

/**
 * True once every material under `ref` has compiled in the background (compileAsync with
 * KHR_parallel_shader_compile). Bodies stay hidden until then: compiling on first draw blocks the
 * page (hundreds of ms per program on Windows / D3D). `key` changes when the materials do.
 */
export function useCompiled(ref: RefObject<Object3D | null>, key: unknown): boolean {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  const [done, setDone] = useState<unknown>(null)
  useEffect(() => {
    const obj = ref.current
    if (!obj) return
    let alive = true
    const finish = () => {
      if (!alive) return
      setDone(() => key)
      invalidate()
    }
    try {
      gl.compileAsync(obj, camera, scene).then(finish, finish)
    } catch {
      finish()
    }
    return () => {
      alive = false
    }
  }, [gl, camera, scene, invalidate, ref, key])
  return done === key
}

const DEG = Math.PI / 180

/**
 * Level of detail from the on-screen radius (device pixels) of `ref`'s unit sphere: true while
 * the body is big enough for the fine sphere. Re-renders only when the level changes.
 */
export function useDetail(ref: RefObject<Object3D | null>, high = 120, low = 96): boolean {
  const [fine, setFine] = useState(false) // most bodies start small on screen
  useFrame((state) => {
    const obj = ref.current
    const cam = state.camera as PerspectiveCamera
    if (!obj || !cam.isPerspectiveCamera) return
    const m = obj.matrixWorld.elements
    const c = cam.matrixWorld.elements
    const scale = Math.hypot(m[0], m[1], m[2])
    const dist = Math.max(1e-6, Math.hypot(m[12] - c[12], m[13] - c[13], m[14] - c[14]))
    const px = ((scale / dist / Math.tan((cam.fov * DEG) / 2)) * state.size.height * state.viewport.dpr) / 2
    const next = fine ? px > low : px > high
    if (next !== fine) setFine(next)
  })
  return fine
}

// Dev-only performance probe: /gallery.html?bench=60
// Mounts N bodies in one canvas (two offset PointLights), times every bake with a GPU sync,
// samples frame time / draw calls / GPU resources, then unmounts everything and checks that
// render targets, textures and geometries are released, and remounts (cache reuse).

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BodyMesh } from '..'
import { bakeDebug } from '../bake'
import { SECTIONS, type Sample } from './samples'

interface Snapshot {
  label: string
  t: number
  calls: number
  triangles: number
  textures: number
  geometries: number
  programs: number
  liveTargets: number
  frameMsAvg: number
  frameMsMax: number
}

const params = new URLSearchParams(window.location.search)
const N = Number(params.get('bench') || 60)
let started = false
/** [time, duration] of frames longer than 50 ms. */
const longFrames: [number, number][] = []

function pool(): Sample[] {
  const all = SECTIONS.filter((s) => !s.id.endsWith('-dim') && s.id !== 'selection').flatMap((s) => s.items)
  return Array.from({ length: N }, (_, i) => {
    const base = all[i % all.length]
    return { ...base, seed: 1000 + i * 17, dim: i % 3 === 0 && base.kind === 'planet' }
  })
}

function Probe({ onSnapshot }: { onSnapshot: (label: string, s: Omit<Snapshot, 'label' | 't'>) => void }) {
  const gl = useThree((s) => s.gl)
  const frames = useRef<number[]>([])
  const worst = useRef(0)
  const last = useRef(0)
  useFrame(() => {
    const now = performance.now()
    if (last.current) {
      const d = now - last.current
      frames.current.push(d)
      worst.current = Math.max(worst.current, d)
      if (d > 50) longFrames.push([Math.round(now), Math.round(d)])
    }
    if (frames.current.length > 60) frames.current.shift()
    last.current = now
  })
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__snap = (label: string) => {
      const f = frames.current
      onSnapshot(label, {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
        programs: gl.info.programs?.length ?? 0,
        liveTargets: bakeDebug.live,
        frameMsAvg: f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0,
        frameMsMax: worst.current,
      })
      worst.current = 0
    }
    const ctx = gl.getContext()
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info')
    w.__gpu = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)
  }, [gl, onSnapshot])
  return null
}

export function Bench() {
  const [items] = useState(pool)
  const [mounted, setMounted] = useState(true)
  const [snaps, setSnaps] = useState<Snapshot[]>([])
  const t0 = useRef(0)

  const onSnapshot = useCallback((label: string, s: Omit<Snapshot, 'label' | 't'>) => {
    setSnaps((prev) => [...prev, { label, t: Math.round(performance.now() - t0.current), ...s }])
  }, [])

  // Script: wait for bakes, snapshot, unmount, wait for disposal, snapshot, remount, snapshot.
  useEffect(() => {
    if (started) return // StrictMode runs effects twice in dev
    started = true
    const w = window as unknown as Record<string, unknown>
    const snap = (l: string) => (w.__snap as ((l: string) => void) | undefined)?.(l)
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    bakeDebug.sync = true
    t0.current = performance.now()
    void (async () => {
      const start = performance.now()
      while (bakeDebug.count < 1 && performance.now() - start < 60000) await wait(100)
      let prev = -1
      while (bakeDebug.count !== prev && performance.now() - start < 120000) {
        prev = bakeDebug.count
        await wait(1500)
      }
      const bakeWall = performance.now() - start - 1500
      w.__bake = { ...bakeDebug, wallMs: Math.round(bakeWall), avgMs: bakeDebug.ms / Math.max(1, bakeDebug.count) }
      snap('loaded (max = worst load frame)')
      await wait(2500)
      snap('mounted, steady')
      setMounted(false)
      await wait(5500)
      snap('unmounted+5.5s')
      setMounted(true)
      await wait(4000)
      snap('remounted')
      w.__done = true
    })()
  }, [])

  const cols = Math.ceil(Math.sqrt(N))
  const w = window as unknown as Record<string, unknown>
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#03050a', color: '#e4e4e7', font: '12px monospace' }}>
      <Canvas camera={{ fov: 40, position: [0, cols * 1.6, cols * 3.2] }} dpr={1}>
        <ambientLight intensity={0.14} />
        <pointLight position={[-cols * 2, cols, cols]} intensity={2.8} decay={0} />
        <pointLight position={[cols * 2, -cols * 0.3, -cols]} intensity={1.4} decay={0} color="#9fc0ff" />
        <Probe onSnapshot={onSnapshot} />
        {mounted &&
          items.map((it, i) => (
            <group key={i} position={[((i % cols) - cols / 2) * 3, 0, (Math.floor(i / cols) - cols / 2) * 3]}>
              <BodyMesh visual={it.visual} kind={it.kind} radius={it.kind === 'star' ? 0.7 : 1} seed={it.seed} dim={it.dim} />
            </group>
          ))}
      </Canvas>
      <pre id="bench" style={{ position: 'absolute', left: 8, top: 8, margin: 0, background: '#000a', padding: 6 }}>
        {JSON.stringify({ gpu: w.__gpu, bake: w.__bake, longFrames, snaps }, null, 1)}
      </pre>
    </div>
  )
}

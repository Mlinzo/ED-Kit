// Dev-only visual QA page for BodyMesh:
//   /gallery.html?s=section,section&q=label,filter&cell=220&light=side|back|front|two|dir|far&elev=30
//   /gallery.html?bench=60 — performance / leak probe (see Bench.tsx)

import { PerspectiveCamera, View } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useRef } from 'react'
import { BodyMesh } from '..'
import { SECTIONS, type Sample } from './samples'

const params = new URLSearchParams(window.location.search)
const only = params.get('s')?.split(',') ?? null
const CELL = Number(params.get('cell') ?? 200)
const LIGHT = params.get('light') ?? 'side'
const FILTER = params.get('q')?.toLowerCase().split(',') ?? null
/** Camera elevation in degrees (the map's default view is 30–45°). */
const ELEV = Number(params.get('elev') ?? 15.6)

const LIGHTS: Record<string, [number, number, number][]> = {
  side: [[-6, 2.5, 4]],
  back: [[2, 1.2, -7]],
  front: [[1.5, 1.5, 7]],
  two: [
    [-6, 2.5, 4],
    [6, -1, -2],
  ],
  // Light far away with physical falloff (decay 2), to check distance attenuation.
  far: [[-60, 25, 40]],
}

function Cell({ item }: { item: Sample }) {
  const fit = item.fit ?? 4.2
  const d = fit * Math.cos((ELEV * Math.PI) / 180)
  const h = fit * Math.sin((ELEV * Math.PI) / 180)
  const lights = LIGHTS[LIGHT] ?? LIGHTS.side
  return (
    <figure style={{ margin: 0, width: CELL }}>
      <View style={{ width: CELL, height: CELL, borderRadius: 10, background: '#07080c', overflow: 'hidden' }}>
        <PerspectiveCamera makeDefault fov={32} position={[0, h, d]} rotation={[-Math.atan2(h, d), 0, 0]} />
        <ambientLight intensity={0.14} />
        {item.kind === 'planet' && LIGHT === 'dir' && (
          <directionalLight position={[-6, 2.5, 4]} intensity={3.2} color="#fff4e6" />
        )}
        {item.kind === 'planet' &&
          LIGHT !== 'dir' &&
          lights.map((p, i) => (
            <pointLight
              key={i}
              position={p}
              intensity={LIGHT === 'far' ? 3.2 * 5200 : i === 0 ? 3.2 : 1.6}
              decay={LIGHT === 'far' ? 2 : 0}
              color={i === 0 ? '#fff4e6' : '#9fc0ff'}
            />
          ))}
        <BodyMesh
          visual={item.visual}
          kind={item.kind}
          radius={1}
          seed={item.seed}
          dim={item.dim}
          selected={item.selected}
          hovered={item.hovered}
        />
      </View>
      <figcaption style={{ fontSize: 11, lineHeight: 1.3, marginTop: 5, color: '#a1a1aa' }}>{item.label}</figcaption>
    </figure>
  )
}

export function Gallery() {
  const container = useRef<HTMLDivElement>(null!)
  const sections = SECTIONS.filter((s) => !only || only.includes(s.id))
  return (
    <div
      ref={container}
      style={{
        minHeight: '100vh',
        background: '#030407',
        color: '#e4e4e7',
        fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      {sections.map((s) => (
        <section key={s.id} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: '#7dd3fc', letterSpacing: 0.3 }}>
            {s.title}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {s.items
              .filter((it) => !FILTER || FILTER.some((f) => it.label.toLowerCase().includes(f)))
              .map((it, i) => (
                <Cell key={i} item={it} />
              ))}
          </div>
        </section>
      ))}
      <Canvas
        eventSource={container}
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
        dpr={[1, 2]}
      >
        <View.Port />
      </Canvas>
    </div>
  )
}

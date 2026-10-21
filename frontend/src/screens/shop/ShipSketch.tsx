// A ship's blueprint: the top view, the side view under it and the rear view beside that (when
// the sketch has one), all in one true scale (metres), with dimension lines.
//
// Shapes (sketches.ts): `top` is the half-outline [s, y] from the nose (s = 0) to the stern,
// y >= 0, mirrored; `topPanels` are polylines (y >= 0, mirrored); `topShapes` polygons with
// signed y (canopy, pods); `engines` y-ranges of thrusters at the stern ([0, b]: one central
// engine). `side` is the side outline [s, z], z from the top down; `sidePanels` polylines,
// `sideShapes` polygons behind the hull, `sideEngine` [z0, z1]. `rear` is the rear view's
// half-outline [y, z], mirrored across. The nose is drawn on the right.

import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { formatNumber } from '../../lib/format'
import type { ShipSketch } from './sketches'

type Pt = [number, number]

const pts = (list: readonly Pt[]) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

/** A half-outline closed by its mirror image across the line `y = 0` (the second coordinate). */
function mirror(half: readonly Pt[]): Pt[] {
  const back = half
    .filter(([, y]) => y > 0)
    .reverse()
    .map(([s, y]): Pt => [s, -y])
  return [...half, ...back]
}

/** The same across the line `x = 0` (the rear view is symmetric in its first coordinate). */
const mirrorAcross = (half: readonly Pt[]) => mirror(half.map(([y, z]): Pt => [z, y])).map(([z, y]): Pt => [y, z])

/** The element's width in CSS pixels (0 until measured). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

const HULL = 'fill-sky-400/[0.07] stroke-zinc-100'
const PANEL = 'fill-none stroke-zinc-500'
const AXIS = 'stroke-zinc-600'

/** A dimension line with end ticks and its length in metres; `k` is metres per pixel. */
function Dimension({ x1, y1, x2, y2, metres, k }: { x1: number; y1: number; x2: number; y2: number; metres: number; k: number }) {
  const vertical = x1 === x2
  const tick = 4 * k
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const label = `${formatNumber(metres, metres % 1 ? 1 : 0)} ${t.units.m}`
  const boxW = (label.length * 7 + 10) * k
  return (
    <g className="stroke-accent">
      <line x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
      {vertical ? (
        <>
          <line x1={x1 - tick} y1={y1} x2={x1 + tick} y2={y1} vectorEffect="non-scaling-stroke" />
          <line x1={x2 - tick} y1={y2} x2={x2 + tick} y2={y2} vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} vectorEffect="non-scaling-stroke" />
          <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} vectorEffect="non-scaling-stroke" />
        </>
      )}
      <g transform={vertical ? `translate(${mx} ${my}) rotate(-90)` : `translate(${mx} ${my})`}>
        <rect x={-boxW / 2} y={-8 * k} width={boxW} height={16 * k} className="fill-zinc-950 stroke-none" />
        <text className="fill-accent stroke-none font-mono" fontSize={11 * k} textAnchor="middle" dominantBaseline="central">
          {label}
        </text>
      </g>
    </g>
  )
}

/** A view's caption above it. */
function Caption({ x, y, k, children }: { x: number; y: number; k: number; children: string }) {
  return (
    <text x={x} y={y} className="fill-zinc-500 font-medium uppercase" fontSize={10 * k} letterSpacing={1.2 * k} textAnchor="middle">
      {children}
    </text>
  )
}

export function ShipSketchView({ sketch, name }: { sketch: ShipSketch; name: string }) {
  const [ref, width] = useWidth()
  const c = t.shop.card
  const [L, W, H] = sketch.dims
  const rear = sketch.rear
  // One scale for all views (k: metres per pixel). Margins are pixels, so a 15 m Sidewinder fills
  // the sheet like a 200 m Beluga. Across: the length, then the rear view after a gap; down: the
  // top view, a gap, the side view; at most 0.72 of the width tall (dimension lines included).
  const px = Math.max(240, width || 640)
  const LEFT = 36
  const gap0 = 0.09 * Math.max(L, W)
  const across = L + (rear ? gap0 + W : 0)
  const k = Math.max(across / (px - LEFT - 12), (W + gap0 + H) / (0.72 * px - 64))
  // Room between the views for a caption, however small the ship is drawn.
  const gap = Math.max(gap0, 22 * k)
  const X = (s: number) => L - s
  const depth = Math.max(1, L * 0.022)
  const dimX = Math.min(-20 * k, -depth - 8 * k)
  const sideY = W / 2 + gap
  const rearX = L + gap0 + W / 2
  // When the height sets the scale, the views are centred across.
  const x0 = -LEFT * k - Math.max(0, px * k - across - (LEFT + 12) * k) / 2
  const views = [c.topView, c.sideView, ...(rear ? [c.rearView] : [])].join(', ')

  return (
    <div
      ref={ref}
      className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800 ring-inset [background-image:linear-gradient(rgb(56_189_248/0.07)_1px,transparent_1px),linear-gradient(90deg,rgb(56_189_248/0.07)_1px,transparent_1px)] [background-size:20px_20px]"
    >
      <svg
        viewBox={`${x0} ${-W / 2 - 16 * k} ${px * k} ${W + gap + H + 50 * k}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${name}: ${views}`}
      >
        <Caption x={L / 2} y={-W / 2 - 5 * k} k={k}>
          {c.topView}
        </Caption>
        <polygon points={pts(mirror(sketch.top).map(([s, y]): Pt => [X(s), y]))} className={HULL} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {(sketch.topPanels ?? []).flatMap((line, i) =>
          [1, -1].map((sign) => (
            <polyline key={`${i}${sign}`} points={pts(line.map(([s, y]): Pt => [X(s), sign * y]))} className={PANEL} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )),
        )}
        {(sketch.topShapes ?? []).map((shape, i) => (
          <polygon key={i} points={pts(shape.map(([s, y]): Pt => [X(s), y]))} className={HULL} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
        ))}
        {(sketch.engines ?? []).flatMap(([a, b], i) =>
          (a === 0 ? [[-b, 2 * b]] : [[a, b - a], [-b, b - a]]).map(([y, h], j) => (
            <rect key={`${i}-${j}`} x={-depth} y={y} width={depth} height={h} className={HULL} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )),
        )}
        <line x1={-depth * 2} y1={0} x2={L + depth * 2} y2={0} className={AXIS} strokeDasharray="10 4 2 4" vectorEffect="non-scaling-stroke" />
        <Dimension x1={dimX} y1={-W / 2} x2={dimX} y2={W / 2} metres={W} k={k} />

        <g transform={`translate(0 ${sideY})`}>
          <Caption x={L / 2} y={-5 * k} k={k}>
            {c.sideView}
          </Caption>
          {(sketch.sideShapes ?? []).map((shape, i) => (
            <polygon key={i} points={pts(shape.map(([s, z]): Pt => [X(s), z]))} className="fill-sky-400/[0.07] stroke-zinc-400" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
          ))}
          <polygon points={pts(sketch.side.map(([s, z]): Pt => [X(s), z]))} className={HULL} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {(sketch.sidePanels ?? []).map((line, i) => (
            <polyline key={i} points={pts(line.map(([s, z]): Pt => [X(s), z]))} className={PANEL} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {sketch.sideEngine && (
            <rect x={-depth} y={sketch.sideEngine[0]} width={depth} height={sketch.sideEngine[1] - sketch.sideEngine[0]} className={HULL} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
          <Dimension x1={dimX} y1={0} x2={dimX} y2={H} metres={H} k={k} />
          <Dimension x1={0} y1={H + 18 * k} x2={L} y2={H + 18 * k} metres={L} k={k} />
        </g>

        {rear && (
          <g transform={`translate(${rearX} ${sideY})`}>
            <Caption x={0} y={-5 * k} k={k}>
              {c.rearView}
            </Caption>
            <polygon points={pts(mirrorAcross(rear))} className={HULL} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <line x1={0} y1={-0.06 * H} x2={0} y2={H * 1.06} className={AXIS} strokeDasharray="10 4 2 4" vectorEffect="non-scaling-stroke" />
            <Dimension x1={-W / 2} y1={H + 18 * k} x2={W / 2} y2={H + 18 * k} metres={W} k={k} />
          </g>
        )}
      </svg>
    </div>
  )
}

import { Line } from '@react-three/drei'
import { useCallback, useMemo } from 'react'
import { Color, type Object3D } from 'three'
import { useMap } from './context'
import { SELECTED, useNodeFlags } from './interaction'
import { nodeAngle, type MapNode } from './layout'

const SEGMENTS = 160

interface OrbitStyle {
  color: string
  /** Brightness right behind the body … */
  peak: number
  /** … fading along the trail to this on the far side. */
  base: number
  width: number
}

const STYLES: Record<'high' | 'medium' | 'low' | 'selected' | 'placeholder', OrbitStyle> = {
  high: { color: '#dbeafe', peak: 0.62, base: 0.16, width: 1.3 },
  medium: { color: '#cbd5e1', peak: 0.42, base: 0.1, width: 1.1 },
  low: { color: '#94a3b8', peak: 0.26, base: 0.055, width: 1 },
  selected: { color: '#bae6fd', peak: 0.95, base: 0.26, width: 1.6 },
  placeholder: { color: '#94a3b8', peak: 0.26, base: 0.26, width: 1 },
}

/**
 * A child's orbit around the parent's origin: a thin circle whose brightness fades along the trail
 * behind the body (classic orrery look). The holder is rotated every frame to follow the body.
 * Drawn opaque (dark = invisible on the night background): Line2 segment caps overlap at every
 * vertex, so transparent / additive lines would look beaded. Star glows still add over them.
 */
export function OrbitLine({ child }: { child: MapNode }) {
  const { registry, startedAt, interaction } = useMap()
  const selected = (useNodeFlags(interaction, child.id) & SELECTED) !== 0
  const r = child.orbitRadius
  const placeholder = child.kind === 'placeholder'
  const style = selected ? STYLES.selected : placeholder ? STYLES.placeholder : STYLES[child.subtreeInterest]

  const { points, colors } = useMemo(() => {
    const pts: [number, number, number][] = []
    const cols: [number, number, number][] = []
    const c = new Color(style.color)
    for (let i = 0; i <= SEGMENTS; i++) {
      const f = i / SEGMENTS
      const a = -f * Math.PI * 2
      pts.push([r * Math.cos(a), 0, -r * Math.sin(a)])
      const b = style.base + (style.peak - style.base) * Math.pow(1 - f, 2.2)
      cols.push([c.r * b, c.g * b, c.b * b])
    }
    return { points: pts, colors: cols }
  }, [r, style])

  const holderRef = useCallback(
    (obj: Object3D | null) => {
      if (obj) {
        obj.rotation.y = nodeAngle(child, startedAt)
        registry.orbits.set(child.id, obj)
      } else {
        registry.orbits.delete(child.id)
      }
    },
    [child, registry, startedAt],
  )

  return (
    <group ref={holderRef}>
      <Line
        points={points}
        vertexColors={colors}
        lineWidth={style.width}
        dashed={placeholder}
        dashSize={r * 0.05}
        gapSize={r * 0.04}
        renderOrder={-1}
      />
    </group>
  )
}

/**
 * A component of a multiple system (binary star, planet pair): instead of a full orbit — inflated
 * by the not-to-scale layout, it would cut through the partner's planets — a faint dashed spoke
 * from the shared barycentre to the body. Two components read as one axis through the barycentre.
 */
export function ComponentLink({ child }: { child: MapNode }) {
  const { registry, startedAt, interaction } = useMap()
  const selected = (useNodeFlags(interaction, child.id) & SELECTED) !== 0
  const r = child.orbitRadius
  const bright = selected || child.subtreeInterest !== 'low'
  const holderRef = useCallback(
    (obj: Object3D | null) => {
      if (obj) {
        obj.rotation.y = nodeAngle(child, startedAt)
        registry.orbits.set(child.id, obj)
      } else {
        registry.orbits.delete(child.id)
      }
    },
    [child, registry, startedAt],
  )
  const points = useMemo<[number, number, number][]>(() => [[0, 0, 0], [r, 0, 0]], [r])
  return (
    <group ref={holderRef}>
      <Line
        points={points}
        color={bright ? '#64748b' : '#475569'}
        lineWidth={1}
        dashed
        dashSize={Math.max(0.15, r * 0.04)}
        gapSize={Math.max(0.12, r * 0.03)}
        renderOrder={-1}
      />
    </group>
  )
}

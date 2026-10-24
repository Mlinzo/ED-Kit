import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Vector3, type Group } from 'three'
import type { Line2, LineMaterial } from 'three-stdlib'
import { useMap } from './context'
import { useCourse } from './interaction'
import { worldPerPixel } from './three-utils'

const ACCENT = '#38bdf8'
/** Dash and gap on screen, CSS px. */
const DASH_PX = 7
const GAP_PX = 5
/** A unit segment along x: its group is moved, turned and stretched every frame. */
const UNIT: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
]

const mid = new Vector3()

/**
 * In supercruise: a dashed line from the ship (its body now, or the last one it was at) to the body
 * targeted in the game. The game reports no position in between, so the line shows where you fly
 * from and to, not how far you are.
 */
export function CourseLine() {
  const { interaction } = useMap()
  const course = useCourse(interaction)
  return course ? <Course from={course.from} to={course.to} /> : null
}

function Course({ from, to }: { from: number; to: number }) {
  const { registry } = useMap()
  const group = useRef<Group>(null)
  const line = useRef<Line2>(null)
  useFrame((state) => {
    const g = group.current
    const solver = registry.sizer.solver
    const i = solver?.index.get(from)
    const j = solver?.index.get(to)
    if (!g || !line.current || !solver || i === undefined || j === undefined) return
    const x0 = solver.worldX[i]
    const z0 = solver.worldZ[i]
    const dx = solver.worldX[j] - x0
    const dz = solver.worldZ[j] - z0
    const length = Math.max(Math.hypot(dx, dz), 1e-6)
    g.position.set(x0, 0, z0)
    g.rotation.y = Math.atan2(-dz, dx)
    g.scale.set(length, 1, 1)
    // Dashes keep their size on screen: the segment's own units are stretched by `length`.
    mid.set(x0 + dx / 2, 0, z0 + dz / 2)
    const px = worldPerPixel(state.camera, state.camera.position.distanceTo(mid), state.size.height) / length
    const material = line.current.material as LineMaterial
    material.dashSize = DASH_PX * px
    material.gapSize = GAP_PX * px
  })
  return (
    <group ref={group}>
      <Line
        ref={line}
        points={UNIT}
        color={ACCENT}
        lineWidth={2}
        dashed
        transparent
        opacity={0.9}
        depthWrite={false}
        frustumCulled={false}
      />
    </group>
  )
}

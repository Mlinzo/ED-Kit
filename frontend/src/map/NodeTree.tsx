import { Billboard, Html, Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AdditiveBlending, Vector3, type Camera, type Group, type Mesh, type Sprite } from 'three'
import type { Line2 } from 'three-stdlib'
import { useMap } from './context'
import { CURRENT, HOVERED, SELECTED, useNodeFlags } from './interaction'
import { labelPriority, wantsLabel } from './labels'
import { hasVisibleOrbit, localPosition, type MapNode } from './layout'
import { MapLabel } from './MapLabel'
import { ComponentLink, OrbitLine } from './OrbitLine'
import { haloTexture, worldPerPixel } from './three-utils'
import { BodyMesh } from './visuals'
import { bodyColor } from './visuals/colors'

const ACCENT = '#38bdf8'
/** Minimum on-screen radius (CSS px) of hit areas, so small bodies are easy to tap. */
const HIT_PX = 15
/** Surfaces of interesting bodies are baked first when a system appears. */
const BAKE_PRIORITY = { high: 2, medium: 1, low: 0 } as const

const tmp = new Vector3()

function circlePoints(segments = 96): [number, number, number][] {
  const pts: [number, number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push([Math.cos(a), 0, Math.sin(a)])
  }
  return pts
}
const CIRCLE = circlePoints()
const FACING_CIRCLE = CIRCLE.map(([x, , z]) => [x, z, 0] as [number, number, number])

/** World units per CSS pixel at an object's position. */
function pixelScale(obj: { getWorldPosition: (v: Vector3) => Vector3 }, state: { camera: Camera; size: { height: number } }) {
  obj.getWorldPosition(tmp)
  return worldPerPixel(state.camera, state.camera.position.distanceTo(tmp), state.size.height)
}

/**
 * One node of the orbit tree: its body (or marker), its children's orbits and the children.
 * Memoized: nodes are immutable per layout, so only a new layout re-renders the tree.
 */
export const NodeTree = memo(function NodeTree({ node }: { node: MapNode }) {
  const { registry, startedAt, layout } = useMap()
  const groupRef = useCallback(
    (g: Group | null) => {
      if (!g) {
        registry.groups.delete(node.id)
        return
      }
      const [x, z] = node.parent ? localPosition(node, startedAt) : (layout.rootPositions.get(node.id) ?? [0, 0])
      g.position.set(x, 0, z)
      registry.groups.set(node.id, g)
    },
    [layout, node, registry, startedAt],
  )

  return (
    <group ref={groupRef}>
      {node.body ? (
        <BodyNode node={node} />
      ) : node.kind === 'placeholder' ? (
        <PlaceholderNode node={node} />
      ) : (
        <BarycentreMark />
      )}
      {node.children
        .filter(hasVisibleOrbit)
        .map((c) =>
          c.role === 'component' ? <ComponentLink key={`o${c.id}`} child={c} /> : <OrbitLine key={`o${c.id}`} child={c} />,
        )}
      {node.children.map((c) => (
        <NodeTree key={c.id} node={c} />
      ))}
    </group>
  )
})

function useHoverHandlers(node: MapNode, selectable: boolean) {
  const { interaction, select } = useMap()
  // Unmounted while hovered (the system changed under the pointer): do not leave a stale cursor.
  useEffect(
    () => () => {
      if (interaction.get().hoveredId === node.id) {
        interaction.unhover(node.id)
        document.body.style.cursor = ''
      }
    },
    [interaction, node.id],
  )
  return useMemo(
    () => ({
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        if (e.pointerType === 'mouse') interaction.set({ hoveredId: node.id })
        document.body.style.cursor = selectable ? 'pointer' : 'default'
      },
      onPointerOut: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        interaction.unhover(node.id)
        document.body.style.cursor = ''
      },
      onClick: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        if (!selectable || e.delta > 6) return
        select(node)
      },
    }),
    [interaction, node, select, selectable],
  )
}

/** Invisible sphere, at least HIT_PX on screen, that receives pointer events for a body. */
function HitArea({ node, selectable }: { node: MapNode; selectable: boolean }) {
  const ref = useRef<Mesh>(null)
  const handlers = useHoverHandlers(node, selectable)
  const { registry } = useMap()
  useFrame((state) => {
    const m = ref.current
    if (!m) return
    // Inside the node's group, magnified with it (sizing.ts): sizes on screen compensate.
    const world = registry.sizer.worldOf(node.id)
    const body = registry.sizer.bodyOf(node.id)
    m.scale.setScalar(Math.max(node.size * body * 1.2, (pixelScale(m, state) * HIT_PX) / world))
  })
  return (
    <mesh ref={ref} {...handlers}>
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  )
}

function BodyNode({ node }: { node: MapNode }) {
  const { interaction, registry, select, labelLayer } = useMap()
  const flags = useNodeFlags(interaction, node.id)
  const body = node.body!
  const selected = (flags & SELECTED) !== 0
  const hovered = (flags & HOVERED) !== 0
  const current = (flags & CURRENT) !== 0
  // Stars are never dimmed: they are the landmarks (and the light).
  const dim = body.kind === 'planet' && node.interest === 'low' && !selected && !hovered && !current
  const showLabel = wantsLabel(node) || selected || hovered || current
  const priority = labelPriority(node, { hovered, selected, current })

  return (
    <>
      <BodyHolder id={node.id}>
        <BodyMesh
          visual={body.visual}
          kind={body.kind}
          radius={node.size}
          seed={body.bodyId}
          dim={dim}
          selected={selected}
          hovered={hovered}
          priority={current || selected ? 3 : BAKE_PRIORITY[node.interest]}
        />
      </BodyHolder>
      {node.interest === 'high' && !body.done && body.kind === 'planet' && (
        <Halo node={node} color={bodyColor(body.visual, body.kind)} />
      )}
      {current && <HereMarker node={node} />}
      <HitArea node={node} selectable />
      {showLabel && (
        <Html
          portal={labelLayer}
          zIndexRange={hovered ? [40, 40] : selected ? [35, 35] : [30, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <MapLabel
            node={node}
            card={hovered}
            selected={selected}
            current={current}
            priority={priority}
            registry={registry}
            onSelect={select}
          />
        </Html>
      )}
    </>
  )
}

/** Holder of the body alone: the map scales it by the body-only magnification (sizing.ts). */
function BodyHolder({ id, children }: { id: number; children: ReactNode }) {
  const { registry } = useMap()
  const ref = useCallback(
    (g: Group | null) => {
      if (g) {
        g.scale.setScalar(registry.sizer.bodyOf(id))
        registry.bodies.set(id, g)
      } else {
        registry.bodies.delete(id)
      }
    },
    [registry, id],
  )
  return <group ref={ref}>{children}</group>
}

/** Soft glow around interesting planets, never smaller than a few pixels so they stand out. */
function Halo({ node, color }: { node: MapNode; color: string }) {
  const ref = useRef<Sprite>(null)
  const { reducedMotion, registry } = useMap()
  useFrame((state) => {
    const s = ref.current
    if (!s) return
    const world = registry.sizer.worldOf(node.id)
    const body = registry.sizer.bodyOf(node.id)
    const breathe = reducedMotion ? 1 : 1 + 0.06 * Math.sin(state.clock.elapsedTime * 1.4)
    s.scale.setScalar(Math.max(node.size * body * 5, (pixelScale(s, state) * 38) / world) * breathe)
  })
  return (
    <sprite ref={ref} renderOrder={1}>
      <spriteMaterial
        map={haloTexture()}
        color={color}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </sprite>
  )
}

/** "You are here": rings expanding from the body and fading, in the accent colour. */
function HereMarker({ node }: { node: MapNode }) {
  return (
    <>
      <PulseRing node={node} phase={0} />
      <PulseRing node={node} phase={0.5} />
    </>
  )
}

function PulseRing({ node, phase }: { node: MapNode; phase: number }) {
  const { reducedMotion, registry } = useMap()
  const group = useRef<Group>(null)
  const line = useRef<Line2>(null)
  useFrame((state) => {
    const g = group.current
    const l = line.current
    if (!g || !l) return
    const world = registry.sizer.worldOf(node.id)
    const body = registry.sizer.bodyOf(node.id)
    const r0 = Math.max(node.size * body * 1.5, (pixelScale(g, state) * 12) / world)
    const t = reducedMotion ? 0.15 + phase * 0.9 : (state.clock.elapsedTime / 2.4 + phase) % 1
    g.scale.setScalar(r0 * (1 + t * 1.6))
    const material = l.material as { opacity: number }
    material.opacity = reducedMotion ? 0.7 - phase * 0.7 : 0.95 * (1 - t) ** 1.5
  })
  return (
    <group ref={group}>
      <Line ref={line} points={CIRCLE} color={ACCENT} lineWidth={1.6} transparent depthWrite={false} />
    </group>
  )
}

/** Referenced but never scanned: a dashed outline facing the camera and a "?" label. */
function PlaceholderNode({ node }: { node: MapNode }) {
  const { interaction, registry, select, labelLayer } = useMap()
  const hovered = (useNodeFlags(interaction, node.id) & HOVERED) !== 0
  return (
    <>
      <BodyHolder id={node.id}>
        <Billboard>
          <Line
            points={FACING_CIRCLE}
            scale={node.size}
            color="#a1a1aa"
            lineWidth={1.2}
            dashed
            dashSize={0.18}
            gapSize={0.14}
            transparent
            opacity={0.6}
            depthWrite={false}
          />
        </Billboard>
      </BodyHolder>
      <HitArea node={node} selectable={false} />
      <Html portal={labelLayer} zIndexRange={hovered ? [40, 40] : [30, 0]} style={{ pointerEvents: 'none' }}>
        <MapLabel
          node={node}
          card={hovered}
          selected={false}
          current={false}
          priority={labelPriority(node, { hovered, selected: false, current: false })}
          registry={registry}
          onSelect={select}
        />
      </Html>
    </>
  )
}

const CROSS: [number, number, number][] = [
  [-0.16, 0, 0],
  [0.16, 0, 0],
  [0, 0, -0.16],
  [0, 0, 0.16],
]

/** A barely visible cross where two bodies' common centre of mass is. */
function BarycentreMark() {
  // Constant points: drei <Line> rebuilds (and disposes) its geometry whenever `points` changes.
  return (
    <Line
      points={CROSS}
      segments
      color="#71717a"
      lineWidth={1}
      transparent
      opacity={0.6}
      depthWrite={false}
    />
  )
}

import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Spherical, Vector3, type PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useMap, type CameraApi } from './context'
import { contentPoints, overviewFor } from './framing'
import { fitDistance } from './three-utils'

interface Flight {
  active: boolean
  target: Vector3
  distance: number
  /** Polar / azimuth angles to ease towards (fit), or null to keep the current ones (focus). */
  polar: number | null
  azimuth: number | null
  /** Node whose movement the view follows, or null. */
  followId: number | null
  lastFollow: Vector3 | null
}

const offset = new Vector3()
const spherical = new Spherical()
const followPos = new Vector3()

/**
 * Orbit controls with damping and limits, auto-fit to the system and smooth flights to a body.
 * Exposes fit() / focus() through the map context.
 */
export function CameraRig({ systemKey, landedId }: { systemKey: string; landedId: number | null }) {
  const { layout, registry, registerCamera, startedAt, reducedMotion } = useMap()
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const flight = useRef<Flight>({
    active: false,
    target: new Vector3(),
    distance: 1,
    polar: null,
    azimuth: null,
    followId: null,
    lastFollow: null,
  })
  const fitted = useRef<string | null>(null)
  /** The user moved the view (or focused a body) since the last automatic fit. */
  const userMoved = useRef(false)

  const aspect = size.width / Math.max(1, size.height)
  // Whole-system view of what is drawn, turned so a long system lies along the screen. Positions
  // when the layout was built: bodies drift slowly, moons stay inside their planet's disc.
  const overview = useMemo(
    () => overviewFor(contentPoints(layout, startedAt), (camera as PerspectiveCamera).fov ?? 40, aspect),
    [aspect, camera, layout, startedAt],
  )

  // Imperative API for the overlay buttons and selection.
  const api = useMemo<CameraApi>(() => {
    /** Flies to the flight's goal, or jumps there (first view, reduced motion). */
    const go = (animate: boolean) => {
      const f = flight.current
      const c = controls.current
      if (animate && !reducedMotion) {
        f.active = true
        return
      }
      if (!c) {
        f.active = true
        return
      }
      spherical.setFromVector3(offset.subVectors(camera.position, c.target))
      spherical.radius = f.distance
      if (f.polar !== null) spherical.phi = f.polar
      if (f.azimuth !== null) spherical.theta = f.azimuth
      c.target.copy(f.target)
      camera.position.setFromSpherical(spherical).add(f.target)
      camera.lookAt(f.target)
      c.update()
      f.active = false
    }
    return {
      fit: (animate = true, resume = false) => {
        const f = flight.current
        if (resume) userMoved.current = false
        f.target.copy(overview.target)
        f.distance = overview.distance
        f.polar = overview.polar
        f.azimuth = overview.azimuth
        f.followId = null
        f.lastFollow = null
        go(animate)
      },
      focus: (id: number) => {
        const node = layout.nodes.get(id)
        const group = registry.groups.get(id)
        if (!node || !group) return
        const f = flight.current
        group.getWorldPosition(f.target)
        const frame = Math.max(node.extent * 1.5, node.size * 9, 3.5)
        f.distance = fitDistance(frame, camera, aspect)
        f.polar = null
        f.azimuth = null
        f.followId = id
        userMoved.current = true
        f.lastFollow = f.target.clone()
        go(true)
      },
    }
  }, [aspect, camera, layout, overview, reducedMotion, registry])
  useEffect(() => {
    registerCamera(api)
    return () => registerCamera(null)
  }, [api, registerCamera])

  // Fit when a new system is shown (jump the first time, fly afterwards), and keep fitting while
  // it fills in (FSS scan, resize) until the user takes the camera. Landed on a planet: fly from
  // the whole system down to it (focus hands the camera to the user: no refits after it).
  useEffect(() => {
    if (fitted.current !== systemKey) {
      const first = fitted.current === null
      fitted.current = systemKey
      userMoved.current = false
      api.fit(!first)
      if (landedId !== null) api.focus(landedId)
    } else if (!userMoved.current) {
      if (landedId !== null) api.focus(landedId)
      else api.fit(true)
    }
  }, [api, systemKey, layout, landedId])

  useFrame((state, dt) => {
    const c = controls.current
    if (!c) return
    const f = flight.current

    // Follow a (slowly) moving body: carry the view along with it.
    if (f.followId !== null) {
      const g = registry.groups.get(f.followId)
      if (!g) {
        f.followId = null
        f.lastFollow = null
      } else {
        g.getWorldPosition(followPos)
        if (f.active) f.target.copy(followPos)
        else if (f.lastFollow) {
          offset.subVectors(followPos, f.lastFollow)
          c.target.add(offset)
          camera.position.add(offset)
        }
        f.lastFollow = (f.lastFollow ?? new Vector3()).copy(followPos)
      }
    }

    if (!f.active) return
    // The canvas renders on demand (capped when idle): keep flights at the full frame rate.
    state.invalidate()
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4.5)
    offset.subVectors(camera.position, c.target)
    spherical.setFromVector3(offset)
    spherical.radius += (f.distance - spherical.radius) * k
    if (f.polar !== null) spherical.phi += (f.polar - spherical.phi) * k
    if (f.azimuth !== null) {
      // Shortest way round.
      const d = Math.atan2(Math.sin(f.azimuth - spherical.theta), Math.cos(f.azimuth - spherical.theta))
      spherical.theta += d * k
    }
    c.target.lerp(f.target, k)
    camera.position.setFromSpherical(spherical).add(c.target)
    camera.lookAt(c.target)

    const done =
      c.target.distanceTo(f.target) < f.distance * 0.001 &&
      Math.abs(spherical.radius - f.distance) < f.distance * 0.002 &&
      (f.polar === null || Math.abs(spherical.phi - f.polar) < 0.002) &&
      (f.azimuth === null || Math.abs(Math.sin(spherical.theta - f.azimuth)) < 0.002)
    if (done) f.active = false
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.9}
      minPolarAngle={0.12}
      maxPolarAngle={1.4}
      minDistance={1.2}
      maxDistance={Math.max(overview.distance * 3, 60)}
      screenSpacePanning={false}
      onStart={() => {
        flight.current.active = false
        userMoved.current = true
      }}
    />
  )
}

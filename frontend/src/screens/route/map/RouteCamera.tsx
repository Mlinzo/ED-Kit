import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Spherical, Vector3, type PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { CAMERA_RANGE, overview, SCENE_RADIUS, topView, type FitLimits, type Vec3 } from './geometry'

export interface RouteCameraApi {
  /** The whole route, tilted; automatic re-fitting (as the route changes) resumes. */
  fit: (animate?: boolean) => void
  /** The whole route from straight above, the core up. */
  top: () => void
  /** Centre the view on a point, moving closer when far out. */
  focus: (p: Vec3) => void
  /** Frame these points, tilted (the camera stays the user's: no automatic re-fitting). */
  show: (points: Vec3[]) => void
}

interface Goal {
  target: Vec3
  distance: number
  /** Angles to ease towards, or null to keep the current ones. */
  polar: number | null
  azimuth: number | null
}

interface Flight {
  active: boolean
  target: Vector3
  distance: number
  polar: number | null
  azimuth: number | null
}

const offset = new Vector3()
const spherical = new Spherical()
/** How close a focus flight comes at most (the whole route is ~3× farther). */
const FOCUS_DISTANCE = SCENE_RADIUS * 1.2
/** A press that moves farther than this (px) turns the view: the camera is the user's now. */
const DRAG_PX = 4

/**
 * Orbit controls with damping, the whole route framed when it is shown (and refitted while it
 * changes, until you take the camera), smooth flights to a stop or to the top view.
 */
export function RouteCamera({
  frame,
  routeKey,
  reducedMotion,
  register,
  range = CAMERA_RANGE,
  limits,
  focusDistance = FOCUS_DISTANCE,
}: {
  /** Points the whole-route view frames (scene units). */
  frame: Vec3[]
  /** A new route (not an edit of this one) jumps back to the overview. */
  routeKey: string
  reducedMotion: boolean
  register: (api: RouteCameraApi | null) => void
  /** Camera distance limits of the controls (another map's scale); keep the object stable. */
  range?: FitLimits
  /** Distance limits of the fitted views (default: the route map's). */
  limits?: FitLimits
  /** How close a focus flight comes at most. */
  focusDistance?: number
}) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined
  const flight = useRef<Flight>({ active: false, target: new Vector3(), distance: 1, polar: null, azimuth: null })
  const fitted = useRef<string | null>(null)
  /** The user moved the view (or flew somewhere) since the last automatic fit. */
  const userMoved = useRef(false)

  const aspect = size.width / Math.max(1, size.height)
  const fov = camera.fov ?? 40
  const home = useMemo(() => overview(frame, fov, aspect, limits), [frame, fov, aspect, limits])

  const api = useMemo<RouteCameraApi>(() => {
    /** Flies to the goal, or jumps there (first view, reduced motion). */
    const go = (goal: Goal, animate: boolean) => {
      const f = flight.current
      f.target.set(...goal.target)
      // The controls clamp the distance every frame: a goal outside their range is never reached.
      f.distance = Math.min(range.max, Math.max(range.min, goal.distance))
      f.polar = goal.polar
      f.azimuth = goal.azimuth
      const c = controls.current
      if ((animate && !reducedMotion) || !c) {
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
      fit: (animate = true) => {
        userMoved.current = false
        go(home, animate)
      },
      top: () => {
        userMoved.current = true
        go(topView(frame, fov, aspect, limits), true)
      },
      focus: (p) => {
        userMoved.current = true
        const c = controls.current
        const now = c ? camera.position.distanceTo(c.target) : focusDistance
        go({ target: p, distance: Math.min(now, focusDistance), polar: null, azimuth: null }, true)
      },
      show: (points) => {
        userMoved.current = true
        go(overview(points, fov, aspect, limits), true)
      },
    }
  }, [aspect, camera, focusDistance, fov, frame, home, limits, range, reducedMotion])
  useEffect(() => {
    register(api)
    return () => register(null)
  }, [api, register])

  // The user takes the camera by dragging or zooming, not by a click (that picks a stop): auto
  // refits stop and a flight in progress gives way.
  useEffect(() => {
    const el = connected ?? gl.domElement
    let down: [number, number] | null = null
    const take = () => {
      userMoved.current = true
      flight.current.active = false
    }
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY]
    }
    const onMove = (e: PointerEvent) => {
      if (down && e.buttons !== 0 && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > DRAG_PX) {
        down = null
        take()
      }
    }
    const onUp = () => {
      down = null
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', take, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', take)
    }
  }, [connected, gl])

  // A new route: jump to it the first time, fly afterwards. The same route changing (a stop done,
  // moved or removed; a resize) refits only until the user takes the camera.
  useEffect(() => {
    if (fitted.current !== routeKey) {
      const first = fitted.current === null
      fitted.current = routeKey
      api.fit(!first)
    } else if (!userMoved.current) {
      api.fit(true)
    }
  }, [api, routeKey])

  // Priority -1: after the controls' update (their own -1, subscribed first) and before the labels
  // (0), so labels are placed with the camera this frame is drawn with.
  useFrame((state, dt) => {
    const c = controls.current
    const f = flight.current
    if (!c || !f.active) return
    // The canvas renders on demand: keep flights at the full frame rate.
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
    spherical.makeSafe()
    c.target.lerp(f.target, k)
    camera.position.setFromSpherical(spherical).add(c.target)
    camera.lookAt(c.target)

    const done =
      c.target.distanceTo(f.target) < f.distance * 0.001 &&
      Math.abs(spherical.radius - f.distance) < f.distance * 0.002 &&
      (f.polar === null || Math.abs(spherical.phi - f.polar) < 0.002) &&
      (f.azimuth === null || Math.abs(Math.sin(spherical.theta - f.azimuth)) < 0.002)
    if (done) f.active = false
  }, -1)

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.9}
      minPolarAngle={0.01}
      maxPolarAngle={Math.PI - 0.01}
      minDistance={range.min}
      maxDistance={range.max}
      screenSpacePanning={false}
    />
  )
}

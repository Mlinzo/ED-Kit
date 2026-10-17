import type { RouteTarget } from '../components/BodyBadges'

/** The route-target state of a body from a map of body id -> done. */
export function targetOf(targets: ReadonlyMap<number, boolean>, bodyId: number): RouteTarget | null {
  const done = targets.get(bodyId)
  return done === undefined ? null : done ? 'done' : 'open'
}

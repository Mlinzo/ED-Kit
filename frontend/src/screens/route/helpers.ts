import type { RouteBodyView, RouteStopView, RouteView } from '../../api/types'

export const spanshUrl = (address: string) => `https://spansh.co.uk/system/${address}`

/** Edits of the stored route (the list rows and the stop card on the map). */
export interface StopActions {
  skip: (seq: number, skipped: boolean) => void
  move: (seq: number, position: number) => void
  /** Unskip (if skipped) and put at `position`: a skipped stop moved there would stay skipped. */
  makeNext: (seq: number, position: number) => void
  remove: (seq: number) => void
}

/** The body counts for its mapping payout (not only for its biology). */
export const carto = (b: RouteBodyView) => b.kind !== 'bio'

/** What is still to earn on the body: the mapping payout unless mapped, the species not
 *  analysed yet (optimistic, or pessimistic with `low`). */
export function remaining(b: RouteBodyView, low = false): number {
  const mapping = carto(b) && !b.mapped ? b.mappingValue : 0
  if (b.bioSignals <= b.bioDone) return mapping
  return mapping + Math.floor(((low ? b.bioMin : b.bioMax) * (b.bioSignals - b.bioDone)) / b.bioSignals)
}

export interface Left {
  min: number
  max: number
}

/** A system's stop on the stored route, if it is one. */
export function routeStop(route: RouteView | null | undefined, address: string | null): RouteStopView | null {
  if (!route?.params || address === null) return null
  return route.stops.find((s) => s.address === address) ?? null
}

/** The System tab has something to say about the route here: a stop, or a next target. */
export function routeStripShown(route: RouteView | null | undefined, address: string | null): boolean {
  if (!route?.params || route.stops.length === 0) return false
  return routeStop(route, address) !== null || route.nextSeq !== null
}

/** Still to earn in a system (biology as a range). */
export function stopLeft(stop: RouteStopView): Left {
  let min = 0
  let max = 0
  for (const b of stop.bodies) {
    min += remaining(b, true)
    max += remaining(b)
  }
  return { min, max }
}

/** Still to earn along the route: every stop not skipped. */
export function routeLeft(route: RouteView): Left {
  let min = 0
  let max = 0
  for (const s of route.stops) {
    if (s.skipped) continue
    const left = stopLeft(s)
    min += left.min
    max += left.max
  }
  return { min, max }
}

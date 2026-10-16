import type { BodyView, SpeciesView } from '../api/types'

export type BodySort = 'value' | 'distance'

export function bodyLabel(body: BodyView): string {
  return body.shortName || body.name
}

export function sortBodies(bodies: readonly BodyView[], sort: BodySort): BodyView[] {
  const dist = (b: BodyView) => b.distanceLs ?? Number.POSITIVE_INFINITY
  return [...bodies].sort((a, b) =>
    sort === 'value'
      ? b.totalValue - a.totalValue || dist(a) - dist(b)
      : dist(a) - dist(b) || a.bodyId - b.bodyId,
  )
}

/** Bodies worth a glance; the rest are dimmed in the list. */
export function isNotable(body: BodyView): boolean {
  return (
    body.signals.bio > 0 ||
    body.worthMapping ||
    body.terraformable ||
    body.wasDiscovered === false && body.kind === 'planet' && body.totalValue >= 100_000 ||
    body.totalValue >= 250_000
  )
}

const SPECIES_ORDER = (s: SpeciesView) =>
  s.status === 'sampling' ? 0 : s.status === 'predicted' ? (s.certain ? 1 : 2) : 3

/** Sampling first, then confirmed-genus predictions, guesses, and finished species; by value. */
export function sortSpecies(list: readonly SpeciesView[]): SpeciesView[] {
  return [...list].sort((a, b) => SPECIES_ORDER(a) - SPECIES_ORDER(b) || b.bonusValue - a.bonusValue)
}

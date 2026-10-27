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

/**
 * Credits of the species you have analysed on the body: they sit in both ends of its bio range
 * (at their value with the bonus).
 */
export function bioAnalysed(body: BodyView): number {
  return body.species.reduce((sum, s) => (s.status === 'analysed' ? sum + s.bonusValue : sum), 0)
}

/** The body's biology still to earn: its estimate less the species analysed there. */
export function bioLeft(body: BodyView): { min: number; max: number } {
  const done = bioAnalysed(body)
  return { min: Math.max(0, body.bioValueMin - done), max: Math.max(0, body.bioValueMax - done) }
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

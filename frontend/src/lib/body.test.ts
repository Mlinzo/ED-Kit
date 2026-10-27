import { describe, expect, it } from 'vitest'
import type { BodyView, SpeciesView } from '../api/types'
import { buildSystem } from '../mock/fixtures'
import { bioAnalysed, bioLeft } from './body'

const base = buildSystem().bodies[0]
const species = (status: SpeciesView['status'], bonusValue: number) =>
  ({ ...base.species[0], status, bonusValue }) as SpeciesView
const body = (o: Partial<BodyView>): BodyView => ({ ...base, ...o })

describe('biology still to earn on a body', () => {
  it('drops the analysed species from both ends of the range', () => {
    const b = body({
      bioValueMin: 20_000_000,
      bioValueMax: 35_000_000,
      species: [species('analysed', 7_000_000), species('sampling', 4_000_000), species('predicted', 9_000_000)],
    })
    expect(bioAnalysed(b)).toBe(7_000_000)
    expect(bioLeft(b)).toEqual({ min: 13_000_000, max: 28_000_000 })
  })
  it('is the whole estimate before anything is analysed', () => {
    const b = body({ bioValueMin: 5_000_000, bioValueMax: 8_000_000, species: [species('sampling', 5_000_000)] })
    expect(bioLeft(b)).toEqual({ min: 5_000_000, max: 8_000_000 })
  })
  it('is nothing once every species is analysed', () => {
    const b = body({
      bioValueMin: 11_000_000,
      bioValueMax: 11_000_000,
      species: [species('analysed', 6_000_000), species('analysed', 5_000_000)],
    })
    expect(bioLeft(b)).toEqual({ min: 0, max: 0 })
  })
})

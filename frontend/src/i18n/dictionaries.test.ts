import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ru } from './ru'
import { uk } from './uk'

type Node = unknown

/** Sample calls: numbers that hit each plural form, strings, null. */
const SAMPLE_ARGS: unknown[][] = [
  [1, 'X', 1, 'X'],
  [3, 'Y', 3, 'Y'],
  [5, 'Z', 25, 'Z'],
  [21, null, 0, null],
]

function leaves(node: Node, path: string[] = []): [string, Node][] {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    return Object.entries(node as Record<string, Node>).flatMap(([k, v]) => leaves(v, [...path, k]))
  }
  return [[path.join('.'), node]]
}

function texts(value: Node): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') return SAMPLE_ARGS.map((args) => String((value as (...a: unknown[]) => unknown)(...args)))
  if (Array.isArray(value)) return value.flatMap(texts)
  return []
}

const reference = new Map(leaves(ru))

describe.each([
  ['en', en],
  ['uk', uk],
] as const)('%s dictionary', (code, dict) => {
  const own = new Map(leaves(dict))

  it('has every key of the original, and no others', () => {
    expect([...own.keys()].sort()).toEqual([...reference.keys()].sort())
  })

  it('has the same kinds of values, functions with the same parameters', () => {
    for (const [key, value] of reference) {
      const mine = own.get(key)
      expect(typeof mine, key).toBe(typeof value)
      if (typeof value === 'function') expect((mine as (...a: unknown[]) => unknown).length, key).toBe(value.length)
    }
  })

  it('has text everywhere', () => {
    for (const [key, value] of own) for (const s of texts(value)) expect(s.trim().length, key).toBeGreaterThan(0)
  })

  it('is written in its own language', () => {
    for (const [key, value] of own) {
      for (const s of texts(value)) {
        if (code === 'en') expect(s, key).not.toMatch(/[\u0400-\u04FF]/)
        // Letters Ukrainian does not have: a Russian string left untranslated.
        else expect(s, key).not.toMatch(/[ыэъёЫЭЪЁ]/)
      }
    }
  })
})

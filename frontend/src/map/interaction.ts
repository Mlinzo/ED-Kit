// Hover / selection / "you are here" of the map, outside React context: a body re-renders only
// when its own flags change, not on every hover anywhere on the map.

import { useSyncExternalStore } from 'react'

export interface InteractionState {
  hoveredId: number | null
  selectedId: number | null
  /** The body the ship is at now. */
  currentId: number | null
  /** The body the ship was last at, flown off since (the last known place). */
  leftId: number | null
  /** The body targeted in the game, while flying in supercruise. */
  targetId: number | null
}

const KEYS = ['hoveredId', 'selectedId', 'currentId', 'leftId', 'targetId'] as const

export class InteractionStore {
  private state: InteractionState = { hoveredId: null, selectedId: null, currentId: null, leftId: null, targetId: null }
  private listeners = new Set<() => void>()

  get = (): InteractionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(patch: Partial<InteractionState>): void {
    const next = { ...this.state, ...patch }
    const s = this.state
    if (KEYS.every((k) => next[k] === s[k])) return
    this.state = next
    for (const l of this.listeners) l()
  }

  /** Clears the hover only if it is still on `id` (pointer-out after the next body's pointer-over). */
  unhover(id: number): void {
    if (this.state.hoveredId === id) this.set({ hoveredId: null })
  }
}

export const HOVERED = 1
export const SELECTED = 2
export const CURRENT = 4
export const LEFT = 8
export const TARGET = 16

/** Bit flags (HOVERED | SELECTED | CURRENT | LEFT | TARGET) of one node; re-renders only when they change. */
export function useNodeFlags(store: InteractionStore, id: number): number {
  return useSyncExternalStore(store.subscribe, () => {
    const s = store.get()
    return (
      (s.hoveredId === id ? HOVERED : 0) |
      (s.selectedId === id ? SELECTED : 0) |
      (s.currentId === id ? CURRENT : 0) |
      (s.leftId === id ? LEFT : 0) |
      (s.targetId === id ? TARGET : 0)
    )
  })
}

/** The ship's body (now or last known) and the target, when both are on the map; else null. */
export function useCourse(store: InteractionStore): { from: number; to: number } | null {
  const from = useSyncExternalStore(store.subscribe, () => store.get().currentId ?? store.get().leftId)
  const to = useSyncExternalStore(store.subscribe, () => store.get().targetId)
  return from !== null && to !== null && from !== to ? { from, to } : null
}

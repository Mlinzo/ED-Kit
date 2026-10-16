// Hover / selection / "you are here" of the map, outside React context: a body re-renders only
// when its own flags change, not on every hover anywhere on the map.

import { useSyncExternalStore } from 'react'

export interface InteractionState {
  hoveredId: number | null
  selectedId: number | null
  currentId: number | null
}

export class InteractionStore {
  private state: InteractionState = { hoveredId: null, selectedId: null, currentId: null }
  private listeners = new Set<() => void>()

  get = (): InteractionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(patch: Partial<InteractionState>): void {
    const next = { ...this.state, ...patch }
    const s = this.state
    if (next.hoveredId === s.hoveredId && next.selectedId === s.selectedId && next.currentId === s.currentId) return
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

/** Bit flags (HOVERED | SELECTED | CURRENT) of one node; re-renders only when they change. */
export function useNodeFlags(store: InteractionStore, id: number): number {
  return useSyncExternalStore(store.subscribe, () => {
    const s = store.get()
    return (s.hoveredId === id ? HOVERED : 0) | (s.selectedId === id ? SELECTED : 0) | (s.currentId === id ? CURRENT : 0)
  })
}

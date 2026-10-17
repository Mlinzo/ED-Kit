// Hover and selection on the route map (stop addresses), outside React context: only the parts
// that show them re-render.

import { useSyncExternalStore } from 'react'

export interface PickState {
  hovered: string | null
  selected: string | null
}

export class PickStore {
  private state: PickState = { hovered: null, selected: null }
  private listeners = new Set<() => void>()

  get = (): PickState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(patch: Partial<PickState>): void {
    const next = { ...this.state, ...patch }
    if (next.hovered === this.state.hovered && next.selected === this.state.selected) return
    this.state = next
    for (const l of this.listeners) l()
  }
}

export function usePick(store: PickStore): PickState {
  return useSyncExternalStore(store.subscribe, store.get)
}

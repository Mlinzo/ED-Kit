import { createContext, useContext, type RefObject } from 'react'
import type { Group, Object3D } from 'three'
import type { InteractionStore } from './interaction'
import type { MapNode, SystemLayout } from './layout'
import type { SizerSlot } from './sizing'

/** A label the culler may show or hide (DOM element inside a drei <Html>). */
export interface LabelEntry {
  node: MapNode
  el: HTMLElement
  priority: number
}

/** Mutable scene registries, filled by ref callbacks and read in useFrame (no re-renders). */
export interface MapRegistry {
  /**
   * Node id -> its group (positioned relative to the parent every frame, scaled by the zoom of its
   * subsystem: see sizing.ts).
   */
  groups: Map<number, Group>
  /** Node id -> holder of the body (or placeholder) alone, scaled by its body-only magnification. */
  bodies: Map<number, Group>
  /** Child id -> holder of its orbit line, rotated so the bright trail end follows the body. */
  orbits: Map<number, Object3D>
  labels: Map<number, LabelEntry>
  /** On-screen magnification of the current layout, solved every frame (null before the first). */
  sizer: SizerSlot
}

export interface CameraApi {
  /** Whole-system view; `resume` turns automatic re-fitting (as the system fills in) back on. */
  fit: (animate?: boolean, resume?: boolean) => void
  focus: (id: number) => void
}

/**
 * Everything here is stable while a layout is shown (refetches of an unchanged system keep it),
 * so consumers do not re-render; hover / selection live in `interaction`.
 */
export interface MapContextValue {
  layout: SystemLayout
  registry: MapRegistry
  /** Moment the layout was built: the initial positions (and frozen ones with reduced motion). */
  startedAt: number
  reducedMotion: boolean
  interaction: InteractionStore
  select: (node: MapNode) => void
  /**
   * Stable DOM container for every label <Html portal>. drei re-creates an Html's React root when
   * its default target changes after mount (R3F events connecting), and the old root's deferred
   * unmount then empties the element; a fixed portal avoids that race.
   */
  labelLayer: RefObject<HTMLElement>
  /** The camera rig registers its fit()/focus() here (null on unmount). */
  registerCamera: (api: CameraApi | null) => void
}

export const MapContext = createContext<MapContextValue | null>(null)

export function useMap(): MapContextValue {
  const ctx = useContext(MapContext)
  if (!ctx) throw new Error('useMap outside <MapContext>')
  return ctx
}

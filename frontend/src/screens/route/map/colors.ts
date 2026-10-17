import type { StopState } from './geometry'

/** Colours of the stop states (sRGB hex, as in the list: done emerald, next sky). */
export const STATE_COLOR: Record<StopState, string> = {
  done: '#34d399',
  next: '#7dd3fc',
  ahead: '#e4e4e7',
  skipped: '#71717a',
}
export const YOU_COLOR = '#6ee7b7'
export const NEXT_GLOW = '#38bdf8'
export const DESTINATION_COLOR = '#fcd34d'
export const START_COLOR = '#d4d4d8'
export const STALK_COLOR = '#64748b'

/** sRGB components of "#rrggbb": the custom shaders write them as they are (no colour management). */
export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

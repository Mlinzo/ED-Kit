import { CanvasTexture, SRGBColorSpace, type Camera, type PerspectiveCamera } from 'three'

let halo: CanvasTexture | null = null

/** Soft radial glow (white, tinted by the sprite material colour). Shared by all halos. */
export function haloTexture(): CanvasTexture {
  if (halo) return halo
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.18, 'rgba(255,255,255,0.55)')
    grad.addColorStop(0.42, 'rgba(255,255,255,0.16)')
    grad.addColorStop(0.7, 'rgba(255,255,255,0.04)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  halo = new CanvasTexture(canvas)
  halo.colorSpace = SRGBColorSpace
  return halo
}

/** World units covered by one CSS pixel at `distance` from a perspective camera. */
export function worldPerPixel(camera: Camera, distance: number, viewportHeightPx: number): number {
  const fov = (camera as PerspectiveCamera).fov ?? 40
  return (2 * Math.tan(((fov * Math.PI) / 180) / 2) * distance) / Math.max(1, viewportHeightPx)
}

/** Camera distance at which a sphere of `radius` fills the view (used for close-ups). */
export function fitDistance(radius: number, camera: Camera, aspect: number): number {
  const fov = ((camera as PerspectiveCamera).fov ?? 40) * (Math.PI / 180)
  const halfV = fov / 2
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  return Math.max(radius, 0.5) / Math.sin(Math.min(halfV, halfH))
}

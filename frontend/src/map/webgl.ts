let webglSupport: boolean | null = null

/** Whether the browser can draw the 3D maps; probed once per page load. */
export function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    // Release the probe context right away: browsers cap the number of live WebGL contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    webglSupport = Boolean(gl)
  } catch {
    webglSupport = false
  }
  return webglSupport
}

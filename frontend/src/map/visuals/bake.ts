// GPU texture baking: procedural surfaces are rendered once into an equirectangular render
// target and then sampled by ordinary lit materials. Baking runs in a small requestAnimationFrame
// queue (a few textures per frame), results are cached per renderer by key and ref-counted, and
// render targets are disposed a few seconds after the last user unmounts.

import {
  BufferGeometry,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  RepeatWrapping,
  ClampToEdgeWrapping,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three'

export interface BakeSpec {
  /** Cache key: identical keys share one texture. */
  key: string
  /** Fragment shader program id (see registerBakeProgram). */
  program: string
  uniforms: Record<string, unknown>
  width: number
  height: number
}

export interface BakeEntry {
  readonly key: string
  readonly texture: Texture
  ready: boolean
  /** Subscribe to "baked"; returns unsubscribe. Fires immediately if already ready. */
  onReady(fn: () => void): () => void
}

interface Entry extends BakeEntry {
  spec: BakeSpec
  /** Queue order: higher first, then first come first served. */
  priority: number
  rt: WebGLRenderTarget
  refs: number
  listeners: Set<() => void>
  disposeTimer: ReturnType<typeof setTimeout> | null
  queued: boolean
  disposed: boolean
}

interface RendererState {
  scene: Scene
  camera: OrthographicCamera
  quad: Mesh
  materials: Map<string, ShaderMaterial>
  /** Programs compiled (true) or compiling in the background (false). */
  compiled: Map<string, boolean>
  entries: Map<string, Entry>
  queue: Entry[]
  rafPending: boolean
}

const programs = new Map<string, string>()
const states = new WeakMap<WebGLRenderer, RendererState>()

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** Registers a bake fragment shader (must declare `varying vec2 vUv` usage and write gl_FragColor). */
export function registerBakeProgram(id: string, fragmentShader: string) {
  programs.set(id, fragmentShader)
}

/**
 * Bakes per animation frame. A system switch queues one or two bakes per planet; spreading them
 * keeps each frame short (the most interesting bodies come first, see `priority`).
 */
const BAKES_PER_FRAME = 2
const DISPOSE_DELAY_MS = 4000

/**
 * Dev instrumentation (gallery bench). With `sync`, every bake reads one pixel back so the
 * measured time includes GPU work (and the shader compile on a program's first use).
 */
export const bakeDebug = {
  sync: false,
  count: 0,
  ms: 0,
  maxMs: 0,
  /** Background compile per program (wall time until ready), ms. */
  compile: {} as Record<string, number>,
  /** Render targets currently alive, across renderers. */
  live: 0,
}
const pixel = new Uint8Array(4)

function stateFor(gl: WebGLRenderer): RendererState {
  let s = states.get(gl)
  if (s) return s
  const geo = new BufferGeometry()
  // One oversized triangle covering the viewport.
  geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  const quad = new Mesh(geo)
  quad.frustumCulled = false
  const scene = new Scene()
  scene.add(quad)
  s = {
    scene,
    camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
    quad,
    materials: new Map(),
    compiled: new Map(),
    entries: new Map(),
    queue: [],
    rafPending: false,
  }
  states.set(gl, s)
  const state = s
  // After a context loss render-target contents are gone: bake everything again.
  gl.domElement.addEventListener('webglcontextrestored', () => {
    state.compiled.clear()
    for (const e of state.entries.values()) {
      e.ready = false
      enqueue(gl, state, e)
    }
  })
  return s
}

function materialFor(state: RendererState, spec: BakeSpec): ShaderMaterial {
  let m = state.materials.get(spec.program)
  if (!m) {
    const frag = programs.get(spec.program)
    if (!frag) throw new Error(`Unknown bake program ${spec.program}`)
    m = new ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false })
    state.materials.set(spec.program, m)
  }
  // The renderer keeps a reference to the uniforms object: update values in place.
  const uniforms: Record<string, IUniform> = m.uniforms
  for (const [k, v] of Object.entries(spec.uniforms)) {
    const u = uniforms[k]
    if (u) u.value = v
    else uniforms[k] = { value: v }
  }
  return m
}

function enqueue(gl: WebGLRenderer, state: RendererState, e: Entry) {
  if (!e.queued) {
    e.queued = true
    // After everything of the same or a higher priority.
    const at = state.queue.findIndex((q) => q.priority < e.priority)
    if (at < 0) state.queue.push(e)
    else state.queue.splice(at, 0, e)
  }
  if (!state.rafPending) {
    state.rafPending = true
    requestAnimationFrame(() => pump(gl, state))
  }
}

/**
 * Compiles a bake program without blocking (KHR_parallel_shader_compile through compileAsync).
 * The big noise shaders take a while to compile (notably on Windows / D3D), and a synchronous
 * first use would freeze the page meanwhile. Entries wait in the queue until it is ready.
 */
function compileInBackground(gl: WebGLRenderer, state: RendererState, e: Entry) {
  const program = e.spec.program
  state.compiled.set(program, false)
  const t0 = performance.now()
  const mesh = new Mesh(state.quad.geometry, materialFor(state, e.spec))
  mesh.frustumCulled = false
  const scene = new Scene()
  scene.add(mesh)
  const done = () => {
    state.compiled.set(program, true)
    bakeDebug.compile[program] = Math.round(performance.now() - t0)
    if (state.queue.length > 0 && !state.rafPending) {
      state.rafPending = true
      requestAnimationFrame(() => pump(gl, state))
    }
  }
  // Program parameters depend on the bound target (output colour space, tone mapping):
  // compile against a bake target so the bake reuses this exact program.
  const prev = gl.getRenderTarget()
  gl.setRenderTarget(e.rt)
  try {
    gl.compileAsync(scene, state.camera).then(done, done)
  } catch {
    done()
  } finally {
    gl.setRenderTarget(prev)
  }
}

function pump(gl: WebGLRenderer, state: RendererState) {
  state.rafPending = false
  let n = 0
  const waiting: Entry[] = []
  while (state.queue.length > 0 && n < BAKES_PER_FRAME) {
    const e = state.queue.shift()!
    if (e.disposed) {
      e.queued = false
      continue
    }
    const compiled = state.compiled.get(e.spec.program)
    if (compiled !== true) {
      if (compiled === undefined) compileInBackground(gl, state, e)
      waiting.push(e)
      continue
    }
    e.queued = false
    bakeNow(gl, state, e)
    n++
  }
  state.queue.unshift(...waiting)
  // Keep pumping while there is bakeable work; a finished compile restarts the pump.
  if (state.queue.some((e) => state.compiled.get(e.spec.program) !== false)) {
    state.rafPending = true
    requestAnimationFrame(() => pump(gl, state))
  }
}

function bakeNow(gl: WebGLRenderer, state: RendererState, e: Entry) {
  const t0 = bakeDebug.sync ? performance.now() : 0
  state.quad.material = materialFor(state, e.spec)

  const prevTarget = gl.getRenderTarget()
  const prevXr = gl.xr.enabled
  const prevAutoClear = gl.autoClear
  gl.xr.enabled = false
  gl.autoClear = true
  gl.setRenderTarget(e.rt)
  gl.render(state.scene, state.camera)
  if (bakeDebug.sync) gl.readRenderTargetPixels(e.rt, 0, 0, 1, 1, pixel)
  gl.setRenderTarget(prevTarget)
  gl.xr.enabled = prevXr
  gl.autoClear = prevAutoClear
  if (bakeDebug.sync) {
    const ms = performance.now() - t0
    bakeDebug.count++
    bakeDebug.ms += ms
    bakeDebug.maxMs = Math.max(bakeDebug.maxMs, ms)
  }

  e.ready = true
  for (const fn of [...e.listeners]) fn()
}

function scheduleDispose(state: RendererState, e: Entry) {
  if (e.disposeTimer) clearTimeout(e.disposeTimer)
  e.disposeTimer = setTimeout(() => {
    e.disposeTimer = null
    if (e.refs > 0) return
    if (state.entries.get(e.key) === e) state.entries.delete(e.key)
    e.disposed = true
    e.ready = false
    e.rt.dispose()
    bakeDebug.live--
  }, DISPOSE_DELAY_MS)
}

/**
 * Get (or create and queue) the baked texture for a spec. Pair with retainBake/releaseBake.
 * `priority` orders the queue (higher first).
 */
export function acquireBake(gl: WebGLRenderer, spec: BakeSpec, priority = 0): BakeEntry {
  const state = stateFor(gl)
  const existing = state.entries.get(spec.key)
  if (existing) {
    if (existing.queued && priority > existing.priority) {
      // Wanted sooner by a more interesting body: move it up.
      state.queue.splice(state.queue.indexOf(existing), 1)
      existing.queued = false
      existing.priority = priority
      enqueue(gl, state, existing)
    }
    return existing
  }

  const rt = new WebGLRenderTarget(spec.width, spec.height, {
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: ClampToEdgeWrapping,
    anisotropy: 4,
    colorSpace: SRGBColorSpace,
  })
  bakeDebug.live++
  const listeners = new Set<() => void>()
  const e: Entry = {
    key: spec.key,
    spec,
    priority,
    rt,
    texture: rt.texture,
    ready: false,
    refs: 0,
    listeners,
    disposeTimer: null,
    queued: false,
    disposed: false,
    onReady(fn) {
      if (e.ready) fn()
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  state.entries.set(spec.key, e)
  enqueue(gl, state, e)
  // Created during a render that never commits: clean up if nobody retains it.
  scheduleDispose(state, e)
  return e
}

export function retainBake(gl: WebGLRenderer, entry: BakeEntry) {
  const state = stateFor(gl)
  const e = entry as Entry
  e.refs++
  if (e.disposeTimer) {
    clearTimeout(e.disposeTimer)
    e.disposeTimer = null
  }
  if (e.disposed) {
    // Disposed while nobody used it (e.g. a slow remount): bake it again.
    e.disposed = false
    bakeDebug.live++
    if (!state.entries.has(e.key)) state.entries.set(e.key, e)
    enqueue(gl, state, e)
  }
}

export function releaseBake(gl: WebGLRenderer, entry: BakeEntry) {
  const state = stateFor(gl)
  const e = entry as Entry
  e.refs = Math.max(0, e.refs - 1)
  if (e.refs === 0) scheduleDispose(state, e)
}

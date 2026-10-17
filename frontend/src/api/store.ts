import type { ConnectionState, Transport } from './transport'
import type {
  HistoryView,
  IngestState,
  LiveStatus,
  SessionView,
  StatsView,
  StreamEvent,
  SurfaceView,
  SystemView,
  Topic,
} from './types'

export interface ViewMap {
  system: SystemView
  surface: SurfaceView
  session: SessionView
  stats: StatsView
  history: HistoryView
}

/** Query parameters of a view request, e.g. `{ address }` for a system from the history. */
export type ViewParams = Readonly<Record<string, string>>

export interface ViewEntry<T> {
  data: T | null
  error: string | null
  /** True only while there is no data yet and the first request is in flight. */
  loading: boolean
}

export const TOPICS: readonly Topic[] = ['system', 'surface', 'session', 'stats', 'history']

/** Minimum gap between two requests for the same view (coalesces invalidate bursts). */
const MIN_GAP_MS = 250
/**
 * A request that hangs (phone asleep mid-request, half-open socket) would otherwise block
 * every later refetch of its view, since only one request per view is in flight.
 */
const FETCH_TIMEOUT_MS = 15_000
/**
 * Views are first fetched after the stream's `hello` (a fetch made before it could miss an
 * invalidate and would be repeated anyway). If no hello arrives in time — SSE blocked or
 * buffered by a proxy — fetch without it so the screens still fill.
 */
const HELLO_GRACE_MS = 1_500
/** Unused views with parameters kept cached, so stepping back through the history is instant. */
const MAX_IDLE_PARAM_VIEWS = 12

const EMPTY: ViewEntry<never> = { data: null, error: null, loading: false }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** URL of a view; also its cache key. */
export function viewPath(topic: Topic, params?: ViewParams): string {
  const entries = Object.entries(params ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = new URLSearchParams(entries).toString()
  return query ? `/api/view/${topic}?${query}` : `/api/view/${topic}`
}

/** One cached view (a topic, possibly with parameters) and its fetch bookkeeping. */
interface Slot {
  topic: Topic
  entry: ViewEntry<unknown>
  /** Bumped by every invalidate; the view is fresh once `loaded` has caught up with it. */
  wanted: number
  loaded: number
  inflight: boolean
  lastStart: number
  refs: number
  timer: ReturnType<typeof setTimeout> | undefined
  /** When the slot was last released (orders the eviction of idle slots). */
  lastUsed: number
}

/**
 * Client-side state: SSE connection, live status, ingest progress and a cache of views.
 * A view is fetched while at least one component uses it, and refetched whenever the
 * backend invalidates its topic (or the stream reconnects). Views with parameters (a system
 * from the history) follow their topic's invalidations.
 */
export class Store {
  readonly transport: Transport
  connection: ConnectionState = 'connecting'
  status: LiveStatus | null = null
  ingest: IngestState | null = null

  private slots = new Map<string, Slot>()
  private clock = 0
  private listeners = new Set<() => void>()
  private stopStream: (() => void) | null = null
  /** False until the first `hello` (or the grace timeout): holds back the first fetches. */
  private synced = false
  private graceTimer: ReturnType<typeof setTimeout> | undefined

  constructor(transport: Transport) {
    this.transport = transport
  }

  start(): void {
    if (this.stopStream) return
    if (!this.synced) this.graceTimer = setTimeout(() => this.markSynced(), HELLO_GRACE_MS)
    this.stopStream = this.transport.stream({
      onState: (state) => {
        this.connection = state
        // Backend unreachable: stop waiting for hello so errors/retries surface normally.
        if (state === 'offline') this.markSynced()
        this.emit()
      },
      onEvent: (event) => this.handle(event),
    })
  }

  stop(): void {
    this.stopStream?.()
    this.stopStream = null
    clearTimeout(this.graceTimer)
    this.graceTimer = undefined
    for (const slot of this.slots.values()) {
      clearTimeout(slot.timer)
      slot.timer = undefined
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The cached view at `path` (see `viewPath`). */
  getEntry(path: string): ViewEntry<unknown> {
    return this.slots.get(path)?.entry ?? EMPTY
  }

  /** Marks a view as used; returns the release function. */
  retain(topic: Topic, path: string): () => void {
    let slot = this.slots.get(path)
    if (!slot) {
      slot = {
        topic,
        entry: EMPTY,
        wanted: 1,
        loaded: 0,
        inflight: false,
        lastStart: 0,
        refs: 0,
        timer: undefined,
        lastUsed: 0,
      }
      this.slots.set(path, slot)
    }
    const held = slot
    held.refs += 1
    this.maybeFetch(path)
    return () => {
      held.refs -= 1
      held.lastUsed = ++this.clock
      this.evictIdle()
    }
  }

  /** Forces a refetch of every view of the given topics. */
  invalidate(topics: readonly Topic[]): void {
    for (const [path, slot] of this.slots) {
      if (!topics.includes(slot.topic)) continue
      slot.wanted += 1
      this.maybeFetch(path)
    }
  }

  /** Forces a refetch of one view (used by "retry" buttons). */
  refresh(path: string): void {
    const slot = this.slots.get(path)
    if (!slot) return
    slot.wanted += 1
    this.maybeFetch(path)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private handle(event: StreamEvent): void {
    switch (event.type) {
      case 'hello':
        // New or resumed connection: anything may have changed while we were away.
        this.synced = true
        clearTimeout(this.graceTimer)
        this.graceTimer = undefined
        this.invalidate(TOPICS)
        void this.refreshMeta()
        break
      case 'invalidate':
        this.invalidate(event.data.topics)
        break
      case 'status':
        this.status = event.data
        this.emit()
        break
      case 'ingest':
        this.ingest = event.data
        this.emit()
        break
    }
  }

  private markSynced(): void {
    clearTimeout(this.graceTimer)
    this.graceTimer = undefined
    if (this.synced) return
    this.synced = true
    void this.refreshMeta()
    for (const path of this.slots.keys()) this.maybeFetch(path)
  }

  private async refreshMeta(): Promise<void> {
    const [status, ingest] = await Promise.allSettled([
      this.transport.fetchJson<LiveStatus>('/api/status'),
      this.transport.fetchJson<IngestState>('/api/ingest'),
    ])
    let changed = false
    // A pushed SSE update may already be newer than the REST response; keep the newest.
    if (status.status === 'fulfilled' && isNewerStatus(status.value, this.status)) {
      this.status = status.value
      changed = true
    }
    if (ingest.status === 'fulfilled' && (!this.ingest || ingest.value.events >= this.ingest.events)) {
      this.ingest = ingest.value
      changed = true
    }
    if (changed) this.emit()
  }

  /** Drops the least recently used idle views with parameters beyond the cache size. */
  private evictIdle(): void {
    const idle = [...this.slots].filter(([path, slot]) => slot.refs <= 0 && path.includes('?'))
    if (idle.length <= MAX_IDLE_PARAM_VIEWS) return
    idle.sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [path, slot] of idle.slice(0, idle.length - MAX_IDLE_PARAM_VIEWS)) {
      clearTimeout(slot.timer)
      this.slots.delete(path)
    }
  }

  private setEntry(slot: Slot, entry: ViewEntry<unknown>): void {
    slot.entry = entry
    this.emit()
  }

  private maybeFetch(path: string): void {
    const slot = this.slots.get(path)
    if (!slot || !this.synced || slot.refs <= 0 || slot.inflight || slot.timer !== undefined) return
    if (slot.loaded === slot.wanted && slot.entry.error === null && slot.entry.data !== null) return
    const wait = slot.lastStart + MIN_GAP_MS - Date.now()
    if (wait > 0) {
      slot.timer = setTimeout(() => {
        slot.timer = undefined
        this.maybeFetch(path)
      }, wait)
      return
    }
    void this.fetchView(path, slot)
  }

  private async fetchView(path: string, slot: Slot): Promise<void> {
    const version = slot.wanted
    slot.inflight = true
    slot.lastStart = Date.now()
    if (slot.entry.data === null && !slot.entry.loading) this.setEntry(slot, { ...slot.entry, loading: true })
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(new Error(`timeout: ${path}`)), FETCH_TIMEOUT_MS)
    try {
      const data = await this.transport.fetchJson<unknown>(path, abort.signal)
      slot.loaded = version
      this.setEntry(slot, { data, error: null, loading: false })
    } catch (err) {
      slot.loaded = version
      this.setEntry(slot, { ...slot.entry, error: message(err), loading: false })
    } finally {
      clearTimeout(timeout)
      slot.inflight = false
      if (slot.wanted !== version) this.maybeFetch(path)
    }
  }
}

function isNewerStatus(next: LiveStatus, current: LiveStatus | null): boolean {
  if (!current || !current.timestamp || !next.timestamp) return true
  return next.timestamp >= current.timestamp
}

import type { ConnectionState, Transport } from './transport'
import type {
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
}

export interface ViewEntry<T> {
  data: T | null
  error: string | null
  /** True only while there is no data yet and the first request is in flight. */
  loading: boolean
}

export const TOPICS: readonly Topic[] = ['system', 'surface', 'session', 'stats']

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

const EMPTY: ViewEntry<never> = { data: null, error: null, loading: false }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function perTopic<T>(value: () => T): Record<Topic, T> {
  return { system: value(), surface: value(), session: value(), stats: value() }
}

/**
 * Client-side state: SSE connection, live status, ingest progress and a cache of views.
 * A view is fetched while at least one component uses it, and refetched whenever the
 * backend invalidates its topic (or the stream reconnects).
 */
export class Store {
  readonly transport: Transport
  connection: ConnectionState = 'connecting'
  status: LiveStatus | null = null
  ingest: IngestState | null = null

  private entries: Record<Topic, ViewEntry<unknown>> = perTopic(() => EMPTY)
  private wanted = perTopic(() => 1)
  private loaded = perTopic(() => 0)
  private inflight = perTopic(() => false)
  private lastStart = perTopic(() => 0)
  private refs = perTopic(() => 0)
  private timers: Partial<Record<Topic, ReturnType<typeof setTimeout>>> = {}
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
    for (const t of TOPICS) {
      clearTimeout(this.timers[t])
      delete this.timers[t]
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getEntry<K extends Topic>(topic: K): ViewEntry<ViewMap[K]> {
    return this.entries[topic] as ViewEntry<ViewMap[K]>
  }

  /** Marks a view as used; returns the release function. */
  retain(topic: Topic): () => void {
    this.refs[topic] += 1
    this.maybeFetch(topic)
    return () => {
      this.refs[topic] -= 1
    }
  }

  /** Forces a refetch of the given views (also used by "retry" buttons). */
  invalidate(topics: readonly Topic[]): void {
    for (const t of topics) {
      if (!TOPICS.includes(t)) continue
      this.wanted[t] += 1
      this.maybeFetch(t)
    }
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
    for (const t of TOPICS) this.maybeFetch(t)
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

  private setEntry(topic: Topic, entry: ViewEntry<unknown>): void {
    this.entries[topic] = entry
    this.emit()
  }

  private maybeFetch(topic: Topic): void {
    if (!this.synced || this.refs[topic] <= 0 || this.inflight[topic] || this.timers[topic] !== undefined) return
    const entry = this.entries[topic]
    if (this.loaded[topic] === this.wanted[topic] && entry.error === null && entry.data !== null) return
    const wait = this.lastStart[topic] + MIN_GAP_MS - Date.now()
    if (wait > 0) {
      this.timers[topic] = setTimeout(() => {
        delete this.timers[topic]
        this.maybeFetch(topic)
      }, wait)
      return
    }
    void this.fetchView(topic)
  }

  private async fetchView(topic: Topic): Promise<void> {
    const version = this.wanted[topic]
    this.inflight[topic] = true
    this.lastStart[topic] = Date.now()
    const before = this.entries[topic]
    if (before.data === null && !before.loading) this.setEntry(topic, { ...before, loading: true })
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(new Error(`timeout: /api/view/${topic}`)), FETCH_TIMEOUT_MS)
    try {
      const data = await this.transport.fetchJson<unknown>(`/api/view/${topic}`, abort.signal)
      this.loaded[topic] = version
      this.setEntry(topic, { data, error: null, loading: false })
    } catch (err) {
      this.loaded[topic] = version
      this.setEntry(topic, { ...this.entries[topic], error: message(err), loading: false })
    } finally {
      clearTimeout(timeout)
      this.inflight[topic] = false
      if (this.wanted[topic] !== version) this.maybeFetch(topic)
    }
  }
}

function isNewerStatus(next: LiveStatus, current: LiveStatus | null): boolean {
  if (!current || !current.timestamp || !next.timestamp) return true
  return next.timestamp >= current.timestamp
}

import type { StreamEvent } from './types'

/**
 * connecting   – first attempt, never connected yet
 * open         – SSE stream is live
 * reconnecting – was live, lost it, retrying
 * offline      – cannot reach the backend (retries continue in the background)
 */
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'offline'

export interface StreamHandlers {
  onState(state: ConnectionState): void
  onEvent(event: StreamEvent): void
}

/** Where data comes from: the real backend, or the demo simulation (?mock=1). */
export interface Transport {
  readonly mock: boolean
  fetchJson<T>(path: string, signal?: AbortSignal): Promise<T>
  /** A write (POST / PUT / DELETE) with an optional JSON body; null for an empty answer. */
  send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T | null>
  /** Opens the event stream; returns a function that closes it. */
  stream(handlers: StreamHandlers): () => void
}

const STREAM_URL = '/api/stream'
const EVENT_TYPES = ['hello', 'invalidate', 'status', 'ingest'] as const
const MAX_BACKOFF_MS = 15_000
/** A lost connection that has not come back after this long is reported as offline. */
const OFFLINE_AFTER_MS = 8_000
/**
 * Optional keepalive: if the server sends `event: ping`, a stream silent for this long is
 * treated as dead (half-open TCP on Wi-Fi, a proxy that hides the upstream drop) and reopened.
 * Note: an SSE comment line (`: ping`) keeps proxies happy but is invisible to EventSource,
 * so it cannot drive this watchdog — the server must send a named `ping` event.
 */
const PING_TIMEOUT_MS = 45_000
const WATCHDOG_INTERVAL_MS = 5_000

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, path: string) {
    super(`HTTP ${status}: ${path}`)
    this.status = status
  }
}

export function createLiveTransport(): Transport {
  return {
    mock: false,

    async fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
      const res = await fetch(path, { signal, headers: { Accept: 'application/json' } })
      if (!res.ok) throw new HttpError(res.status, path)
      return (await res.json()) as T
    },

    async send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
      const res = await fetch(path, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!res.ok) throw new HttpError(res.status, path)
      const text = await res.text()
      return text ? (JSON.parse(text) as T) : null
    },

    stream(handlers: StreamHandlers): () => void {
      let source: EventSource | null = null
      let closed = false
      let everOpen = false
      let attempt = 0
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let offlineTimer: ReturnType<typeof setTimeout> | undefined
      let state: ConnectionState = 'connecting'
      let lastEventAt = 0
      let sawPing = false

      const setState = (next: ConnectionState) => {
        if (next === state) return
        state = next
        handlers.onState(next)
      }

      const markLost = () => {
        if (!everOpen) {
          setState('offline')
          return
        }
        if (state === 'open') setState('reconnecting')
        if (offlineTimer === undefined) {
          offlineTimer = setTimeout(() => {
            offlineTimer = undefined
            if (state !== 'open') setState('offline')
          }, OFFLINE_AFTER_MS)
        }
      }

      const scheduleReconnect = () => {
        if (closed || retryTimer !== undefined) return
        const wait = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt)
        attempt += 1
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          open()
        }, wait)
      }

      const open = () => {
        if (closed) return
        source?.close()
        const es = new EventSource(STREAM_URL)
        source = es
        sawPing = false

        es.onopen = () => {
          // Re-arm the watchdog per connection (the browser's own reconnects included):
          // a backend that does not send pings must never trip it.
          sawPing = false
          lastEventAt = Date.now()
          attempt = 0
          everOpen = true
          clearTimeout(offlineTimer)
          offlineTimer = undefined
          setState('open')
        }

        for (const type of EVENT_TYPES) {
          es.addEventListener(type, (e) => {
            if (source !== es) return
            lastEventAt = Date.now()
            let data: unknown
            try {
              data = JSON.parse((e as MessageEvent<string>).data)
            } catch {
              return // Ignore malformed frames; the next invalidate/hello resyncs.
            }
            // Handler errors are bugs, not bad frames: report them instead of swallowing.
            try {
              handlers.onEvent({ type, data } as StreamEvent)
            } catch (err) {
              console.error(`[stream] ${type} handler failed`, err)
            }
          })
        }

        es.addEventListener('ping', () => {
          if (source !== es) return
          sawPing = true
          lastEventAt = Date.now()
        })

        es.onerror = () => {
          if (closed || source !== es) return
          markLost()
          // CONNECTING: the browser retries on its own. CLOSED: it gave up (HTTP error,
          // wrong content type, proxy 502 while the backend is down) — retry ourselves.
          if (es.readyState === EventSource.CLOSED) {
            es.close()
            scheduleReconnect()
          }
        }
      }

      // Phones drop connections while asleep; reconnect at once when the page comes back.
      // A stream that still claims to be open but has been silent past the ping timeout is
      // a half-open socket from before the sleep: replace it instead of waiting for the watchdog.
      const wake = () => {
        if (closed || document.visibilityState !== 'visible') return
        const stale = sawPing && state === 'open' && Date.now() - lastEventAt >= PING_TIMEOUT_MS
        if (!source || source.readyState === EventSource.CLOSED || stale) {
          clearTimeout(retryTimer)
          retryTimer = undefined
          attempt = 0
          if (stale) markLost()
          open()
        }
      }

      const watchdog = setInterval(() => {
        if (closed || !sawPing || state !== 'open' || Date.now() - lastEventAt < PING_TIMEOUT_MS) return
        source?.close()
        source = null
        markLost()
        scheduleReconnect()
      }, WATCHDOG_INTERVAL_MS)

      document.addEventListener('visibilitychange', wake)
      window.addEventListener('online', wake)
      open()

      return () => {
        closed = true
        clearInterval(watchdog)
        clearTimeout(retryTimer)
        clearTimeout(offlineTimer)
        document.removeEventListener('visibilitychange', wake)
        window.removeEventListener('online', wake)
        source?.close()
        source = null
      }
    },
  }
}

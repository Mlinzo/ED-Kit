import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import { StoreContext } from './context'
import { viewPath, type Store, type ViewEntry, type ViewMap, type ViewParams } from './store'
import type { ConnectionState } from './transport'
import type { IngestState, LiveStatus, Topic } from './types'

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore() must be used inside <DataProvider>')
  return store
}

function useStoreValue<T>(select: (store: Store) => T): T {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => select(store))
}

export interface StreamInfo {
  connection: ConnectionState
  mock: boolean
}

/**
 * The live event stream (SSE on /api/stream, auto-reconnecting). The connection itself
 * is owned by <DataProvider>; this hook exposes its state.
 */
export function useStream(): StreamInfo {
  const store = useStore()
  const connection = useSyncExternalStore(store.subscribe, () => store.connection)
  return { connection, mock: store.transport.mock }
}

/** Latest decoded Status.json pushed by the backend (null until the first one arrives). */
export function useLiveStatus(): LiveStatus | null {
  return useStoreValue((s) => s.status)
}

/**
 * A value derived from the live status. Components re-render only when the selected value
 * changes, so return primitives (or stable references) — status updates arrive several times a second.
 */
export function useLiveStatusSelector<T>(select: (status: LiveStatus | null) => T): T {
  return useStoreValue((s) => select(s.status))
}

/** Journal ingest/backfill progress. */
export function useIngest(): IngestState | null {
  return useStoreValue((s) => s.ingest)
}

export interface ViewResult<T> extends ViewEntry<T> {
  refetch: () => void
}

/**
 * A server view, fetched on first use and refetched on every `invalidate` of its topic.
 * `params` select a variant of the view, e.g. `{ address }` for a system from the history.
 */
export function useView<K extends Topic>(topic: K, params?: ViewParams): ViewResult<ViewMap[K]> {
  const store = useStore()
  const path = viewPath(topic, params)
  useEffect(() => store.retain(topic, path), [store, topic, path])
  const entry = useSyncExternalStore(store.subscribe, () => store.getEntry(path)) as ViewEntry<ViewMap[K]>
  const refetch = useCallback(() => store.refresh(path), [store, path])
  return { ...entry, refetch }
}

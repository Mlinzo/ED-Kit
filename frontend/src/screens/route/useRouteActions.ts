import { useCallback, useMemo, useState } from 'react'
import { useStore } from '../../api/hooks'
import type { RouteRequest } from '../../api/types'

/** Route writes (plan, clear, skip); the view refetches itself afterwards. */
export function useRouteActions() {
  const store = useStore()
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      setError(null)
      try {
        await write()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        store.invalidate(['route'])
      }
    },
    [store],
  )

  return useMemo(
    () => ({
      error,
      plan: (req: RouteRequest) => run(() => store.transport.send('POST', '/api/route', req)),
      clear: () => run(() => store.transport.send('DELETE', '/api/route')),
      skip: (seq: number, skipped: boolean) =>
        run(() => store.transport.send('PUT', `/api/route/stops/${seq}`, { skipped })),
      /** Put a stop at `position` (1-based); the route is renumbered. */
      move: (seq: number, position: number) =>
        run(() => store.transport.send('PUT', `/api/route/stops/${seq}`, { position })),
      /** Make a stop the next target: back in the route (unskipped) at the next one's place. */
      makeNext: (seq: number, position: number) =>
        run(() => store.transport.send('PUT', `/api/route/stops/${seq}`, { skipped: false, position })),
      remove: (seq: number) => run(() => store.transport.send('DELETE', `/api/route/stops/${seq}`)),
      /** Spansh neutron route from here to the next stop (planned in the background). */
      planNeutron: () => run(() => store.transport.send('POST', '/api/route/neutron', {})),
      clearNeutron: () => run(() => store.transport.send('DELETE', '/api/route/neutron')),
    }),
    [error, run, store],
  )
}

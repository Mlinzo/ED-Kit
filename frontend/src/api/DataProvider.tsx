import { useEffect, type ReactNode } from 'react'
import { StoreContext } from './context'
import type { Store } from './store'

/** Owns the store lifecycle: opens the event stream on mount, closes it on unmount. */
export function DataProvider({ store, children }: { store: Store; children: ReactNode }) {
  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

import { useEffect, useState } from 'react'
import { useStore } from '../api/hooks'
import type { NetworkInfo } from '../api/types'

/** GET /api/network, asked on mount (the PC's address may change between visits); null until known. */
export function useNetwork(): NetworkInfo | null {
  const store = useStore()
  const [info, setInfo] = useState<NetworkInfo | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    store.transport
      .fetchJson<NetworkInfo>('/api/network', abort.signal)
      .then(setInfo)
      .catch(() => {})
    return () => abort.abort()
  }, [store])

  return info
}

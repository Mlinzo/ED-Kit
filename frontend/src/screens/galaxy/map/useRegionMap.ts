// The codex region grid, fetched and decoded once per page (it is the game's, it never changes).
// null until it arrives, and for good when the server cannot send it (the map just has no regions).

import { useEffect, useState } from 'react'
import { useStore } from '../../../api/hooks'
import type { Transport } from '../../../api/transport'
import { decodeRegions, regionLabels, type RegionGrid, type RegionLabel, type RegionMapData } from './regions'

export interface RegionMap {
  grid: RegionGrid
  labels: RegionLabel[]
}

let loading: Promise<RegionMap> | null = null

function load(transport: Transport): Promise<RegionMap> {
  loading ??= transport.fetchJson<RegionMapData>('/api/regions').then((data) => {
    const grid = decodeRegions(data)
    return { grid, labels: regionLabels(grid) }
  })
  return loading
}

export function useRegionMap(): RegionMap | null {
  const store = useStore()
  const [map, setMap] = useState<RegionMap | null>(null)
  useEffect(() => {
    let alive = true
    load(store.transport).then(
      (m) => alive && setMap(m),
      () => {
        loading = null // try again next time the map opens
      },
    )
    return () => {
      alive = false
    }
  }, [store])
  return map
}

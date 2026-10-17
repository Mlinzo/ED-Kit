// Entry point of the 3D system map. Keeps three.js out of the main bundle: the canvas is a
// React.lazy chunk, loaded when the map is first shown.

import { Orbit } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { t } from '../i18n'
import { MapErrorBoundary, MapLoading, MapUnavailable } from './shell'
import { hasWebGL } from './webgl'
import type { SystemMapProps } from './SystemMapCanvas'

const SystemMapCanvas = lazy(() => import('./SystemMapCanvas'))

/** 3D orrery of the current system. Falls back to a message (and the list) without WebGL. */
export function SystemMap({ onShowList, className = '', ...props }: SystemMapProps & { onShowList: () => void }) {
  const fallback = <MapUnavailable className={className} icon={Orbit} hint={t.map.unavailableHint} onShowList={onShowList} />
  if (!hasWebGL()) return fallback
  return (
    <MapErrorBoundary name="System map" fallback={fallback}>
      <Suspense fallback={<MapLoading className={className} />}>
        <SystemMapCanvas className={className} {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}

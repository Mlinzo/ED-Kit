// Entry point of the galaxy map: the canvas is a React.lazy chunk (three.js stays out of the main
// bundle); without WebGL the history lists the same systems.

import { Galaxy } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { t } from '../../../i18n'
import { MapErrorBoundary, MapLoading, MapUnavailable } from '../../../map/shell'
import { hasWebGL } from '../../../map/webgl'
import type { GalaxyMapProps } from './GalaxyMapCanvas'

const GalaxyMapCanvas = lazy(() => import('./GalaxyMapCanvas'))

export function GalaxyMap({ onShowList, className = '', ...props }: GalaxyMapProps & { onShowList: () => void }) {
  const fallback = <MapUnavailable className={className} icon={Galaxy} hint={t.galaxy.map.unavailableHint} onShowList={onShowList} />
  if (!hasWebGL()) return fallback
  return (
    <MapErrorBoundary name="Galaxy map" fallback={fallback}>
      <Suspense fallback={<MapLoading className={className} />}>
        <GalaxyMapCanvas className={className} {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}

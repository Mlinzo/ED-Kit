// Entry point of the 3D route map: the canvas is a React.lazy chunk (three.js stays out of the
// main bundle), with the list as the fallback without WebGL.

import { Route } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { ru } from '../../../i18n/ru'
import { MapErrorBoundary, MapLoading, MapUnavailable } from '../../../map/shell'
import { hasWebGL } from '../../../map/webgl'
import type { RouteMapProps } from './RouteMapCanvas'

const RouteMapCanvas = lazy(() => import('./RouteMapCanvas'))

export function RouteMap({ onShowList, className = '', ...props }: RouteMapProps & { onShowList: () => void }) {
  const fallback = <MapUnavailable className={className} icon={Route} hint={ru.route.map.unavailableHint} onShowList={onShowList} />
  if (!hasWebGL()) return fallback
  return (
    <MapErrorBoundary name="Route map" fallback={fallback}>
      <Suspense fallback={<MapLoading className={className} />}>
        <RouteMapCanvas className={className} {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}

// Entry point of the planet globe: three.js stays out of the main bundle, the canvas is a
// React.lazy chunk loaded when the globe is first shown.

import { Globe, LoaderCircle } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { t } from '../../../i18n'
import { MapErrorBoundary, MapFrame } from '../../../map/shell'
import { hasWebGL } from '../../../map/webgl'
import type { GlobeCanvasProps } from './GlobeCanvas'

const GlobeCanvas = lazy(() => import('./GlobeCanvas'))

function GlobeLoading({ className }: { className: string }) {
  return (
    <MapFrame className={className}>
      <LoaderCircle className="size-5 text-zinc-500 motion-safe:animate-spin" aria-hidden />
      <p className="text-sm text-zinc-500">{t.globe.loading}</p>
    </MapFrame>
  )
}

function GlobeUnavailable({ className }: { className: string }) {
  return (
    <MapFrame className={className}>
      <Globe className="size-10 text-zinc-600" aria-hidden />
      <p className="text-lg font-medium text-zinc-300">{t.globe.unavailable}</p>
      <p className="max-w-sm text-sm text-zinc-500">{t.globe.unavailableHint}</p>
    </MapFrame>
  )
}

/** The 3D globe of a planet; a message instead without WebGL. */
export function GlobeMap({ className = '', ...props }: GlobeCanvasProps) {
  const fallback = <GlobeUnavailable className={className} />
  if (!hasWebGL()) return fallback
  return (
    <MapErrorBoundary name="Planet globe" fallback={fallback}>
      <Suspense fallback={<GlobeLoading className={className} />}>
        <GlobeCanvas className={className} {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}

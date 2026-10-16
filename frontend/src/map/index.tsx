// Entry point of the 3D system map. Keeps three.js out of the main bundle: the canvas is a
// React.lazy chunk, loaded when the map is first shown.

import { LoaderCircle, Orbit } from 'lucide-react'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { ru } from '../i18n/ru'
import type { SystemMapProps } from './SystemMapCanvas'

const SystemMapCanvas = lazy(() => import('./SystemMapCanvas'))

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    // Release the probe context right away: browsers cap the number of live WebGL contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return Boolean(gl)
  } catch {
    return false
  }
}

let webglSupport: boolean | null = null

function MapFrame({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl bg-zinc-950 px-6 text-center ring-1 ring-zinc-800/80 ${className}`}
    >
      {children}
    </div>
  )
}

function Unavailable({ className, onShowList }: { className: string; onShowList: () => void }) {
  return (
    <MapFrame className={className}>
      <Orbit className="size-10 text-zinc-600" aria-hidden />
      <p className="text-lg font-medium text-zinc-300">{ru.map.unavailable}</p>
      <p className="max-w-sm text-sm text-zinc-500">{ru.map.unavailableHint}</p>
      <button
        type="button"
        onClick={onShowList}
        className="focus-ring mt-2 inline-flex h-11 items-center rounded-lg bg-zinc-800 px-5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        {ru.map.showList}
      </button>
    </MapFrame>
  )
}

class MapErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('System map failed', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** 3D orrery of the current system. Falls back to a message (and the list) without WebGL. */
export function SystemMap({ onShowList, className = '', ...props }: SystemMapProps & { onShowList: () => void }) {
  webglSupport ??= hasWebGL()
  const fallback = <Unavailable className={className} onShowList={onShowList} />
  if (!webglSupport) return fallback
  return (
    <MapErrorBoundary fallback={fallback}>
      <Suspense
        fallback={
          <MapFrame className={className}>
            <LoaderCircle className="size-5 text-zinc-500 motion-safe:animate-spin" aria-hidden />
            <p className="text-sm text-zinc-500">{ru.map.loading}</p>
          </MapFrame>
        }
      >
        <SystemMapCanvas className={className} {...props} />
      </Suspense>
    </MapErrorBoundary>
  )
}

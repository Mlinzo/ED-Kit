// What every 3D map shows around its lazy canvas: the loading and "unavailable" frames, and an
// error boundary that falls back to the list (the WebGL check is in webgl.ts).

import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { t } from '../i18n'

export function MapFrame({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl bg-zinc-950 px-6 text-center ring-1 ring-zinc-800/80 ${className}`}
    >
      {children}
    </div>
  )
}

export function MapLoading({ className }: { className: string }) {
  return (
    <MapFrame className={className}>
      <LoaderCircle className="size-5 text-zinc-500 motion-safe:animate-spin" aria-hidden />
      <p className="text-sm text-zinc-500">{t.map.loading}</p>
    </MapFrame>
  )
}

export function MapUnavailable({
  className,
  icon: Icon,
  hint,
  onShowList,
}: {
  className: string
  icon: LucideIcon
  hint: string
  onShowList: () => void
}) {
  return (
    <MapFrame className={className}>
      <Icon className="size-10 text-zinc-600" aria-hidden />
      <p className="text-lg font-medium text-zinc-300">{t.map.unavailable}</p>
      <p className="max-w-sm text-sm text-zinc-500">{hint}</p>
      <button
        type="button"
        onClick={onShowList}
        className="focus-ring mt-2 inline-flex h-11 items-center rounded-lg bg-zinc-800 px-5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        {t.map.showList}
      </button>
    </MapFrame>
  )
}

export class MapErrorBoundary extends Component<{ name: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.name} failed`, error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

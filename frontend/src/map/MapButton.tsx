// A round button over a 3D map (fit, top view, focus).
import type { ReactNode } from 'react'

export function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring pointer-events-auto flex size-10 items-center justify-center rounded-xl bg-zinc-950/60 text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm transition-colors ring-inset hover:bg-zinc-900/80 hover:text-zinc-50 lg:size-9"
    >
      {children}
    </button>
  )
}

// A round button over a 3D map (fit, top view, focus; with `pressed`, a layer switch).
import type { ReactNode } from 'react'

export function MapButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`focus-ring pointer-events-auto flex size-10 items-center justify-center rounded-xl ring-1 backdrop-blur-sm transition-colors ring-inset hover:bg-zinc-900/80 hover:text-zinc-50 lg:size-9 ${
        pressed ? 'bg-zinc-800/80 text-accent ring-white/20' : 'bg-zinc-950/60 text-zinc-300 ring-white/10'
      }`}
    >
      {children}
    </button>
  )
}

import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'

/**
 * Full-screen sheet for phones. Rendered in a portal; the app behind it is made inert,
 * so focus stays inside. Esc or the back button closes it and focus returns.
 */
export function Sheet({
  title,
  labelledBy,
  onClose,
  children,
}: {
  title: string
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) {
  const backRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const app = document.getElementById('root')
    if (app) app.inert = true
    backRef.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      if (app) app.inert = false
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-40 flex flex-col bg-zinc-950 motion-safe:animate-[sheet-in_180ms_ease-out]"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800/80 px-2 pt-[env(safe-area-inset-top)]">
        <button
          ref={backRef}
          type="button"
          onClick={onClose}
          className="focus-ring flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 active:bg-zinc-900"
        >
          <ArrowLeft className="size-5" aria-hidden />
          {t.common.back}
        </button>
        <span className="truncate text-sm text-zinc-500">{title}</span>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        {children}
      </div>
    </div>,
    document.body,
  )
}

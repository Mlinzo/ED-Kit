import { LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStream } from '../api/hooks'
import { ru } from '../i18n/ru'

export function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-zinc-500" role="status">
      <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden />
      {ru.common.loading}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      {icon && <div className="text-zinc-600">{icon}</div>}
      <p className="text-lg font-medium text-zinc-300">{title}</p>
      {hint && <p className="max-w-sm text-sm text-zinc-500">{hint}</p>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center" role="alert">
      <TriangleAlert className="size-8 text-rose-400" aria-hidden />
      <p className="text-lg font-medium text-zinc-200">{ru.common.error}</p>
      <p className="font-mono text-xs text-zinc-500">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring mt-2 inline-flex h-11 items-center rounded-lg bg-zinc-800 px-5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        {ru.common.retry}
      </button>
    </div>
  )
}

/** What a screen shows before its view has data: spinner, error, or nothing while offline. */
export function ViewFallback({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const { connection } = useStream()
  if (connection === 'offline') return null // the offline banner already explains it
  return error ? <ErrorState error={error} onRetry={onRetry} /> : <Loading />
}

/** Small uppercase section label. */
export function Label({
  children,
  className = '',
  as: Tag = 'div',
  id,
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'h2' | 'h3' | 'span'
  id?: string
}) {
  return (
    <Tag id={id} className={`text-xs font-medium tracking-wide text-zinc-500 uppercase ${className}`}>
      {children}
    </Tag>
  )
}

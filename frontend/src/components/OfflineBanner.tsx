import { FlaskConical, WifiOff } from 'lucide-react'
import { useStream } from '../api/hooks'
import { ru } from '../i18n/ru'

function mockHref(): string {
  const url = new URL(window.location.href)
  url.searchParams.set('mock', '1')
  return url.pathname + url.search + url.hash
}

/** Shown when the backend cannot be reached; offers the demo mode. */
export function OfflineBanner() {
  const { connection, mock } = useStream()
  if (mock || connection !== 'offline') return null
  return (
    <div
      role="alert"
      className="mb-6 flex flex-col gap-4 rounded-2xl border border-rose-500/25 bg-rose-500/[0.07] p-5 sm:flex-row sm:items-center"
    >
      <WifiOff className="size-7 shrink-0 text-rose-400" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-rose-100">{ru.offline.title}</p>
        <p className="text-sm text-zinc-400">
          {ru.offline.hint} <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-300">{ru.offline.command}</code>
        </p>
        <p className="text-xs text-zinc-500">{ru.offline.retrying}</p>
      </div>
      <a
        href={mockHref()}
        className="focus-ring inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-800 px-4 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
      >
        <FlaskConical className="size-4 text-accent" aria-hidden />
        {ru.offline.demo}
      </a>
    </div>
  )
}

import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { copyText } from '../lib/clipboard'

const CONFIRM_MS = 1_500

/** Copies a system name (to paste into the galaxy map search); confirms with a check mark. */
export function CopyButton({ text, label = false, className = '' }: { text: string; label?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const Icon = copied ? Check : Copy
  return (
    <button
      type="button"
      onClick={async () => setCopied(await copyText(text))}
      title={`${t.route.copy} — ${t.route.copyHint}`}
      aria-label={`${t.route.copy}: ${text}`}
      className={`focus-ring inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg transition-colors ${
        label
          ? 'h-9 px-3 text-sm font-medium ring-1 ring-inset ' +
            (copied ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' : 'bg-zinc-800 text-zinc-100 ring-zinc-700 hover:bg-zinc-700')
          : 'size-7 ' + (copied ? 'text-emerald-300' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200')
      } ${className}`}
    >
      <Icon className="size-4" aria-hidden />
      {label && (copied ? t.route.copied : t.route.copy)}
      <span className="sr-only" role="status">
        {copied ? t.route.copied : ''}
      </span>
    </button>
  )
}

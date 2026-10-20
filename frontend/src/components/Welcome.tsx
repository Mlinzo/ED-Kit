import { BookOpen, Smartphone, Telescope } from 'lucide-react'
import { useState } from 'react'
import { useGuide } from '../guide/context'
import { t } from '../i18n'
import { readStored, writeStored } from '../lib/storage'
import { useSettings } from '../settings/context'
import { useNetwork } from '../settings/useNetwork'

/** Closed once, closed for good (per browser). */
const KEY = 'edk.welcome'

/**
 * First visit: what the app does with your data, the guide's five steps for a newcomer and, on the
 * PC, the way to the phone (the QR code in the settings). Shown on the System tab until closed.
 */
export function Welcome() {
  const [open, setOpen] = useState(() => readStored(KEY, ['open', 'closed'], 'open') === 'open')
  const guide = useGuide()
  const settings = useSettings()
  const network = useNetwork()
  if (!open) return null
  const phone = network?.thisPc && network.urls.length > 0

  const close = () => {
    writeStored(KEY, 'closed')
    setOpen(false)
  }

  return (
    <section
      aria-labelledby="welcome-title"
      className="mb-5 flex gap-4 rounded-2xl bg-sky-500/[0.07] p-5 ring-1 ring-sky-500/25 ring-inset"
    >
      <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-accent sm:grid">
        <Telescope className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 id="welcome-title" className="text-base font-semibold text-zinc-50">
          {t.welcome.title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-300">{t.welcome.text}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => guide.open()}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400"
          >
            <BookOpen className="size-4" aria-hidden />
            {t.welcome.guide}
          </button>
          {phone && (
            <button
              type="button"
              onClick={() => settings.open('phone')}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-800 px-4 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-700"
            >
              <Smartphone className="size-4" aria-hidden />
              {t.welcome.phone}
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="focus-ring h-10 rounded-lg px-4 text-sm font-medium text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-50"
          >
            {t.welcome.close}
          </button>
        </div>
      </div>
    </section>
  )
}

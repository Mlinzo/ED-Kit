import { Smartphone } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { NetworkInfo } from '../api/types'
import { QrCode } from '../components/QrCode'
import { t } from '../i18n'

/**
 * Opening the app on a phone, in the settings on the PC: a QR code and the address on this PC's
 * network, and what to check when the phone does not get through (the same Wi-Fi, the Windows
 * firewall, a network marked public).
 */
export function PhoneAccess({ network, autoFocus }: { network: NetworkInfo; autoFocus: boolean }) {
  const s = t.settings.phone
  const titleId = useId()
  const section = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    section.current?.scrollIntoView({ block: 'nearest' })
    section.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const [main, ...others] = network.urls
  return (
    <section ref={section} tabIndex={-1} aria-labelledby={titleId} className="mt-7 border-t border-zinc-800 pt-5 outline-none">
      <h3 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Smartphone className="size-4 text-zinc-400" aria-hidden />
        {s.title}
      </h3>
      {!network.lan ? (
        <p className="mt-1 text-xs text-zinc-500">{s.local}</p>
      ) : !main ? (
        <p className="mt-1 text-xs text-amber-300">{s.noNetwork}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <QrCode text={main} label={s.qr(main)} className="size-40 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-xs text-zinc-500">{s.hint}</p>
              <p className="mt-2 font-mono text-base break-all text-zinc-100 select-all">{main}</p>
              {others.length > 0 && (
                <p className="mt-2 text-xs text-zinc-500">
                  {s.otherAddresses}: <span className="font-mono break-all text-zinc-400">{others.join(', ')}</span>
                </p>
              )}
            </div>
          </div>
          <details className="mt-2 text-xs text-zinc-400">
            <summary className="focus-ring -mx-2 cursor-pointer rounded-lg px-2 py-2.5 text-sm text-accent marker:text-zinc-500 hover:bg-zinc-800/60">
              {s.troubleTitle}
            </summary>
            <ul className="mt-1 list-disc space-y-1.5 pl-4">
              {s.trouble.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
          <p className="mt-2 text-xs text-zinc-500">{s.open}</p>
        </>
      )}
    </section>
  )
}

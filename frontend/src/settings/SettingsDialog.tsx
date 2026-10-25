import { Heart, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SUPPORT_URL } from '../components/SupportLink'
import { lang, LANGS, setLang, t } from '../i18n'
import { SettingsContext, useSettings, type SettingsFocus } from './context'
import { DataFolder } from './DataFolder'
import { JournalFolder } from './JournalFolder'
import { PhoneAccess } from './PhoneAccess'
import { useNetwork } from './useNetwork'

/** Lets the gear and the journal strip open the settings; the dialog renders only while open. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<{ focus: SettingsFocus | null } | null>(null)
  const api = useMemo(() => ({ open: (focus?: SettingsFocus) => setOpened({ focus: focus ?? null }) }), [])
  const close = useCallback(() => setOpened(null), [])
  return (
    <SettingsContext.Provider value={api}>
      {children}
      {opened && createPortal(<SettingsDialog focus={opened.focus} onClose={close} />, document.body)}
    </SettingsContext.Provider>
  )
}

/** Gear button for the top bar. */
export function SettingsButton() {
  const { open } = useSettings()
  return (
    <button
      type="button"
      onClick={() => open()}
      title={t.settings.open}
      aria-haspopup="dialog"
      className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
    >
      <Settings2 className="size-5" aria-hidden />
      <span className="sr-only">{t.settings.open}</span>
    </button>
  )
}

function SettingsDialog({ focus, onClose }: { focus: SettingsFocus | null; onClose: () => void }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const network = useNetwork()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    // The journal and data folders focus their own field.
    if (focus === null) panel.current?.focus()
  }, [focus])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-zinc-50">
            {t.settings.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring -m-1 rounded-md p-1 text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-5" aria-hidden />
            <span className="sr-only">{t.settings.close}</span>
          </button>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-zinc-200">{t.settings.language}</legend>
          <p className="mt-1 text-xs text-zinc-500">{t.settings.languageHint}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                lang={l.id}
                aria-pressed={l.id === lang}
                onClick={() => setLang(l.id)}
                className={`focus-ring h-9 rounded-lg px-3 text-sm font-medium ring-1 ring-inset ${
                  l.id === lang ? 'bg-sky-500/15 text-sky-200 ring-sky-400/50' : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:ring-zinc-600'
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </fieldset>

        {/* On the phone itself there is nothing to open. */}
        {network?.thisPc && <PhoneAccess network={network} autoFocus={focus === 'phone'} />}

        {/* null until /api/network answers: the phone section above then grows, and the folders
            scroll to their field again. */}
        <JournalFolder autoFocus={focus === 'journal'} thisPc={network ? network.thisPc : null} />
        <DataFolder autoFocus={focus === 'data'} thisPc={network ? network.thisPc : null} />

        {SUPPORT_URL && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-5">
            <p className="min-w-0 flex-1 basis-48 text-sm text-zinc-400">{t.settings.support}</p>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-rose-400 px-4 text-sm font-semibold text-zinc-950 hover:bg-rose-300"
            >
              <Heart className="size-4" aria-hidden />
              {t.settings.supportButton}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

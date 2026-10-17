import { Settings2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { lang, LANGS, setLang, t } from '../i18n'
import { BIO_PRESETS, DSS_PRESETS } from './strings'
import { ThresholdField } from './ThresholdField'
import { DEFAULT_HIGHLIGHT, useHighlightSettings } from './useHighlightSettings'

/** Gear button for the top bar; opens the highlight settings dialog. */
export function SettingsButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.settings.open}
        aria-haspopup="dialog"
        className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
      >
        <Settings2 className="size-5" aria-hidden />
        <span className="sr-only">{t.settings.open}</span>
      </button>
      {/* Portal: the sticky top bar would otherwise contain (and clip) the fixed overlay. */}
      {open && createPortal(<SettingsDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, saving, error, save } = useHighlightSettings()
  const current = settings ?? DEFAULT_HIGHLIGHT
  const [dss, setDss] = useState<number | null>(null)
  const [bio, setBio] = useState<number | null>(null)
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dssValue = dss ?? current.dssMin
  const bioValue = bio ?? current.bioMin
  const dirty = dssValue !== current.dssMin || bioValue !== current.bioMin

  const submit = async () => {
    if (await save({ dssMin: dssValue, bioMin: bioValue })) onClose()
  }

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

        <h3 className="mt-7 border-t border-zinc-800 pt-5 text-sm font-semibold text-zinc-100">{t.settings.highlight}</h3>
        <p className="mt-1 text-sm text-zinc-400">{t.settings.intro}</p>

        {/* The fields read their custom input from the value once: remount them when the saved
            settings arrive (the dialog opens with the defaults while they load). */}
        <ThresholdField
          key={settings ? 'dss' : 'dss-loading'}
          label={t.settings.dss}
          hint={t.settings.dssHint}
          presets={DSS_PRESETS}
          value={dssValue}
          onChange={setDss}
          disabled={!settings}
        />
        <ThresholdField
          key={settings ? 'bio' : 'bio-loading'}
          label={t.settings.bio}
          hint={t.settings.bioHint}
          presets={BIO_PRESETS}
          value={bioValue}
          onChange={setBio}
          disabled={!settings}
        />

        {error && (
          <p className="mt-4 text-sm text-rose-300" role="alert">
            {t.settings.error}: {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-10 rounded-lg px-4 text-sm font-medium text-zinc-300 hover:bg-zinc-800/70"
          >
            {t.settings.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!dirty || saving || !settings}
            className="focus-ring h-10 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? t.settings.saving : t.settings.save}
          </button>
        </div>
      </div>
    </div>
  )
}

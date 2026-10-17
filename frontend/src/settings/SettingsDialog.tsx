import { Settings2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BIO_PRESETS, DSS_PRESETS, settingsRu as t } from './strings'
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
        title={t.open}
        aria-haspopup="dialog"
        className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
      >
        <Settings2 className="size-5" aria-hidden />
        <span className="sr-only">{t.open}</span>
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
            {t.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring -m-1 rounded-md p-1 text-zinc-500 hover:text-zinc-200"
          >
            <X className="size-5" aria-hidden />
            <span className="sr-only">{t.close}</span>
          </button>
        </div>
        <p className="mt-2 text-sm text-zinc-400">{t.intro}</p>

        {/* The fields read their custom input from the value once: remount them when the saved
            settings arrive (the dialog opens with the defaults while they load). */}
        <ThresholdField
          key={settings ? 'dss' : 'dss-loading'}
          label={t.dss}
          hint={t.dssHint}
          presets={DSS_PRESETS}
          value={dssValue}
          onChange={setDss}
          disabled={!settings}
        />
        <ThresholdField
          key={settings ? 'bio' : 'bio-loading'}
          label={t.bio}
          hint={t.bioHint}
          presets={BIO_PRESETS}
          value={bioValue}
          onChange={setBio}
          disabled={!settings}
        />

        {error && (
          <p className="mt-4 text-sm text-rose-300" role="alert">
            {t.error}: {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-10 rounded-lg px-4 text-sm font-medium text-zinc-300 hover:bg-zinc-800/70"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!dirty || saving || !settings}
            className="focus-ring h-10 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>
    </div>
  )
}

import { Highlighter, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { HighlightSettings } from '../api/types'
import { t } from '../i18n'
import { shortCredits } from './credits'
import { BIO_PRESETS, DSS_PRESETS } from './strings'
import { ThresholdField } from './ThresholdField'
import { DEFAULT_HIGHLIGHT, useHighlightSettings } from './useHighlightSettings'

/** Saved this long after the last change: typing a custom value is one save. */
const SAVE_DELAY_MS = 400

const threshold = (value: number) => (value === 0 ? t.settings.off : `≥${shortCredits(value)}`)

/**
 * The highlight thresholds, next to the bodies they highlight: a button with the current values
 * and a panel without a backdrop, so the map and the list change behind it as you choose.
 */
export function HighlightControl() {
  const { settings, error, save } = useHighlightSettings()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<HighlightSettings | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef<{ timer: number; next: HighlightSettings } | null>(null)
  const panelId = useId()
  const titleId = useId()
  const shown = draft ?? settings ?? DEFAULT_HIGHLIGHT

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Leaving the tab before the delay is up still saves.
  useEffect(
    () => () => {
      if (!pending.current) return
      window.clearTimeout(pending.current.timer)
      void save(pending.current.next)
    },
    [save],
  )

  const change = (next: HighlightSettings) => {
    setDraft(next)
    if (pending.current) window.clearTimeout(pending.current.timer)
    const timer = window.setTimeout(() => {
      pending.current = null
      void save(next).then(() => {
        if (!pending.current) setDraft(null)
      })
    }, SAVE_DELAY_MS)
    pending.current = { timer, next }
  }

  const summary = `${t.system.dss} ${threshold(shown.dssMin)} · ${t.system.bio} ${threshold(shown.bioMin)}`

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t.settings.highlightOpen}: ${summary}`}
        title={t.settings.highlightOpen}
        className={`focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm ring-1 ring-inset ${
          open ? 'bg-sky-500/15 text-sky-200 ring-sky-400/50' : 'bg-zinc-900/60 text-zinc-300 ring-zinc-800 hover:ring-zinc-600'
        }`}
      >
        <Highlighter className="size-4 shrink-0" aria-hidden />
        <span className="hidden whitespace-nowrap tabular-nums sm:inline">{summary}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className="absolute top-full right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl shadow-black/60 backdrop-blur"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 id={titleId} className="text-sm font-semibold text-zinc-100">
              {t.settings.highlight}
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="focus-ring -m-1.5 inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">{t.settings.close}</span>
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-400">{t.settings.intro}</p>
          {/* The fields read their custom input from the value once: remount them when the saved
              settings arrive (the panel can open with the defaults while they load). */}
          <ThresholdField
            key={settings ? 'dss' : 'dss-loading'}
            label={t.settings.dss}
            hint={t.settings.dssHint}
            presets={DSS_PRESETS}
            value={shown.dssMin}
            onChange={(dssMin) => change({ ...shown, dssMin })}
            disabled={!settings}
          />
          <ThresholdField
            key={settings ? 'bio' : 'bio-loading'}
            label={t.settings.bio}
            hint={t.settings.bioHint}
            presets={BIO_PRESETS}
            value={shown.bioMin}
            onChange={(bioMin) => change({ ...shown, bioMin })}
            disabled={!settings}
          />
          {error && (
            <p className="mt-4 text-sm text-rose-300" role="alert">
              {t.settings.error}: {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

import { Settings2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { exactCredits } from '../lib/format'
import { shortCredits } from './credits'
import { BIO_PRESETS, DSS_PRESETS, settingsRu as t } from './strings'
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

        <ThresholdField
          label={t.dss}
          hint={t.dssHint}
          presets={DSS_PRESETS}
          value={dssValue}
          onChange={setDss}
          disabled={!settings}
        />
        <ThresholdField
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

type Unit = 1_000 | 1_000_000

/** Initial custom input for a value that is not one of the presets. */
function splitValue(value: number): { amount: string; unit: Unit } {
  if (value >= 1_000_000) return { amount: String(Number((value / 1_000_000).toFixed(3))), unit: 1_000_000 }
  return { amount: String(Number((value / 1_000).toFixed(3))), unit: 1_000 }
}

function ThresholdField({
  label,
  hint,
  presets,
  value,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  presets: readonly number[]
  value: number
  onChange: (value: number) => void
  disabled: boolean
}) {
  const initial = presets.includes(value) ? { amount: '', unit: 1_000_000 as Unit } : splitValue(value)
  const [amount, setAmount] = useState(initial.amount)
  const [unit, setUnit] = useState<Unit>(initial.unit)
  const inputId = useId()

  const apply = (nextAmount: string, nextUnit: Unit) => {
    const n = Number.parseFloat(nextAmount.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * nextUnit))
  }

  return (
    <fieldset className="mt-6" disabled={disabled}>
      <legend className="text-sm font-medium text-zinc-200">{label}</legend>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = value === p && !amount
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setAmount('')
                onChange(p)
              }}
              className={`focus-ring h-9 min-w-14 rounded-lg px-3 text-sm font-medium tabular-nums ring-1 ring-inset ${
                active
                  ? 'bg-sky-500/15 text-sky-200 ring-sky-400/50'
                  : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:ring-zinc-600'
              }`}
              title={exactCredits(p)}
            >
              {p === 0 ? t.off : shortCredits(p)}
            </button>
          )
        })}
      </div>
      <label htmlFor={inputId} className="mt-3 block text-xs text-zinc-500">
        {t.custom}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={amount}
          placeholder="0"
          onChange={(e) => {
            setAmount(e.target.value)
            apply(e.target.value, unit)
          }}
          className="focus-ring h-9 w-32 rounded-lg bg-zinc-900 px-3 text-sm tabular-nums text-zinc-100 ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-600 focus:ring-sky-500/50"
        />
        <div role="radiogroup" aria-label={t.unit} className="inline-flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800">
          {([1_000, 1_000_000] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => {
                setUnit(u)
                if (amount) apply(amount, u)
              }}
              className={`focus-ring h-8 rounded-md px-3 text-sm font-medium ${
                unit === u ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {u === 1_000 ? t.thousands : t.millions}
            </button>
          ))}
        </div>
        {amount && <span className="text-xs text-zinc-400 tabular-nums">= {exactCredits(value)}</span>}
      </div>
    </fieldset>
  )
}

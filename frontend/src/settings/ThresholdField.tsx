import { useId, useState } from 'react'
import { exactCredits } from '../lib/format'
import { shortCredits } from './credits'
import { settingsRu as t } from './strings'

type Unit = 1_000 | 1_000_000

/** Initial custom input for a value that is not one of the presets. */
function splitValue(value: number): { amount: string; unit: Unit } {
  if (value >= 1_000_000) return { amount: String(Number((value / 1_000_000).toFixed(3))), unit: 1_000_000 }
  return { amount: String(Number((value / 1_000).toFixed(3))), unit: 1_000 }
}

/** A credits threshold: preset buttons plus a custom amount in thousands or millions. */
export function ThresholdField({
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

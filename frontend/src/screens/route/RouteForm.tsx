// Route parameters: mode, start / destination, reach, what counts (mapping kinds and biology),
// minimum values.
import { BookOpen, Coins, LoaderCircle, MoveRight, Orbit, Route } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { BodyKind, RouteGoal, RouteMode, RouteRequest } from '../../api/types'
import { t } from '../../i18n'
import { ThresholdField } from '../../settings/ThresholdField'
import { KindChip } from './kinds'

const RADII = [100, 200, 300, 500, 1000] as const
const SYSTEM_COUNTS = [50, 100, 200, 300, 500, 700] as const
const LINE_SYSTEM_COUNTS = [10, 20, 30, 50, 100, 200] as const
const DEVIATIONS = [10, 15, 20, 25, 30, 40, 50] as const
const VALUE_PRESETS = [0, 300_000, 500_000, 750_000, 1_000_000] as const
const BIO_VALUE_PRESETS = [0, 3_000_000, 5_000_000, 10_000_000, 20_000_000] as const
const SYSTEM_VALUE_PRESETS = [0, 2_000_000, 5_000_000, 10_000_000, 20_000_000] as const
const KINDS: readonly BodyKind[] = ['elw', 'tww', 'thmc', 'ww', 'aw', 'trocky', 'bio']

const DEFAULT_ROUTE: RouteRequest = {
  mode: 'riches',
  goal: 'credits',
  source: '',
  destination: null,
  radiusLy: 200,
  deviationLy: 25,
  maxSystems: 100,
  bodyTypes: ['elw', 'tww', 'thmc', 'bio'],
  minValue: 300_000,
  minSystemValue: 0,
  bioMinValue: 5_000_000,
  bioRequireGenuses: false,
  includePopulated: true,
  skipMapped: true,
  refresh: false,
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-zinc-200">{label}</legend>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </fieldset>
  )
}

function Choice<T extends string | number>({
  value,
  options,
  format,
  onChange,
}: {
  value: T
  options: readonly T[]
  format: (v: T) => string
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o === value
        return (
          <button
            key={o}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o)}
            className={`focus-ring h-9 min-w-14 rounded-lg px-3 text-sm font-medium tabular-nums ring-1 ring-inset ${
              active ? 'bg-sky-500/15 text-sky-200 ring-sky-400/50' : 'bg-zinc-900 text-zinc-300 ring-zinc-800 hover:ring-zinc-600'
            }`}
          >
            {format(o)}
          </button>
        )
      })}
    </div>
  )
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring mt-0.5 size-4 shrink-0 accent-sky-500"
      />
      <label htmlFor={id} className="text-sm text-zinc-300">
        {label}
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </label>
    </div>
  )
}

function Toggle<T extends string>({
  value,
  options,
  label,
  names,
  onChange,
}: {
  value: T
  options: readonly { id: T; icon: typeof Orbit }[]
  label: string
  names: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800">
      {options.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`focus-ring flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors ${
            value === id ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Icon className="size-4" aria-hidden />
          {names[id]}
        </button>
      ))}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      className="focus-ring h-10 w-full rounded-xl bg-zinc-900 px-3 text-sm text-zinc-100 proportional-nums ring-1 ring-zinc-800 placeholder:text-zinc-500 focus:ring-zinc-700"
    />
  )
}

export function RouteForm({
  initial,
  currentSystem,
  building,
  disabled,
  onSubmit,
  onCancel,
}: {
  initial: RouteRequest | null
  currentSystem: string | null
  building: boolean
  disabled: boolean
  onSubmit: (req: RouteRequest) => void
  onCancel?: () => void
}) {
  const [req, setReq] = useState<RouteRequest>(() => ({ ...DEFAULT_ROUTE, ...initial, refresh: false }))
  const set = <K extends keyof RouteRequest>(key: K, value: RouteRequest[K]) => setReq((r) => ({ ...r, [key]: value }))
  const toggleKind = (kind: BodyKind) =>
    set('bodyTypes', req.bodyTypes.includes(kind) ? req.bodyTypes.filter((k) => k !== kind) : [...req.bodyTypes, kind])

  const codex = req.goal === 'codex'
  const bio = codex || req.bodyTypes.includes('bio')
  const carto = !codex && req.bodyTypes.some((k) => k !== 'bio')
  const needsDestination = req.mode === 'line' && !(req.destination ?? '').trim()
  const valid = (codex || req.bodyTypes.length > 0) && !needsDestination
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid && !building && !disabled) onSubmit({ ...req, source: req.source.trim(), destination: req.destination?.trim() || null })
  }

  const modes: { id: RouteMode; icon: typeof Orbit }[] = [
    { id: 'riches', icon: Orbit },
    { id: 'line', icon: MoveRight },
  ]
  const goals: { id: RouteGoal; icon: typeof Orbit }[] = [
    { id: 'credits', icon: Coins },
    { id: 'codex', icon: BookOpen },
  ]

  return (
    <form onSubmit={submit} className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-zinc-800 sm:p-6">
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <Field label={t.route.goal} hint={t.route.goalHint[req.goal]}>
          <Toggle value={req.goal} options={goals} label={t.route.goal} names={t.route.goals} onChange={(v) => set('goal', v)} />
        </Field>
        <Field label={t.route.mode} hint={t.route.modeHint[req.mode]}>
          <Toggle value={req.mode} options={modes} label={t.route.mode} names={t.route.modes} onChange={(v) => set('mode', v)} />
        </Field>
      </div>

      <div className="mt-6 grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <Field label={t.route.source} hint={t.route.sourceHint}>
          <TextInput
            value={req.source}
            onChange={(v) => set('source', v)}
            placeholder={t.route.sourcePlaceholder(currentSystem)}
            label={t.route.source}
          />
        </Field>
        {req.mode === 'line' ? (
          <Field label={t.route.destination}>
            <TextInput
              value={req.destination ?? ''}
              onChange={(v) => set('destination', v)}
              placeholder={t.route.destinationPlaceholder}
              label={t.route.destination}
            />
          </Field>
        ) : (
          <Field label={t.route.radius}>
            <Choice value={req.radiusLy} options={RADII} format={t.route.ly} onChange={(v) => set('radiusLy', v)} />
          </Field>
        )}
        {req.mode === 'line' && (
          <Field label={t.route.deviation}>
            <Choice value={req.deviationLy} options={DEVIATIONS} format={t.route.ly} onChange={(v) => set('deviationLy', v)} />
          </Field>
        )}
        <Field label={t.route.maxSystems} hint={req.mode === 'line' ? t.route.maxSystemsLineHint : undefined}>
          <Choice
            value={req.maxSystems}
            options={req.mode === 'line' ? LINE_SYSTEM_COUNTS : SYSTEM_COUNTS}
            format={String}
            onChange={(v) => set('maxSystems', v)}
          />
        </Field>
        {!codex && (
        <Field label={t.route.bodyTypes} hint={t.route.bodyTypesHint}>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((kind) => {
              const on = req.bodyTypes.includes(kind)
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleKind(kind)}
                  className={`focus-ring inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm proportional-nums ring-1 ring-inset ${
                    on ? 'bg-zinc-800 text-zinc-100 ring-zinc-600' : 'bg-zinc-900 text-zinc-500 ring-zinc-800 hover:text-zinc-300'
                  }`}
                >
                  <KindChip kind={kind} dim={!on} />
                  {t.route.kinds[kind]}
                </button>
              )
            })}
          </div>
        </Field>
        )}
      </div>

      {!codex && (
      <div className="mt-2 grid gap-x-8 lg:grid-cols-3">
        {carto && (
          <ThresholdField
            label={t.route.minValue}
            hint={t.route.minValueHint}
            presets={VALUE_PRESETS}
            value={req.minValue}
            onChange={(v) => set('minValue', v)}
            disabled={false}
          />
        )}
        {bio && (
          <ThresholdField
            label={t.route.bioMinValue}
            hint={t.route.bioMinValueHint}
            presets={BIO_VALUE_PRESETS}
            value={req.bioMinValue}
            onChange={(v) => set('bioMinValue', v)}
            disabled={false}
          />
        )}
        <ThresholdField
          label={t.route.minSystemValue}
          hint={t.route.minSystemValueHint}
          presets={SYSTEM_VALUE_PRESETS}
          value={req.minSystemValue}
          onChange={(v) => set('minSystemValue', v)}
          disabled={false}
        />
      </div>
      )}

      <div className="mt-6 space-y-3">
        {bio && (
          <Check
            checked={req.bioRequireGenuses}
            onChange={(v) => set('bioRequireGenuses', v)}
            label={t.route.bioRequireGenuses}
            hint={t.route.bioRequireGenusesHint}
          />
        )}
        <Check
          checked={!req.includePopulated}
          onChange={(v) => set('includePopulated', !v)}
          label={t.route.onlyUnpopulated}
          hint={t.route.onlyUnpopulatedHint}
        />
        <Check checked={req.skipMapped} onChange={(v) => set('skipMapped', v)} label={t.route.skipMapped} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring h-10 rounded-lg px-4 text-sm font-medium text-zinc-300 hover:bg-zinc-800/70"
          >
            {t.route.cancel}
          </button>
        )}
        <button
          type="submit"
          disabled={!valid || building || disabled}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {building ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          ) : (
            <Route className="size-4" aria-hidden />
          )}
          {building ? t.route.building : t.route.build}
        </button>
      </div>
    </form>
  )
}

// The Shop's engineering goals: what you want engineers to do, several at once, and the
// materials all of it takes against your stock from the journal. A material's name chooses it
// in the Shop (its traders, and planets rich in it). A goal's "now" grade comes from your
// current ship when it has such a module.

import { Check, ChevronDown, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useStore, useView } from '../../api/hooks'
import type { EngineeringCatalogView, EngineeringFittedView, EngineeringGoalView } from '../../api/types'
import { Label } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { t } from '../../i18n'
import { formatRelative } from '../../lib/format'
import { readStored, writeStored } from '../../lib/storage'

const OPEN_KEY = 'edk.shopGoals'

type Draft = Omit<EngineeringGoalView, 'id'>

const field = 'focus-ring h-10 w-full rounded-lg bg-zinc-950/60 px-2 text-sm text-zinc-100 ring-1 ring-zinc-700 ring-inset'
const button = 'focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ring-1 ring-inset sm:h-8'

function topGrade(catalog: EngineeringCatalogView, blueprint: string): number {
  return catalog.blueprints[blueprint]?.grades.length ?? 5
}

/** A draft that fits the catalog: another module resets the blueprint and the effect, grades stay in range. */
function fit(catalog: EngineeringCatalogView, draft: Draft): Draft {
  const kind = catalog.modules.find((k) => k.key === draft.module) ?? catalog.modules[0]
  const blueprint = kind.blueprints.includes(draft.blueprint) ? draft.blueprint : kind.blueprints[0]
  const top = topGrade(catalog, blueprint)
  const gradeTo = Math.min(Math.max(draft.gradeTo, 1), top)
  return {
    module: kind.key,
    blueprint,
    gradeFrom: Math.min(draft.gradeFrom, gradeTo),
    gradeTo,
    experimental: draft.experimental && kind.experimentals.includes(draft.experimental) ? draft.experimental : null,
    count: Math.min(Math.max(Math.round(draft.count) || 1, 1), 99),
  }
}

/** Kinds engineers treat as one: the SCO frame shift drive takes the same blueprints. */
const SAME_KIND: Record<string, string> = { cfsdo: 'cfsd' }
const kindOf = (key: string) => SAME_KIND[key] ?? key

/**
 * The grade a module of this kind on your current ship has with this blueprint (0 when it has
 * another or none; the lowest of several such modules), or null when the ship has no such module.
 */
function shipGrade(fitted: readonly EngineeringFittedView[], module: string, blueprint: string): number | null {
  const same = fitted.filter((f) => kindOf(f.module) === kindOf(module))
  if (same.length === 0) return null
  return Math.min(...same.map((f) => (f.blueprint === blueprint ? f.grade : 0)))
}

/** A draft that starts from the grade your ship has, when it has such a module. */
function fromShip(catalog: EngineeringCatalogView, fitted: readonly EngineeringFittedView[], draft: Draft): Draft {
  const fitting = fit(catalog, draft)
  const grade = shipGrade(fitted, fitting.module, fitting.blueprint)
  return grade === null ? fitting : fit(catalog, { ...fitting, gradeFrom: grade, gradeTo: Math.max(fitting.gradeTo, grade) })
}

function GoalForm({
  catalog,
  fitted,
  start,
  saving,
  onSave,
  onCancel,
}: {
  catalog: EngineeringCatalogView
  fitted: readonly EngineeringFittedView[]
  start: Draft
  saving: boolean
  onSave: (draft: Draft) => void
  onCancel: () => void
}) {
  const g = t.shop.goals
  const [draft, setDraft] = useState(() => fit(catalog, start))
  // Another module or blueprint: "now" is what your ship has.
  const set = (patch: Partial<Draft>) =>
    setDraft('module' in patch || 'blueprint' in patch ? fromShip(catalog, fitted, { ...draft, ...patch }) : fit(catalog, { ...draft, ...patch }))
  const kind = catalog.modules.find((k) => k.key === draft.module) ?? catalog.modules[0]
  const top = topGrade(catalog, draft.blueprint)
  const grades = Array.from({ length: top + 1 }, (_, i) => i)
  const valid = draft.gradeFrom < draft.gradeTo || draft.experimental !== null
  return (
    <form
      className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-zinc-950/40 p-3 ring-1 ring-zinc-800 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(draft)
      }}
    >
      <label className="block text-xs text-zinc-400 sm:col-span-2">
        {g.module}
        <select className={`mt-1 ${field}`} value={draft.module} onChange={(e) => set({ module: e.target.value })}>
          {catalog.modules.map((k) => (
            <option key={k.key} value={k.key}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-zinc-400 sm:col-span-2">
        {g.blueprint}
        <select className={`mt-1 ${field}`} value={draft.blueprint} onChange={(e) => set({ blueprint: e.target.value })}>
          {kind.blueprints.map((b) => (
            <option key={b} value={b}>
              {catalog.blueprints[b]?.name ?? b}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-zinc-400">
        {g.from}
        <select className={`mt-1 ${field}`} value={draft.gradeFrom} onChange={(e) => set({ gradeFrom: Number(e.target.value) })}>
          {grades.map((n) => (
            <option key={n} value={n}>
              {g.grade(n)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-zinc-400">
        {g.to}
        <select className={`mt-1 ${field}`} value={draft.gradeTo} onChange={(e) => set({ gradeTo: Number(e.target.value) })}>
          {grades.slice(1).map((n) => (
            <option key={n} value={n}>
              {g.grade(n)}
            </option>
          ))}
        </select>
      </label>
      {kind.experimentals.length > 0 && (
        <label className="block text-xs text-zinc-400">
          {g.experimental}
          <select
            className={`mt-1 ${field}`}
            value={draft.experimental ?? ''}
            onChange={(e) => set({ experimental: e.target.value || null })}
          >
            <option value="">{g.noExperimental}</option>
            {kind.experimentals.map((x) => (
              <option key={x} value={x}>
                {catalog.experimentals[x]?.name ?? x}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-xs text-zinc-400">
        {g.modules}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          className={`mt-1 ${field}`}
          value={draft.count}
          onChange={(e) => set({ count: Number(e.target.value) })}
        />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={!valid || saving} className={`${button} bg-accent/15 text-zinc-50 ring-accent/50 hover:bg-accent/25 disabled:opacity-50`}>
          <Check className="size-3.5" aria-hidden />
          {g.save}
        </button>
        <button type="button" onClick={onCancel} className={`${button} text-zinc-300 ring-zinc-800 hover:bg-zinc-800`}>
          {g.cancel}
        </button>
      </div>
    </form>
  )
}

function goalLine(catalog: EngineeringCatalogView, goal: EngineeringGoalView): string {
  const g = t.shop.goals
  const kind = catalog.modules.find((k) => k.key === goal.module)
  const effect = goal.experimental ? catalog.experimentals[goal.experimental]?.name : null
  const parts = [
    kind?.name ?? goal.module,
    catalog.blueprints[goal.blueprint]?.name ?? goal.blueprint,
    goal.gradeFrom === goal.gradeTo ? g.grade(goal.gradeTo) : `${g.grade(goal.gradeFrom)} → ${g.grade(goal.gradeTo)}`,
    effect,
  ].filter(Boolean)
  return (goal.count > 1 ? `${goal.count} × ` : '') + parts.join(' · ')
}

export function EngineeringGoals({
  catalog,
  names,
  onChoose,
}: {
  catalog: EngineeringCatalogView
  /** A material's name by its symbol. */
  names: (symbol: string) => string
  /** Choose a material in the Shop. */
  onChoose: (symbol: string) => void
}) {
  const g = t.shop.goals
  const store = useStore()
  const now = useNow()
  const { data } = useView('engineering')
  const [open, setOpen] = useState(() => readStored(OPEN_KEY, ['open', 'closed'], 'open') === 'open')
  // The form: a new goal (null id) or the goal being changed; none when closed.
  const [editing, setEditing] = useState<{ id: number | null; start: Draft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const toggle = () => {
    setOpen(!open)
    writeStored(OPEN_KEY, open ? 'closed' : 'open')
  }
  const run = async (call: () => Promise<unknown>) => {
    setSaving(true)
    setFailed(false)
    try {
      await call()
      setEditing(null)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
      store.invalidate(['engineering'])
    }
  }
  const save = (draft: Draft) =>
    run(() =>
      editing && editing.id !== null
        ? store.transport.send('PUT', `/api/engineering/goals/${editing.id}`, draft)
        : store.transport.send('POST', '/api/engineering/goals', draft),
    )

  const goals = data?.goals ?? []
  const needs = [...(data?.needs ?? [])].sort((a, b) => b.need - b.have - (a.need - a.have) || names(a.symbol).localeCompare(names(b.symbol)))
  const short = needs.filter((n) => n.have < n.need).length
  const fitted = data?.fitted ?? []
  const fresh: Draft = { module: 'cfsd', blueprint: 'cfsd_ir', gradeFrom: 0, gradeTo: 5, experimental: null, count: 1 }

  return (
    <section aria-labelledby="shop-goals" className="min-w-0 rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Label as="h2" id="shop-goals" className="flex items-center gap-2">
          <Wrench className="size-4" aria-hidden />
          {g.title}
        </Label>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          title={open ? g.hide : g.show}
          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-zinc-400 hover:text-zinc-100 sm:h-8"
        >
          {goals.length > 0 && (
            <span>
              {g.count(goals.length)} · {short > 0 ? g.missingCount(short) : g.enough}
            </span>
          )}
          <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          <span className="sr-only">{open ? g.hide : g.show}</span>
        </button>
      </div>
      {open && (
        <>
          <p className="mt-2 text-xs text-zinc-500">{g.hint}</p>
          {goals.length > 0 && (
            <>
              <ul className="mt-3 divide-y divide-zinc-800/80">
                {goals.map((goal) => (
                  <li key={goal.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 text-sm break-words text-zinc-200">{goalLine(catalog, goal)}</span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: goal.id, start: goal })}
                        aria-label={`${g.edit}: ${goalLine(catalog, goal)}`}
                        title={g.edit}
                        className="focus-ring flex size-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:size-8"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => run(() => store.transport.send('DELETE', `/api/engineering/goals/${goal.id}`))}
                        aria-label={`${g.remove}: ${goalLine(catalog, goal)}`}
                        title={g.remove}
                        className="focus-ring flex size-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 sm:size-8"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-zinc-500">{g.rolls}</p>
            </>
          )}
          {editing ? (
            <GoalForm
              key={editing.id ?? 'new'}
              catalog={catalog}
              fitted={fitted}
              start={editing.start}
              saving={saving}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing({ id: null, start: fromShip(catalog, fitted, fresh) })}
              className={`${button} mt-3 text-zinc-300 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-50`}
            >
              <Plus className="size-3.5" aria-hidden />
              {g.add}
            </button>
          )}
          {failed && (
            <p role="alert" className="mt-2 text-sm text-amber-200">
              {g.error}
            </p>
          )}
          {needs.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-medium tracking-wide text-zinc-500 uppercase">{g.materials}</h3>
              <ul className="mt-1.5 divide-y divide-zinc-800/60">
                {needs.map((n) => {
                  const missing = n.need - n.have
                  return (
                    <li key={n.symbol} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                      <button
                        type="button"
                        onClick={() => onChoose(n.symbol)}
                        className="focus-ring min-w-0 rounded text-left break-words text-zinc-200 underline-offset-2 hover:text-zinc-50 hover:underline"
                      >
                        {names(n.symbol)}
                      </button>
                      <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                        <span className="text-zinc-400" title={`${g.have} / ${g.need}`}>
                          {n.have} / {n.need}
                        </span>
                        {missing > 0 ? (
                          <span className="text-amber-200">{g.short(missing)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <Check className="size-3.5" aria-hidden />
                            {g.done}
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {data && (
            <p className="mt-3 text-xs text-zinc-500">{data.stockAt ? g.stockAt(formatRelative(data.stockAt, now)) : g.noStock}</p>
          )}
        </>
      )}
    </section>
  )
}

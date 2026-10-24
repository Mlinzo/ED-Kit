// The Shop cards: a ship (blueprint, price, figures, slots) or a module (icon, price, figures,
// variant buttons), with arrows to flip through the catalog.

import { ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import type { ShopModuleView, ShopRankView, ShopShipView, ShopVariantView } from '../../api/types'
import { t } from '../../i18n'
import { formatNumber } from '../../lib/format'
import { SHIP_ORDERS, type ShipOrder } from './catalog'
import { Variants } from './parts'
import { SHIP_ROLES } from './roles'
import { ShipSketchView } from './ShipSketch'
import { makerOf, SKETCHES } from './sketches'
import { formatStat, moduleIcon, shownStats } from './stats'

const HARDPOINT = { 1: 'S', 2: 'M', 3: 'L', 4: 'H' } as const

function Flip({ position, onStep, children }: { position: string; onStep: (step: number) => void; children?: ReactNode }) {
  const c = t.shop.card
  const button = 'focus-ring flex size-10 items-center justify-center rounded-lg text-zinc-300 ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 hover:text-zinc-50 sm:size-9'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => onStep(-1)} aria-label={c.prev} title={c.prev} className={button}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="min-w-14 text-center font-mono text-xs text-zinc-500 tabular-nums" aria-live="polite">
          {position}
        </span>
        <button type="button" onClick={() => onStep(1)} aria-label={c.next} title={c.next} className={button}>
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

function Figures({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] border-t border-zinc-800 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="border-b border-zinc-800 py-1.5 text-zinc-400">{label}</dt>
          <dd className="border-b border-zinc-800 py-1.5 text-right font-mono text-zinc-100 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Cell({ size, label, title, dashed }: { size: number; label?: string; title?: string; dashed?: boolean }) {
  return (
    <span
      title={title}
      className={`inline-grid min-w-9 place-items-center rounded-md px-1.5 py-1 font-mono text-sm text-zinc-100 ring-1 ring-inset ${dashed ? 'ring-zinc-600 [border-style:dashed]' : 'ring-zinc-700'}`}
    >
      {size}
      {label && <small className="text-[9px] leading-none tracking-wide text-zinc-500">{label}</small>}
    </span>
  )
}

function Slots({ ship }: { ship: NonNullable<ShopShipView['stats']> }) {
  const c = t.shop.card
  const heading = 'text-[11px] font-medium tracking-wider text-zinc-500 uppercase'
  return (
    <div className="space-y-2.5">
      <div className={heading}>{c.core}</div>
      <div className="flex flex-wrap gap-1.5">
        {ship.core.map((size, i) => (
          <Cell key={i} size={size} label={c.coreSlots[i]} title={c.coreNames[i]} />
        ))}
      </div>
      <div className={heading}>{c.optional}</div>
      <div className="flex flex-wrap gap-1.5">
        {ship.internal.map((size, i) => (
          <Cell key={i} size={size} />
        ))}
        {ship.military.map((size, i) => (
          <Cell key={`m${i}`} size={size} label={c.military} title={c.militaryHint} dashed />
        ))}
      </div>
      <div className={heading}>{c.weapons(ship.hardpoints.length, ship.utility)}</div>
      <div className="flex flex-wrap items-end gap-1.5">
        {ship.hardpoints.map((size, i) => (
          <span key={i} className="grid justify-items-center gap-1 font-mono text-[10px] text-zinc-500">
            <i className="block rounded-sm bg-sky-400/10 ring-1 ring-zinc-300 ring-inset" style={{ width: 10 + size * 7, height: 8 + size * 4 }} />
            {HARDPOINT[size as keyof typeof HARDPOINT] ?? size}
          </span>
        ))}
      </div>
    </div>
  )
}

function RankNote({ need, navy, yours }: { need: string; navy: 'empire' | 'federation'; yours: ShopRankView | null }) {
  const s = t.shop
  const short = yours?.ok === false
  return (
    <p className={`flex items-start gap-2 rounded-xl p-3 text-sm ring-1 ${short ? 'bg-amber-500/10 text-amber-100 ring-amber-400/25' : 'bg-zinc-800/40 text-zinc-300 ring-zinc-700/60'}`}>
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {s.rankNeeded(s.navies[navy], need)}
        {yours?.have && ` · ${s.rankYours(yours.have)}`}
      </span>
    </p>
  )
}

export function ShipCard({
  ship,
  position,
  onStep,
  order,
  onOrder,
  yours,
  onHangar,
}: {
  ship: ShopShipView
  position: string
  onStep: (step: number) => void
  order: ShipOrder
  onOrder: (order: ShipOrder) => void
  /** Your rank against the one it needs (from the shop view), when known. */
  yours: ShopRankView | null
  /** Open a hangar module's card (a ship-launched vessel's carriers). */
  onHangar: (name: string) => void
}) {
  const c = t.shop.card
  const sketch = SKETCHES[ship.symbol]
  const st = ship.stats
  const maker = makerOf(ship.symbol)
  return (
    <section aria-labelledby="ship-card-title" className="min-w-0 rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id="ship-card-title" className="text-2xl font-semibold tracking-wide break-words text-zinc-50 uppercase sm:text-3xl">
            {ship.name}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {[maker, st?.pad && t.session.sell.pad[st.pad], SHIP_ROLES[ship.symbol]?.map((r) => c.role[r]).join(', ')].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Flip position={position} onStep={onStep}>
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            {c.order}
            <select
              value={order}
              onChange={(e) => onOrder(e.target.value as ShipOrder)}
              className="focus-ring h-10 rounded-lg bg-zinc-900 px-2 text-sm text-zinc-200 ring-1 ring-zinc-800 ring-inset sm:h-9"
            >
              {SHIP_ORDERS.map((o) => (
                <option key={o} value={o}>
                  {c.orders[o]}
                </option>
              ))}
            </select>
          </label>
        </Flip>
      </div>

      {st?.price != null && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-2xl font-medium text-accent tabular-nums">
            {formatNumber(st.price)} {t.units.credits}
          </span>
          <span className="text-sm text-zinc-500">{c.basePrice}</span>
        </p>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {sketch ? (
          <ShipSketchView sketch={sketch} name={ship.name} />
        ) : (
          <div className="grid min-h-40 place-items-center rounded-xl bg-zinc-950 text-sm text-zinc-500 ring-1 ring-zinc-800 ring-inset">{c.noSketch}</div>
        )}
        <div className="min-w-0 space-y-4">
          {ship.unsold && <p className="rounded-xl bg-zinc-800/40 p-3 text-sm text-zinc-300 ring-1 ring-zinc-700/60">{c.unsold}</p>}
          {ship.hangars && ship.hangars.length > 0 && (
            <div className="rounded-xl bg-zinc-800/40 p-3 text-sm text-zinc-300 ring-1 ring-zinc-700/60">
              <p>{c.launched}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {ship.hangars.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onHangar(name)}
                    className="focus-ring inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-800 hover:text-zinc-50 sm:h-8"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {ship.rank && <RankNote need={ship.rank.need} navy={ship.rank.navy} yours={yours} />}
          {st && (
            <Figures
              rows={[
                [c.speed, `${st.speed ?? '–'} / ${st.boost ?? '–'} ${t.units.m}/${t.units.s}`],
                [c.defence, `${st.shields ?? '–'} / ${st.armour ?? '–'}`],
                [c.hullMass, st.mass != null ? `${formatNumber(st.mass)} ${t.units.t}` : '–'],
                [c.hardness, st.hardness ?? '–'],
                [c.masslock, st.masslock ?? '–'],
                [c.crew, st.crew ?? '–'],
                [c.fighterBay, st.fighterBay ? c.fighterBayYes : c.fighterBayNo],
              ]}
            />
          )}
          {st && <Slots ship={st} />}
        </div>
      </div>
      <p className="mt-4 text-xs text-zinc-600">
        {sketch && `${sketch.traced === 'sheet' ? c.tracedNote : sketch.traced === 'game' ? c.gameNote : c.sketchNote} · `}
        {c.source}
      </p>
    </section>
  )
}

export function ModuleCard({
  module,
  variant,
  position,
  onStep,
  onChoose,
}: {
  module: ShopModuleView
  variant: ShopVariantView
  position: string
  onStep: (step: number) => void
  onChoose: (symbol: string) => void
}) {
  const c = t.shop.card
  const s = t.shop
  const extra = [variant.mount && s.mounts[variant.mount], variant.guidance && s.guidances[variant.guidance]].filter(Boolean)
  const figures: [string, ReactNode][] = [
    ...(variant.mass != null ? [[c.mass, `${formatNumber(variant.mass, variant.mass % 1 ? 1 : 0)} ${t.units.t}`] as [string, ReactNode]] : []),
    ...(variant.power ? [[c.power, `${formatNumber(variant.power, 2)} ${t.units.mw}`] as [string, ReactNode]] : []),
    ...(variant.integrity != null ? [[c.integrity, variant.integrity] as [string, ReactNode]] : []),
    ...shownStats(variant.stats).map(([key, value]): [string, ReactNode] => [s.stat[key as keyof typeof s.stat], formatStat(key, value)]),
  ]
  return (
    <section aria-labelledby="module-card-title" className="min-w-0 rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-accent ring-1 ring-sky-400/30 ring-inset">
            {createElement(moduleIcon(module.type), { className: 'size-7', 'aria-hidden': true })}
          </span>
          <div className="min-w-0">
            <h2 id="module-card-title" className="text-xl font-semibold break-words text-zinc-50 sm:text-2xl">
              {module.name}
            </h2>
            <p className="mt-0.5 font-mono text-lg text-zinc-300">
              {variant.size}
              {variant.rating}
              {extra.length > 0 && <span className="font-sans text-sm text-zinc-500"> · {extra.join(' · ')}</span>}
            </p>
          </div>
        </div>
        <Flip position={position} onStep={onStep} />
      </div>

      {variant.price != null && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-2xl font-medium text-accent tabular-nums">
            {formatNumber(variant.price)} {t.units.credits}
          </span>
          <span className="text-sm text-zinc-500">{c.basePrice}</span>
        </p>
      )}
      {module.unlock && <p className="mt-3 rounded-xl bg-zinc-800/40 p-3 text-sm text-zinc-300 ring-1 ring-zinc-700/60">{s.unlock[module.unlock]}</p>}

      <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Variants module={module} variant={variant} onChoose={onChoose} />
        <div className="min-w-0 pt-3">{figures.length > 0 ? <Figures rows={figures} /> : <p className="text-sm text-zinc-500">{c.noFigures}</p>}</div>
      </div>
      <p className="mt-4 text-xs text-zinc-600">{c.source}</p>
    </section>
  )
}

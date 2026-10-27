// The Mining tab: choose a commodity worth mining; the nearest rings with its hotspots (each with
// the market nearest to it), the markets paying the most for it, and the shortest trip through
// both. Spansh answers; the backend keeps the answer an hour while you stay near. Filters sit in
// the list they narrow (rings: reserves, distance from the star; markets: demand, how fresh,
// distance from the star) and are remembered per browser.

import { ArrowDown, ArrowRight, CircleDot, LoaderCircle, MapPin, Navigation, Pickaxe, Route, Store } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useView } from '../../api/hooks'
import type { MiningBuyerView, MiningRingView, MiningTripView, MiningView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CommunityGlyph } from '../../components/SourceBadge'
import { Label } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { t } from '../../i18n'
import { exactCredits, formatLs, formatLy, formatMonthYear, formatNumber, formatRelative } from '../../lib/format'
import { readStored, readStoredText, writeStored } from '../../lib/storage'
import { CarriersSwitch } from '../session/WhereToSell'
import { Chip } from '../shop/parts'
import {
  BUYER_ORDERS,
  buyersFiltered,
  DEMAND_LIMITS,
  FRESH_DAYS,
  LS_LIMITS,
  miningParams,
  orderBuyers,
  parseFilters,
  RESERVES,
  ringParts,
  ringsFiltered,
  type BuyerOrder,
  type MiningFilters,
  type Reserve,
} from './helpers'

const ITEM_KEY = 'edk.miningItem'
const CARRIERS_KEY = 'edk.miningCarriers'
const ORDER_KEY = 'edk.miningOrder'
const FILTERS_KEY = 'edk.miningFilters'
/** A filter changed waits this long before asking Spansh, so a few quick clicks ask once. */
const SETTLE_MS = 450
/** Rows shown before "Show all". */
const FIRST_ROWS = 12
/** Reported earlier than this, a market is marked as old. */
const OLD_AFTER_MS = 30 * 86_400_000
/** Reported earlier than this, the month is told instead of "1946 days ago". */
const MONTH_AFTER_MS = 60 * 86_400_000

const card = 'min-w-0 rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800'
const quietButton =
  'focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 hover:text-zinc-50 sm:h-8'

const perTonne = (price: number) => t.shop.perTonne(exactCredits(price))
/** "ABC 1 · ring A": the body to fly to, then its ring (or the ring's whole name). */
function ringName(ring: MiningRingView): string {
  const parts = ringParts(ring)
  return parts.ring ? t.mining.ringOf(parts.body, parts.ring) : ring.name
}
const distance = (ly: number, jumps: number | null) => (ly < 0.5 ? t.route.youAreHere : formatLy(ly) + (jumps ? ` · ${t.route.jumps(jumps)}` : ''))

function Picker({ view, chosen, onChoose }: { view: MiningView | null; chosen: string | null; onChoose: (symbol: string) => void }) {
  const m = t.mining
  return (
    <section aria-labelledby="mining-choose" className={card}>
      <Label as="h2" id="mining-choose" className="flex items-center gap-2">
        <Pickaxe className="size-4" aria-hidden />
        {m.choose}
      </Label>
      {!chosen && <p className="mt-2 text-sm text-zinc-400">{m.chooseHint}</p>}
      {view ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {view.commodities.map((c) => (
            <li key={c.symbol}>
              <Chip active={c.symbol === chosen} onClick={() => onChoose(c.symbol)} title={c.hotspots ? undefined : m.noHotspots}>
                {c.name}
                {!c.hotspots && <span className="ml-1.5 text-xs text-zinc-500">{m.noHotspots}</span>}
              </Chip>
            </li>
          ))}
        </ul>
      ) : (
        <LoaderCircle className="mt-3 size-4 animate-spin text-zinc-500" aria-hidden />
      )}
    </section>
  )
}

function Stop({ icon, title, sub, copy, grow = true }: { icon: ReactNode; title: string; sub?: ReactNode; copy?: string; grow?: boolean }) {
  return (
    <li className={`flex min-w-0 items-start gap-2 rounded-xl bg-zinc-950/40 px-3 py-2 ring-1 ring-zinc-800 ${grow ? 'sm:flex-1' : 'sm:items-center'}`}>
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="min-w-0 font-medium break-words text-zinc-50">{title}</span>
          {copy && <CopyButton text={copy} />}
        </span>
        {sub && <span className="block text-xs text-zinc-400">{sub}</span>}
      </span>
    </li>
  )
}

function Leg({ ly }: { ly: number }) {
  return (
    <li aria-hidden className="flex shrink-0 items-center gap-1 self-center text-xs whitespace-nowrap text-zinc-400 tabular-nums">
      <ArrowDown className="size-3.5 sm:hidden" />
      <span>{ly < 0.5 ? t.mining.sameSystem : formatLy(ly)}</span>
      <ArrowRight className="hidden size-3.5 sm:block" />
    </li>
  )
}

function Trip({ trip, rings }: { trip: MiningTripView; rings: readonly MiningRingView[] }) {
  const m = t.mining
  const ring = rings.find((r) => r.name === trip.ring)
  return (
    <section aria-labelledby="mining-trip" className="min-w-0 rounded-2xl bg-accent/5 p-5 ring-1 ring-accent/25">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label as="h2" id="mining-trip" className="flex items-center gap-2">
          <Route className="size-4" aria-hidden />
          {m.trip}
        </Label>
        <span className="text-sm font-semibold text-zinc-50 tabular-nums">{m.total(formatLy(trip.totalLy))}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{m.tripHint}</p>
      <ol className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <Stop icon={<MapPin className="size-4" />} title={m.you} grow={false} />
        <Leg ly={trip.distanceLy} />
        <Stop
          icon={<CircleDot className="size-4" />}
          title={trip.systemName}
          copy={trip.systemName}
          sub={ring ? `${ringName(ring)} · ${m.hotspots(ring.count)}` : trip.ring}
        />
        <Leg ly={trip.sell.distanceLy} />
        <Stop
          icon={<Store className="size-4" />}
          title={trip.sell.station}
          copy={trip.sell.systemName}
          sub={`${trip.sell.systemName} · ${perTonne(trip.sell.price)}`}
        />
      </ol>
    </section>
  )
}

const RESERVE_TONE: Record<string, string> = { Pristine: 'text-emerald-300', Major: 'text-zinc-300', Depleted: 'text-amber-200/70' }

function RouteButton({ system, onRouteTo }: { system: string; onRouteTo: (system: string) => void }) {
  const label = `${t.session.sell.routeHere}: ${system}`
  return (
    <button
      type="button"
      onClick={() => onRouteTo(system)}
      title={label}
      aria-label={label}
      className="focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 hover:text-zinc-50 sm:size-8"
    >
      <Navigation className="size-4" aria-hidden />
    </button>
  )
}

/** One row of a list: the lead (how far, or the price), what it is, its facts, a button to route
 *  there. Wider than a phone the lead is a column on the left; on a phone it sits top right with the
 *  button under it, so the name and the facts keep the width. */
function Line({
  lead,
  head,
  facts,
  system,
  here,
  onRouteTo,
}: {
  lead: ReactNode
  head: ReactNode
  facts: ReactNode
  system: string
  here: boolean
  onRouteTo: (system: string) => void
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
      <div className="col-start-2 row-start-1 text-right tabular-nums sm:col-start-1 sm:row-span-2">{lead}</div>
      <div className="col-start-1 row-start-1 min-w-0 sm:col-start-2">{head}</div>
      <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2">{facts}</div>
      {!here && (
        <div className="col-start-2 row-start-2 mt-1 justify-self-end sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0">
          <RouteButton system={system} onRouteTo={onRouteTo} />
        </div>
      )}
    </li>
  )
}

function Distance({ ly, jumps }: { ly: number; jumps: number | null }) {
  if (ly < 0.5) return <div className="text-sm font-semibold text-zinc-50">{t.mining.here}</div>
  return (
    <>
      <div className="text-sm font-semibold whitespace-nowrap text-zinc-50">{formatLy(ly)}</div>
      {jumps ? <div className="text-xs whitespace-nowrap text-zinc-500">{t.route.jumps(jumps)}</div> : null}
    </>
  )
}

function Price({ price }: { price: number }) {
  return (
    <>
      <div className="text-sm font-semibold whitespace-nowrap text-emerald-300">{formatNumber(price)}</div>
      <div className="text-xs whitespace-nowrap text-zinc-500">{t.shop.perTonne(t.units.credits)}</div>
    </>
  )
}

/** Small facts in a row, by name, with "·" between them; empty ones are left out. */
function Facts({ parts }: { parts: Record<string, ReactNode> }) {
  const shown = Object.entries(parts).filter(([, x]) => x !== null && x !== false && x !== '')
  return (
    <p className="mt-0.5 text-xs text-zinc-500">
      {shown.map(([name, x], i) => (
        <Fragment key={name}>
          {i > 0 && ' · '}
          {x}
        </Fragment>
      ))}
    </p>
  )
}

function Ring({ ring, now, onRouteTo }: { ring: MiningRingView; now: number; onRouteTo: (system: string) => void }) {
  const m = t.mining
  const type = ring.type ? ((m.ringTypes as Record<string, string>)[ring.type] ?? ring.type) : null
  const reserve = ring.reserve ? ((m.reserves as Record<string, string>)[ring.reserve] ?? ring.reserve) : null
  const reported = ring.reportedAt ? ` · ${m.reported(formatRelative(ring.reportedAt, now))}` : ''
  return (
    <Line
      lead={<Distance ly={ring.distanceLy} jumps={ring.jumps} />}
      system={ring.systemName}
      here={ring.distanceLy < 0.5}
      onRouteTo={onRouteTo}
      head={
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 font-medium break-words text-zinc-50">{ring.systemName}</span>
            <CopyButton text={ring.systemName} />
          </span>
          <span className="text-sm text-zinc-300">{ringName(ring)}</span>
          <span
            title={m.hotspots(ring.count) + reported}
            className={`rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${
              ring.count > 1 ? 'bg-accent/15 text-accent-strong ring-accent/40' : 'bg-zinc-800/70 text-zinc-300 ring-zinc-700'
            }`}
          >
            ×{ring.count}
          </span>
        </div>
      }
      facts={
        <Facts
          parts={{
            type,
            reserve: reserve && (
              <span title={m.reserveHint} className={RESERVE_TONE[ring.reserve ?? ''] ?? 'text-zinc-400'}>
                {reserve}
              </span>
            ),
            ls: ring.distLs !== null && formatLs(ring.distLs),
            also: ring.others.length > 0 && `${m.also}: ${ring.others.map((o) => `${o.name} ×${o.count}`).join(', ')}`,
          }}
        />
      }
    />
  )
}

function MarketAge({ at, now }: { at: string; now: number }) {
  const s = t.shop
  const age = now - Date.parse(at)
  return (
    <span className={age > OLD_AFTER_MS ? 'text-amber-200/70' : undefined} title={age > OLD_AFTER_MS ? s.oldDataHint : undefined}>
      {age > MONTH_AFTER_MS ? s.dataFrom(formatMonthYear(at)) : s.dataAge(formatRelative(at, now))}
    </span>
  )
}

function Buyer({ buyer, now, onRouteTo }: { buyer: MiningBuyerView; now: number; onRouteTo: (system: string) => void }) {
  const sell = t.session.sell
  return (
    <Line
      lead={<Price price={buyer.price} />}
      system={buyer.systemName}
      here={buyer.distanceLy < 0.5}
      onRouteTo={onRouteTo}
      head={
        <div className="flex flex-wrap items-center gap-x-1.5">
          <span className="min-w-0 font-medium break-words text-zinc-50">{buyer.station}</span>
          <span className="flex min-w-0 items-center gap-1 text-sm text-zinc-400">
            <span className="min-w-0 break-words">{buyer.systemName}</span>
            <CopyButton text={buyer.systemName} />
          </span>
        </div>
      }
      facts={
        <Facts
          parts={{
            distance: <span className="text-zinc-300 tabular-nums">{distance(buyer.distanceLy, buyer.jumps)}</span>,
            demand: <span className="text-zinc-400 tabular-nums">{t.mining.demand(formatNumber(buyer.demand))}</span>,
            kind: sell.kind[buyer.kind],
            pad: buyer.pad && (
              <span title={sell.pad[buyer.pad]} className="font-mono">
                {buyer.pad}
              </span>
            ),
            ls: buyer.distLs !== null && formatLs(buyer.distLs),
            age: buyer.marketAt && <MarketAge at={buyer.marketAt} now={now} />,
            permit: buyer.permit && (
              <span title={t.shop.permitHint} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-200 ring-1 ring-amber-400/25 ring-inset">
                {t.shop.permit}
              </span>
            ),
            access: buyer.access && <span className={buyer.access === 'all' ? 'text-zinc-400' : 'text-amber-200/70'}>{sell.access[buyer.access]}</span>,
          }}
        />
      }
    />
  )
}

/** The first rows, and a button for the rest. */
function Rows<T>({ items, render }: { items: readonly T[]; render: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, FIRST_ROWS)
  return (
    <>
      <ol className="mt-1 divide-y divide-zinc-800/80">{shown.map(render)}</ol>
      {items.length > FIRST_ROWS && (
        <button type="button" onClick={() => setAll(!all)} className={`${quietButton} mt-2`}>
          {all ? t.mining.showFewer : t.mining.showAll(items.length)}
        </button>
      )}
    </>
  )
}

function OrderSwitch({ order, onChange }: { order: BuyerOrder; onChange: (order: BuyerOrder) => void }) {
  const m = t.mining
  return (
    <div role="group" aria-label={m.order} className="inline-flex rounded-lg bg-zinc-800/70 p-0.5 ring-1 ring-zinc-700 ring-inset">
      {BUYER_ORDERS.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === order}
          onClick={() => onChange(o)}
          className={`focus-ring h-9 rounded-md px-2.5 text-sm font-medium sm:h-7 ${o === order ? 'bg-zinc-950/70 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {m.orders[o]}
        </button>
      ))}
    </div>
  )
}

function BetterCarrier({ carrier, onShow }: { carrier: MiningBuyerView; onShow: () => void }) {
  const where = formatLy(carrier.distanceLy) + (carrier.jumps ? ` (${t.route.jumps(carrier.jumps)})` : '')
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-zinc-800/40 p-3 text-sm text-zinc-300 ring-1 ring-zinc-700/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="min-w-0">{t.mining.betterCarrier(carrier.station, carrier.systemName, where, perTonne(carrier.price))}</p>
      <button
        type="button"
        onClick={onShow}
        className="focus-ring h-10 shrink-0 self-start rounded-lg bg-zinc-800 px-3 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-700 sm:h-8 sm:self-auto"
      >
        {t.session.sell.showCarriers}
      </button>
    </div>
  )
}

type Option = { value: string; text: string }

/** A filter's choices as a small native select (a phone opens its own picker). */
function Limit({ label, value, options, onChange }: { label: string; value: string; options: readonly Option[]; onChange: (value: string) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring h-9 rounded-lg bg-zinc-800/70 px-2 text-sm text-zinc-200 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-800 sm:h-8"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  )
}

const numberOr = (value: string): number | null => (value === '' ? null : Number(value))
const lsOptions = (): Option[] => [
  { value: '', text: t.mining.filters.anyDistance },
  ...LS_LIMITS.map((ls) => ({ value: String(ls), text: t.mining.filters.upToLs(formatLs(ls)) })),
]

function RingFilters({ filters, onChange }: { filters: MiningFilters; onChange: (next: MiningFilters) => void }) {
  const f = t.mining.filters
  const toggle = (r: Reserve) =>
    onChange({ ...filters, reserves: filters.reserves.includes(r) ? filters.reserves.filter((x) => x !== r) : [...filters.reserves, r] })
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-label={f.reserves} title={f.anyReserves} className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-zinc-500">{f.reserves}</span>
        {RESERVES.map((r) => (
          <Chip key={r} active={filters.reserves.includes(r)} onClick={() => toggle(r)}>
            {f.reserveNames[r]}
          </Chip>
        ))}
      </div>
      <Limit label={f.fromStar} value={String(filters.ringLs ?? '')} options={lsOptions()} onChange={(v) => onChange({ ...filters, ringLs: numberOr(v) })} />
    </div>
  )
}

function BuyerFilters({ filters, cargo, onChange }: { filters: MiningFilters; cargo: number | null; onChange: (next: MiningFilters) => void }) {
  const f = t.mining.filters
  const tonnes = (n: number) => `${formatNumber(n)} ${t.units.t}`
  const demand: Option[] = [
    { value: '', text: f.anyDemand },
    { value: 'hold', text: cargo ? f.hold(tonnes(cargo)) : f.holdUnknown },
    ...DEMAND_LIMITS.map((d) => ({ value: String(d), text: f.atLeast(tonnes(d)) })),
  ]
  const age: Option[] = [{ value: '', text: f.anyAge }, ...FRESH_DAYS.map((d) => ({ value: String(d), text: f.days(d) }))]
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Limit
        label={f.demand}
        value={String(filters.demand ?? '')}
        options={demand}
        onChange={(v) => onChange({ ...filters, demand: v === 'hold' ? 'hold' : numberOr(v) })}
      />
      <Limit label={f.prices} value={String(filters.freshDays ?? '')} options={age} onChange={(v) => onChange({ ...filters, freshDays: numberOr(v) })} />
      <Limit label={f.fromStar} value={String(filters.stationLs ?? '')} options={lsOptions()} onChange={(v) => onChange({ ...filters, stationLs: numberOr(v) })} />
    </div>
  )
}

function Status({ view, failed, onRetry }: { view: MiningView | null; failed: boolean; onRetry: () => void }) {
  const s = t.shop
  if (!view && !failed)
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-400" role="status">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-zinc-500" aria-hidden />
        {s.loading}
      </p>
    )
  const text =
    !view || view.state === 'failed'
      ? s.failed
      : view.state === 'offline'
        ? t.mining.offline
        : view.state === 'unknown_position'
          ? s.unknownPosition
          : view.state === 'unknown_item'
            ? s.unknownItem
            : null
  if (!text) return null
  return (
    <div className={`${card} flex flex-wrap items-center gap-3 text-sm text-zinc-400`} role="status">
      <p>{text}</p>
      {(!view || view.state === 'failed') && (
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring h-10 rounded-lg bg-zinc-800 px-3 font-medium text-zinc-100 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-700 sm:h-8"
        >
          {s.retry}
        </button>
      )}
    </div>
  )
}

export function MiningScreen({ onRouteTo }: { onRouteTo: (system: string) => void }) {
  const m = t.mining
  const now = useNow()
  const [item, setItem] = useState<string | null>(() => readStoredText(ITEM_KEY))
  const [carriers, setCarriers] = useState(() => readStored(CARRIERS_KEY, ['on', 'off'], 'off') === 'on')
  const [order, setOrder] = useState<BuyerOrder>(() => readStored(ORDER_KEY, BUYER_ORDERS, 'price'))
  // `filters` are shown; `asked` are what the results are asked for (they trail a change).
  const [filters, setFilters] = useState<MiningFilters>(() => parseFilters(readStoredText(FILTERS_KEY)))
  const [asked, setAsked] = useState<MiningFilters>(filters)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(settle.current), [])
  // The answer for the previous choice stays while the new one loads; it knows your hold.
  const [last, setLast] = useState<MiningView | null>(null)
  const { data, error, refetch } = useView('mining', miningParams(item, carriers, asked, last?.cargo ?? null))
  if (data && data !== last) setLast(data)
  const view = data ?? last
  const settled = data !== null
  const ready = settled && data.state === 'ready' && data.item !== null

  const choose = (symbol: string) => {
    setItem(symbol)
    writeStored(ITEM_KEY, symbol)
  }
  const toggleCarriers = (on: boolean) => {
    setCarriers(on)
    writeStored(CARRIERS_KEY, on ? 'on' : 'off')
  }
  const changeOrder = (next: BuyerOrder) => {
    setOrder(next)
    writeStored(ORDER_KEY, next)
  }
  const changeFilters = (next: MiningFilters) => {
    setFilters(next)
    writeStored(FILTERS_KEY, JSON.stringify(next))
    clearTimeout(settle.current)
    settle.current = setTimeout(() => setAsked(next), SETTLE_MS)
  }
  const fade = settled ? '' : 'opacity-60'
  const reach = formatLy(view?.reachLy ?? 500)

  return (
    <div className="space-y-4 lg:space-y-6">
      <Picker view={view} chosen={item} onChoose={choose} />
      {item && <Status view={settled ? data : null} failed={error !== null} onRetry={refetch} />}
      {item && view?.item && view.state === 'ready' && (
        <>
          {view.trip && (
            <div className={fade}>
              <Trip trip={view.trip} rings={view.rings} />
            </div>
          )}
          <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6 ${fade}`}>
            <section aria-labelledby="mining-rings" className={card}>
              <Label as="h2" id="mining-rings" className="flex items-center gap-2">
                <CircleDot className="size-4" aria-hidden />
                {m.whereToMine}
              </Label>
              {view.hotspots ? (
                <>
                  <p className="mt-2 text-xs text-zinc-500">{m.mineHint}</p>
                  <RingFilters filters={filters} onChange={changeFilters} />
                  {view.rings.length > 0 ? (
                    <Rows key={view.item} items={view.rings} render={(r) => <Ring key={r.name} ring={r} now={now} onRouteTo={onRouteTo} />} />
                  ) : (
                    ready && <p className="mt-3 text-sm text-zinc-400">{ringsFiltered(asked) ? m.filters.noMatch : m.noRings}</p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-sm text-zinc-300">{m.osmium}</p>
              )}
            </section>
            <section aria-labelledby="mining-buyers" className={card}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <Label as="h2" id="mining-buyers" className="flex items-center gap-2">
                  <Store className="size-4" aria-hidden />
                  {m.whereToSell}
                </Label>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <OrderSwitch order={order} onChange={changeOrder} />
                  <CarriersSwitch on={carriers} onChange={toggleCarriers} />
                </div>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {m.sellHint(reach)}
                {view.ship && view.pad && ` · ${t.shop.padNote(view.ship, t.session.sell.pad[view.pad])}`}
              </p>
              <BuyerFilters filters={filters} cargo={view.cargo} onChange={changeFilters} />
              {!carriers && view.betterCarrier && <BetterCarrier carrier={view.betterCarrier} onShow={() => toggleCarriers(true)} />}
              {view.buyers.length > 0 ? (
                <Rows
                  key={`${view.item}-${order}`}
                  items={orderBuyers(view.buyers, order)}
                  render={(b) => <Buyer key={`${b.systemName}/${b.station}`} buyer={b} now={now} onRouteTo={onRouteTo} />}
                />
              ) : (
                ready && <p className="mt-3 text-sm text-zinc-400">{buyersFiltered(asked) ? m.filters.noMatch : m.noBuyers(reach)}</p>
              )}
            </section>
          </div>
          <div className="space-y-1 text-xs text-zinc-500">
            {view.searchedAt && (
              <p className="flex items-center gap-1.5">
                <CommunityGlyph />
                {m.source} · {formatRelative(view.searchedAt, now)}
              </p>
            )}
            {view.carriers && <p>{t.session.sell.carriers}</p>}
          </div>
        </>
      )}
    </div>
  )
}

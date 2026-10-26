// The Shop tab: the nearest shipyards and outfitting as soon as it opens, and where to buy a
// ship, a module or a commodity once one is chosen, by words or from the lists. A module's class,
// mount, rating and guidance are buttons above its results; a commodity's stations say how much
// they had in stock.

import { ChevronDown, LoaderCircle, Navigation, Search, ShoppingCart, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, useView } from '../../api/hooks'
import type { ShopCatalogView, ShopModuleView, ShopPlaceView, ShopShipView, ShopStationView, ShopView } from '../../api/types'
import { InlineBookmark } from '../../components/Bookmark'
import { CopyButton } from '../../components/CopyButton'
import { Credits } from '../../components/Credits'
import { CommunityGlyph } from '../../components/SourceBadge'
import { Label } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { t } from '../../i18n'
import { exactCredits, formatLs, formatLy, formatMonthYear, formatNumber, formatRelative } from '../../lib/format'
import { readStored, readStoredText, writeStored } from '../../lib/storage'
import { CarriersSwitch, NearerCarrier } from '../session/WhereToSell'
import {
  commoditiesOf,
  commodityGroup,
  commodityGroups,
  lookup,
  neighbour,
  nextModule,
  orderShips,
  searchCatalog,
  SHIP_ORDERS,
  variantFor,
  type Pick,
  type ShipOrder,
  type Want,
} from './catalog'
import { CommodityCard, ModuleCard, ShipCard } from './ItemCard'
import { Chip, ShipRow } from './parts'
import { fitsRole, ROLE_FILTERS, type RoleFilter } from './roles'

const ITEM_KEY = 'edk.shopItem'
const CARRIERS_KEY = 'edk.shopCarriers'
/** Reported earlier than this, a station's offer is marked as old. */
const OLD_AFTER_MS = 30 * 86_400_000
/** Reported earlier than this, the month is told instead of "1946 days ago". */
const MONTH_AFTER_MS = 60 * 86_400_000

type Group = 'ships' | ShopModuleView['category'] | 'commodities'
const GROUPS: readonly Group[] = ['ships', 'core', 'optional', 'hardpoint', 'utility', 'commodities']

/** A commodity group's name: the market category in the chosen language (as is when unknown). */
const categoryName = (group: string): string => (t.shop.commodityCategories as Record<string, string>)[group] ?? group

let catalogRequest: Promise<ShopCatalogView> | null = null

/** The catalog, fetched once per page load (it changes only with the app). */
function useShopCatalog(): ShopCatalogView | null {
  const store = useStore()
  const [catalog, setCatalog] = useState<ShopCatalogView | null>(null)
  useEffect(() => {
    let alive = true
    catalogRequest ??= store.transport.fetchJson<ShopCatalogView>('/api/shop/catalog')
    catalogRequest.then(
      (c) => alive && setCatalog(c),
      () => {
        catalogRequest = null
      },
    )
    return () => {
      alive = false
    }
  }, [store])
  return catalog
}

function pickLabel(p: Pick): string {
  if (p.kind === 'ship') return p.ship.name
  if (p.kind === 'commodity') return p.commodity.name
  const v = p.want.size !== undefined ? variantFor(p.module, p.want) : null
  return v ? `${p.module.name} ${v.size}${v.rating}` : p.module.name
}

/** Search by words, and the lists by group (always shown on a wide screen, folded on a phone). */
function Picker({
  catalog,
  chosen,
  want,
  ships,
  role,
  onRole,
  onChoose,
}: {
  catalog: ShopCatalogView | null
  /** The chosen ship's or commodity's symbol, or module's name. */
  chosen: string | null
  /** The chosen module's variant: another module keeps its class and rating where it has them. */
  want: Want
  /** The ships the card flips through, in its order: of the chosen type. */
  ships: readonly ShopShipView[]
  role: RoleFilter
  onRole: (role: RoleFilter) => void
  onChoose: (symbol: string) => void
}) {
  const s = t.shop
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const chosenGoods = catalog && chosen ? catalog.commodities.find((c) => c.symbol === chosen) : undefined
  // The group shown: the one picked, else the chosen item's (the catalog may come after the choice).
  const [picked, setGroup] = useState<Group | null>(null)
  const group: Group = picked ?? (chosenGoods ? 'commodities' : 'ships')
  // The commodity group shown: the one picked, else the chosen commodity's, else the first.
  const [goods, setGoods] = useState<string | null>(null)
  const found = catalog && query.trim() ? searchCatalog(catalog, query) : []
  const choose = (p: Pick) => {
    onChoose(p.kind === 'ship' ? p.ship.symbol : p.kind === 'commodity' ? p.commodity.symbol : variantFor(p.module, { ...want, ...p.want }).symbol)
    setQuery('')
    setOpen(false)
  }
  const modules = catalog && group !== 'ships' && group !== 'commodities' ? catalog.modules.filter((m) => m.category === group) : []
  const goodsGroups = catalog && group === 'commodities' ? commodityGroups(catalog) : []
  const goodsGroup = group === 'commodities' ? (goods ?? (chosenGoods ? commodityGroup(chosenGoods) : goodsGroups[0])) : undefined

  return (
    <section
      aria-label={s.searchLabel}
      className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-zinc-800 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto"
    >
      <label className="relative block">
        <span className="sr-only">{s.searchLabel}</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[0]) choose(found[0])
            if (e.key === 'Escape') setQuery('')
          }}
          placeholder={s.searchPlaceholder}
          className="focus-ring h-11 w-full rounded-lg bg-zinc-950/60 pr-10 pl-9 text-base text-zinc-100 ring-1 ring-zinc-700 ring-inset placeholder:text-zinc-500 sm:h-10 sm:text-sm"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={s.searchClear}
            className="focus-ring absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </label>

      {query.trim() !== '' && (
        <div className="mt-2">
          {found.length === 0 ? (
            <p className="px-1 py-2 text-sm text-zinc-500">{s.noMatches}</p>
          ) : (
            <ul className="space-y-1">
              {found.map((p) => (
                <li key={p.kind === 'ship' ? p.ship.symbol : p.kind === 'commodity' ? p.commodity.symbol : p.module.name}>
                  <button
                    type="button"
                    onClick={() => choose(p)}
                    className="focus-ring flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    <span className="min-w-0 break-words">{pickLabel(p)}</span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {p.kind === 'commodity' ? categoryName(commodityGroup(p.commodity)) : s.groups[p.kind === 'ship' ? 'ships' : p.module.category]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="focus-ring mt-3 flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 lg:hidden"
      >
        {s.browse}
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div className={open ? 'mt-3' : 'mt-3 hidden lg:block'}>
        <div role="group" aria-label={s.browse} className="flex flex-wrap gap-1.5">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={g === group}
              onClick={() => setGroup(g)}
              className={`focus-ring h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                g === group ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              {s.groups[g]}
            </button>
          ))}
        </div>
        {catalog && group === 'ships' && (
          <div role="group" aria-label={s.roleFilter} className="mt-3 flex flex-wrap gap-1.5">
            {ROLE_FILTERS.map((r) => (
              <Chip key={r} active={r === role} onClick={() => onRole(r)}>
                {s.roles[r]}
              </Chip>
            ))}
          </div>
        )}
        {group === 'ships' && ships.length > 0 && (
          <ul className="mt-3 space-y-1">
            {ships.map((ship) => (
              <li key={ship.symbol}>
                <ShipRow ship={ship} active={ship.symbol === chosen} onClick={() => choose({ kind: 'ship', ship })} />
              </li>
            ))}
          </ul>
        )}
        {modules.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {modules.map((module) => (
              <li key={module.name}>
                <Chip active={module.name === chosen} onClick={() => choose({ kind: 'module', module, want: {} })}>
                  {module.name}
                </Chip>
              </li>
            ))}
          </ul>
        )}
        {catalog && goodsGroup && (
          <>
            <div role="group" aria-label={s.commodityFilter} className="mt-3 flex flex-wrap gap-1.5">
              {goodsGroups.map((g) => (
                <Chip key={g} active={g === goodsGroup} onClick={() => setGoods(g)}>
                  {categoryName(g)}
                </Chip>
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-3">
              {commoditiesOf(catalog, goodsGroup).map((commodity) => (
                <li key={commodity.symbol}>
                  <Chip active={commodity.symbol === chosen} onClick={() => choose({ kind: 'commodity', commodity })}>
                    {commodity.name}
                  </Chip>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function Station({ station, now, place }: { station: ShopStationView; now: number; place: ShopPlaceView }) {
  const s = t.shop
  const sell = t.session.sell
  const age = station.offerAt !== null ? now - Date.parse(station.offerAt) : 0
  const counts = [
    station.shipCount === null ? null : station.shipCount > 0 ? s.ships(station.shipCount) : s.noShipList,
    station.moduleCount === null ? null : station.moduleCount > 0 ? s.modules(station.moduleCount) : s.noModuleList,
  ].filter((x) => x !== null)
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="min-w-0 break-words text-zinc-200">{station.name}</span>
      <span className="text-zinc-500">
        {sell.kind[station.kind]}
        {station.distLs !== null && ` · ${formatLs(station.distLs)}`}
      </span>
      {/* A commodity's price in full: markets differ by a few hundred credits a tonne. */}
      {station.price !== null &&
        (station.stock !== null ? (
          <span className="font-medium text-zinc-100 tabular-nums">{s.perTonne(exactCredits(station.price))}</span>
        ) : (
          <Credits value={station.price} className="font-medium text-zinc-100 tabular-nums" />
        ))}
      {station.stock !== null && <span className="text-zinc-400 tabular-nums">{s.stock(formatNumber(station.stock))}</span>}
      {counts.length > 0 && <span className="text-zinc-400">{counts.join(' · ')}</span>}
      {station.permit && (
        <span title={s.permitHint} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-200 ring-1 ring-amber-400/25 ring-inset">
          {s.permit}
        </span>
      )}
      {station.access && (
        <span className={`text-xs ${station.access === 'all' ? 'text-zinc-400' : 'text-amber-200/70'}`}>{sell.access[station.access]}</span>
      )}
      {station.offerAt && (
        <span className={`text-xs ${age > OLD_AFTER_MS ? 'text-amber-200/70' : 'text-zinc-500'}`} title={age > OLD_AFTER_MS ? s.oldDataHint : undefined}>
          {age > MONTH_AFTER_MS ? s.dataFrom(formatMonthYear(station.offerAt)) : s.dataAge(formatRelative(station.offerAt, now))}
        </span>
      )}
      {place.systemAddress && (
        <InlineBookmark
          bookmark={station.bookmark ?? null}
          target={{ kind: 'station', systemAddress: place.systemAddress, systemName: place.systemName, title: station.name }}
        />
      )}
    </li>
  )
}

function Place({ place, now, onRouteTo }: { place: ShopPlaceView; now: number; onRouteTo: (system: string) => void }) {
  const here = place.distanceLy < 0.5
  return (
    <li className="py-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 font-medium break-words text-zinc-50">{place.systemName}</span>
          <CopyButton text={place.systemName} />
        </div>
        <div className="flex items-baseline gap-2 sm:block sm:shrink-0 sm:text-right">
          <div className="font-semibold whitespace-nowrap text-zinc-50 tabular-nums">{here ? t.route.youAreHere : formatLy(place.distanceLy)}</div>
          {!here && place.jumps ? <div className="text-xs whitespace-nowrap text-zinc-500">{t.route.jumps(place.jumps)}</div> : null}
        </div>
      </div>
      <ul className="mt-1 space-y-1">
        {place.stations.map((station) => (
          <Station key={station.name} station={station} now={now} place={place} />
        ))}
      </ul>
      {place.more > 0 && <p className="mt-1 text-xs text-zinc-500">{t.session.sell.more(place.more)}</p>}
      {!here && (
        <button
          type="button"
          onClick={() => onRouteTo(place.systemName)}
          title={t.route.goalHint.transit}
          className="focus-ring mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 hover:text-zinc-50 sm:h-8"
        >
          <Navigation className="size-3.5" aria-hidden />
          {t.session.sell.routeHere}
        </button>
      )}
    </li>
  )
}

function Status({ view, failed, onRetry }: { view: ShopView | null; failed: boolean; onRetry: () => void }) {
  const s = t.shop
  if (!view && !failed)
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400" role="status">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-zinc-500" aria-hidden />
        {s.loading}
      </p>
    )
  const text =
    !view || view.state === 'failed'
      ? s.failed
      : view.state === 'offline'
        ? s.offline
        : view.state === 'unknown_position'
          ? s.unknownPosition
          : view.state === 'unknown_item'
            ? s.unknownItem
            : view.places.length === 0 && !view.nearerCarrier
              ? view.item
                ? s.empty
                : s.emptyShops
              : null
  if (!text) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-400" role="status">
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

const ORDER_KEY = 'edk.shopOrder'
const ROLE_KEY = 'edk.shopRole'
/** Flipping waits this long before asking Spansh, so a quick flip through asks once. */
const FLIP_SETTLE_MS = 450

export function ShopScreen({ onRouteTo }: { onRouteTo: (system: string) => void }) {
  const s = t.shop
  const catalog = useShopCatalog()
  const now = useNow()
  // `symbol` is shown on the card; `query` is what the results are asked for (it trails a flip).
  const [symbol, setSymbol] = useState<string | null>(() => readStoredText(ITEM_KEY))
  const [query, setQuery] = useState<string | null>(symbol)
  const [carriers, setCarriers] = useState(() => readStored(CARRIERS_KEY, ['on', 'off'], 'off') === 'on')
  const [order, setOrder] = useState<ShipOrder>(() => readStored(ORDER_KEY, SHIP_ORDERS, 'price'))
  const [role, setRole] = useState<RoleFilter>(() => readStored(ROLE_KEY, ROLE_FILTERS, 'all'))
  const params: Record<string, string> = {}
  if (query) params.item = query
  if (carriers) params.carriers = 'true'
  const { data, error, refetch } = useView('shop', params)
  // The answer for the previous choice stays while the new one loads.
  const [last, setLast] = useState<ShopView | null>(null)
  if (data && data !== last) setLast(data)
  const view = data ?? last
  const settled = data !== null && query === symbol

  const flipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(flipTimer.current), [])
  const choose = (next: string | null, settle = 0) => {
    setSymbol(next)
    writeStored(ITEM_KEY, next ?? '')
    clearTimeout(flipTimer.current)
    if (settle) flipTimer.current = setTimeout(() => setQuery(next), settle)
    else setQuery(next)
  }
  const toggleCarriers = (on: boolean) => {
    setCarriers(on)
    writeStored(CARRIERS_KEY, on ? 'on' : 'off')
  }
  const changeOrder = (next: ShipOrder) => {
    setOrder(next)
    writeStored(ORDER_KEY, next)
  }
  const changeRole = (next: RoleFilter) => {
    setRole(next)
    writeStored(ROLE_KEY, next)
  }
  // The list and the card's arrows: the ships of the chosen type, in the chosen order.
  const ships = catalog ? orderShips(catalog.ships, order).filter((x) => fitsRole(x.symbol, role)) : []
  const top = useRef<HTMLDivElement>(null)
  /** Chosen in the search or the lists: on a phone the card is below them, so go there. */
  const chooseAndShow = (next: string) => {
    choose(next)
    if (window.matchMedia('(max-width: 1023px)').matches)
      requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const chosen = catalog && symbol ? lookup(catalog, symbol) : null
  const want: Want = chosen?.kind === 'module' ? chosen.variant : {}

  let card: ReactNode = null
  if (catalog && chosen?.kind === 'ship') {
    // A ship of another type than the filter's (chosen by words) stays; the arrows enter the list.
    const current = ships.find((x) => x.symbol === chosen.ship.symbol)
    card = (
      <ShipCard
        ship={chosen.ship}
        position={`${current ? ships.indexOf(current) + 1 : '–'} / ${ships.length}`}
        onStep={(step) => {
          const next = neighbour(ships, current, step)
          if (next) choose(next.symbol, FLIP_SETTLE_MS)
        }}
        order={order}
        onOrder={changeOrder}
        yours={settled ? (data?.rank ?? null) : null}
        onHangar={(name) => {
          const module = catalog.modules.find((m) => m.name === name)
          if (module) choose(variantFor(module).symbol)
        }}
      />
    )
  } else if (catalog && chosen?.kind === 'commodity') {
    const group = commoditiesOf(catalog, commodityGroup(chosen.commodity))
    card = (
      <CommodityCard
        commodity={chosen.commodity}
        category={categoryName(chosen.commodity.category)}
        position={`${group.indexOf(chosen.commodity) + 1} / ${group.length}`}
        onStep={(step) => {
          const next = neighbour(group, chosen.commodity, step)
          if (next) choose(next.symbol, FLIP_SETTLE_MS)
        }}
      />
    )
  } else if (catalog && chosen?.kind === 'module') {
    const group = catalog.modules.filter((m) => m.category === chosen.module.category)
    card = (
      <ModuleCard
        module={chosen.module}
        variant={chosen.variant}
        position={`${group.indexOf(chosen.module) + 1} / ${group.length}`}
        onStep={(step) => {
          const next = nextModule(catalog, chosen.module, chosen.variant, step)
          if (next) choose(next.symbol, FLIP_SETTLE_MS)
        }}
        onChoose={(next) => choose(next)}
      />
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <Picker
        catalog={catalog}
        chosen={chosen ? (chosen.kind === 'ship' ? chosen.ship.symbol : chosen.kind === 'commodity' ? chosen.commodity.symbol : chosen.module.name) : null}
        want={want}
        ships={ships}
        role={role}
        onRole={changeRole}
        onChoose={chooseAndShow}
      />
      <div ref={top} className="min-w-0 scroll-mt-20 space-y-4 lg:space-y-6">
        {card}
        <section aria-labelledby="shop-title" className="min-w-0 rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Label as="h2" id="shop-title" className="flex items-center gap-2">
              <ShoppingCart className="size-4" aria-hidden />
              {chosen ? s.whereToBuy : s.nearest}
            </Label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {chosen && (
                <button
                  type="button"
                  onClick={() => choose(null)}
                  title={s.backHint}
                  className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 ring-inset hover:bg-zinc-800 hover:text-zinc-50 sm:h-8"
                >
                  <X className="size-3.5" aria-hidden />
                  {s.back}
                </button>
              )}
              <CarriersSwitch on={carriers} onChange={toggleCarriers} />
            </div>
          </div>
          {view?.ship && view.pad && <p className="mt-3 text-xs text-zinc-500">{s.padNote(view.ship, t.session.sell.pad[view.pad])}</p>}

          <Status view={settled ? data : null} failed={error !== null} onRetry={refetch} />
          {view && !carriers && view.nearerCarrier && <NearerCarrier hint={view.nearerCarrier} onShow={() => toggleCarriers(true)} />}
          {view && view.places.length > 0 && (
            <ol className={`mt-1 divide-y divide-zinc-800/80 ${settled ? '' : 'opacity-60'}`}>
              {view.places.map((place) => (
                <Place key={place.systemAddress ?? place.systemName} place={place} now={now} onRouteTo={onRouteTo} />
              ))}
            </ol>
          )}
          {view && (view.searchedAt || view.carriers) && (
            <div className="mt-2 space-y-1 border-t border-zinc-800/80 pt-3 text-xs text-zinc-500">
              {view.searchedAt && (
                <p className="flex items-center gap-1.5">
                  <CommunityGlyph />
                  {s.source} · {formatRelative(view.searchedAt, now)}
                </p>
              )}
              {view.carriers && <p>{t.session.sell.carriers}</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

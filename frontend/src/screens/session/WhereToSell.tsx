import { LoaderCircle, Navigation, Store } from 'lucide-react'
import { useState } from 'react'
import { useView } from '../../api/hooks'
import type { SellCarrierHint, SellPlaceView, SellStationView, SellView } from '../../api/types'
import { CopyButton } from '../../components/CopyButton'
import { CommunityGlyph } from '../../components/SourceBadge'
import { Label } from '../../components/States'
import { HelpTip } from '../../guide/HelpTip'
import { t } from '../../i18n'
import { formatLs, formatLy, formatRelative } from '../../lib/format'
import { readStored, writeStored } from '../../lib/storage'

/** What you carry decides which badges stand out: the other kind is dimmed. */
interface Carrying {
  carto: boolean
  bio: boolean
}

function DataBadge({ on, carrying, label, hint, tone }: { on: boolean; carrying: boolean; label: string; hint: string; tone: string }) {
  if (!on) return null
  return (
    <span
      title={hint}
      className={`rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${carrying ? tone : 'bg-zinc-800/60 text-zinc-500 ring-zinc-700/60'}`}
    >
      {label}
    </span>
  )
}

function Station({ station, carrying, now }: { station: SellStationView; carrying: Carrying; now: number }) {
  const s = t.session.sell
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="min-w-0 break-words text-zinc-200">{station.name}</span>
      <span className="text-zinc-500">
        {s.kind[station.kind]}
        {station.distLs !== null && ` · ${formatLs(station.distLs)}`}
      </span>
      <DataBadge
        on={station.cartographics}
        carrying={carrying.carto}
        label={t.session.carto}
        hint={s.cartographicsHint}
        tone="bg-sky-500/10 text-sky-300 ring-sky-400/25"
      />
      <DataBadge
        on={station.genomics}
        carrying={carrying.bio}
        label={t.session.bio}
        hint={s.genomicsHint}
        tone="bg-emerald-500/10 text-emerald-300 ring-emerald-400/25"
      />
      {station.permit && (
        <span title={t.shop.permitHint} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-200 ring-1 ring-amber-400/25 ring-inset">
          {t.shop.permit}
        </span>
      )}
      {station.access && (
        <span className={`text-xs ${station.access === 'all' ? 'text-zinc-400' : 'text-amber-200/70'}`}>{s.access[station.access]}</span>
      )}
      {station.seenAt && <span className="text-xs text-amber-200/70">{s.seen(formatRelative(station.seenAt, now))}</span>}
      {station.docked && <span className="text-xs text-zinc-500">{s.docked}</span>}
    </li>
  )
}

function Place({
  place,
  carrying,
  localCarto,
  now,
  onRouteTo,
}: {
  place: SellPlaceView
  carrying: Carrying
  /** Unsold bodies of the system you are in (shown on that place). */
  localCarto: number
  now: number
  onRouteTo?: (system: string) => void
}) {
  const here = place.distanceLy < 0.5
  return (
    <li className="py-3">
      {place.nextJump && (
        <p className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-sky-300">
          <Navigation className="size-3.5" aria-hidden />
          {t.session.sell.nextJump}
        </p>
      )}
      {/* Phones: the distance goes under the name (long system names need the width). */}
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 font-medium break-words text-zinc-50">{place.systemName}</span>
          <CopyButton text={place.systemName} />
        </div>
        <div className="flex items-baseline gap-2 sm:block sm:shrink-0 sm:text-right">
          <div className="font-semibold whitespace-nowrap text-zinc-50 tabular-nums">
            {here ? t.route.youAreHere : formatLy(place.distanceLy)}
          </div>
          {!here && place.jumps ? <div className="text-xs whitespace-nowrap text-zinc-500">{t.route.jumps(place.jumps)}</div> : null}
        </div>
      </div>
      <ul className="mt-1 space-y-1">
        {place.stations.map((station) => (
          <Station key={station.name} station={station} carrying={carrying} now={now} />
        ))}
      </ul>
      {place.more > 0 && <p className="mt-1 text-xs text-zinc-500">{t.session.sell.more(place.more)}</p>}
      {!here && onRouteTo && (
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
      {here && localCarto > 0 && (
        <p className="mt-1 text-xs text-amber-200/70">{t.session.sell.localCarto(t.session.cartoBodies(localCarto))}</p>
      )}
    </li>
  )
}

function Status({ sell }: { sell: SellView }) {
  const s = t.session.sell
  const text =
    sell.state === 'pending'
      ? s.pending
      : sell.state === 'failed'
        ? s.failed
        : sell.state === 'offline'
          ? s.offline
          : sell.state === 'unknown_position'
            ? s.unknownPosition
            : sell.places.length === 0
              ? s.empty
              : null
  if (!text) return null
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400" role="status">
      {sell.state === 'pending' && <LoaderCircle className="size-4 shrink-0 animate-spin text-zinc-500" aria-hidden />}
      {text}
    </p>
  )
}

const CARRIERS_KEY = 'edk.sellCarriers'

/** Fleet carriers on or off: they move and their owner decides who docks, so off by default. */
export function CarriersSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const s = t.session.sell
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={s.carriersToggleHint}
      onClick={() => onChange(!on)}
      className={`focus-ring inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium ring-1 ring-inset transition-colors sm:h-8 ${
        on ? 'bg-sky-500/15 text-sky-200 ring-sky-400/30' : 'bg-zinc-800/70 text-zinc-400 ring-zinc-700 hover:text-zinc-200'
      }`}
    >
      <span
        aria-hidden
        className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-sky-400/70' : 'bg-zinc-600'}`}
      >
        <span className={`absolute top-0.5 size-3 rounded-full bg-zinc-50 transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {s.carriersToggle}
    </button>
  )
}

/** Carriers hidden, and one is nearer than every station: say so, and offer to show them. */
export function NearerCarrier({ hint, onShow }: { hint: SellCarrierHint; onShow: () => void }) {
  const s = t.session.sell
  const distance = `${formatLy(hint.distanceLy)}${hint.jumps ? ` (${t.route.jumps(hint.jumps)})` : ''}`
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-zinc-800/40 p-3 text-sm text-zinc-300 ring-1 ring-zinc-700/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="min-w-0">{s.nearerCarrier(hint.name, hint.systemName, distance)}</p>
      <button
        type="button"
        onClick={onShow}
        className="focus-ring h-10 shrink-0 self-start rounded-lg bg-zinc-800 px-3 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-700 sm:h-8 sm:self-auto"
      >
        {s.showCarriers}
      </button>
    </div>
  )
}

/** The nearest stations buying exploration and exobiology data (Spansh, and where you docked). */
export function WhereToSell({
  carrying,
  now,
  onRouteTo,
}: {
  carrying: Carrying
  now: number
  /** Plan a route that just gets to this system (the Route tab). */
  onRouteTo?: (system: string) => void
}) {
  const [carriers, setCarriers] = useState(() => readStored(CARRIERS_KEY, ['on', 'off'], 'off') === 'on')
  const { data } = useView('sell', carriers ? { carriers: 'true' } : undefined)
  // The other variant keeps showing while the one just switched to loads.
  const [last, setLast] = useState<SellView | null>(null)
  if (data && data !== last) setLast(data)
  const sell = data ?? last
  if (!sell) return null
  const s = t.session.sell
  const toggle = (on: boolean) => {
    setCarriers(on)
    writeStored(CARRIERS_KEY, on ? 'on' : 'off')
  }

  return (
    <section aria-labelledby="sell-title" className="rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <Label as="h2" id="sell-title" className="flex items-center gap-2">
            <Store className="size-4" aria-hidden />
            {s.title}
          </Label>
          <HelpTip topic="sell" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {sell.ship && (
            <span className="text-xs text-zinc-500">
              {sell.ship}
              {sell.pad && ` · ${s.pad[sell.pad]}`}
            </span>
          )}
          <CarriersSwitch on={carriers} onChange={toggle} />
        </div>
      </div>
      <Status sell={sell} />
      {!carriers && sell.nearerCarrier && <NearerCarrier hint={sell.nearerCarrier} onShow={() => toggle(true)} />}
      {sell.places.length > 0 && (
        <ol className="mt-1 divide-y divide-zinc-800/80">
          {sell.places.map((place) => (
            <Place
              key={place.systemAddress ?? place.systemName}
              place={place}
              carrying={carrying}
              localCarto={sell.hereCartoBodies}
              now={now}
              onRouteTo={onRouteTo}
            />
          ))}
        </ol>
      )}
      {(sell.searchedAt || sell.carriers) && (
        <div className="mt-2 space-y-1 border-t border-zinc-800/80 pt-3 text-xs text-zinc-500">
          {sell.searchedAt && (
            <p className="flex items-center gap-1.5">
              <CommunityGlyph />
              {s.source(formatRelative(sell.searchedAt, now))}
            </p>
          )}
          {sell.carriers && <p>{s.carriers}</p>}
        </div>
      )}
    </section>
  )
}

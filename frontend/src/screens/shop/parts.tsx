// Small pieces shared by the Shop screen and its cards.

import type { ReactNode } from 'react'
import type { ShopModuleView, ShopShipView, ShopVariantView } from '../../api/types'
import { Credits } from '../../components/Credits'
import { t } from '../../i18n'
import { optionsFor, variantFor, type Want } from './catalog'

/** The look of a choosable item: a chip, or a row of the ship list. */
const chipLook = (active: boolean) =>
  `ring-1 ring-inset transition-colors ${
    active ? 'bg-accent/15 font-medium text-zinc-50 ring-accent/50' : 'bg-zinc-800/50 text-zinc-300 ring-zinc-700/70 hover:bg-zinc-800 hover:text-zinc-50'
  }`

export function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`focus-ring min-h-9 rounded-lg px-2.5 py-1 text-left text-sm ${chipLook(active)}`}
    >
      {children}
    </button>
  )
}

/** A ship in the list: its name, landing pad and base price, so the list reads in the order it is sorted. */
export function ShipRow({ ship, active, onClick }: { ship: ShopShipView; active: boolean; onClick: () => void }) {
  const pad = ship.stats?.pad
  const price = ship.stats?.price
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 py-1 text-left text-sm ${chipLook(active)}`}
    >
      <span className="min-w-0 flex-1 break-words">{ship.name}</span>
      {pad && (
        <span title={t.session.sell.pad[pad]} className="shrink-0 font-mono text-xs text-zinc-500">
          {pad}
        </span>
      )}
      <span className="w-12 shrink-0 text-right font-mono text-xs text-zinc-400 tabular-nums">{price != null ? <Credits value={price} /> : '–'}</span>
    </button>
  )
}

export /** Class, mount, rating and guidance of the chosen module: only the choices that exist. */
function Variants({ module, variant, onChoose }: { module: ShopModuleView; variant: ShopVariantView; onChoose: (symbol: string) => void }) {
  const s = t.shop
  const options = optionsFor(module, variant)
  const set = (want: Want) => onChoose(variantFor(module, { ...variant, ...want }).symbol)
  const rows: { label: string; items: { key: string; label: string; active: boolean; want: Want }[] }[] = [
    { label: s.size, items: options.sizes.map((size) => ({ key: String(size), label: String(size), active: size === variant.size, want: { size } })) },
    { label: s.mount, items: options.mounts.map((mount) => ({ key: mount, label: s.mounts[mount], active: mount === variant.mount, want: { mount } })) },
    { label: s.rating, items: options.ratings.map((rating) => ({ key: rating, label: rating, active: rating === variant.rating, want: { rating } })) },
    {
      label: s.guidance,
      items: options.guidances.map((guidance) => ({ key: guidance, label: s.guidances[guidance], active: guidance === variant.guidance, want: { guidance } })),
    },
  ]
  return (
    <div className="mt-3 space-y-2">
      {rows
        .filter((row) => row.items.length > 1)
        .map((row) => (
          <div key={row.label} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs text-zinc-500">{row.label}</span>
            {row.items.map((item) => (
              <Chip key={item.key} active={item.active} onClick={() => set(item.want)}>
                {item.label}
              </Chip>
            ))}
          </div>
        ))}
    </div>
  )
}


// A planet's elements as the game lists them (the most first), the ones your engineering goals
// still miss highlighted (the Shop's goals; your stock from the journal).

import { Wrench } from 'lucide-react'
import { useView } from '../api/hooks'
import type { BodyMaterialView } from '../api/types'
import { t } from '../i18n'
import { formatNumber } from '../lib/format'

export function PlanetMaterials({ materials }: { materials: readonly BodyMaterialView[] }) {
  const { data } = useView('engineering')
  const missing = new Map((data?.needs ?? []).filter((n) => n.need > n.have).map((n) => [n.symbol, n.need - n.have]))
  const wanted = materials.some((m) => missing.has(m.symbol))
  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {materials.map((m) => {
          const short = missing.get(m.symbol)
          return (
            <li
              key={m.symbol}
              title={short ? t.body.materialShort(short) : m.grade ? t.shop.grade(m.grade) : undefined}
              className={`inline-flex items-baseline gap-1.5 rounded-lg px-2 py-1 text-sm ring-1 ring-inset ${
                short ? 'bg-amber-400/10 text-amber-100 ring-amber-300/40' : 'bg-zinc-800/40 text-zinc-300 ring-zinc-700/60'
              }`}
            >
              {short && <Wrench className="size-3 self-center text-amber-300" aria-hidden />}
              {m.name}
              <span className={`tabular-nums ${short ? 'text-amber-200/80' : 'text-zinc-500'}`}>{formatNumber(m.percent, 1)} %</span>
              {short && <span className="sr-only">{t.body.materialShort(short)}</span>}
            </li>
          )
        })}
      </ul>
      {wanted && <p className="mt-2 text-xs text-zinc-500">{t.body.materialsHint}</p>}
    </div>
  )
}

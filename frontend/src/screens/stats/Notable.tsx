import { Sparkles } from 'lucide-react'
import type { StatCount } from '../../api/types'
import { t } from '../../i18n'
import { formatNumber } from '../../lib/format'
import { NotableGlyph } from './NotableGlyph'
import { bigNumber } from './numbers'
import { Card, SubLabel } from './ui'

const PLANET_KEYS = ['elw', 'ww', 'aw', 'terraformable', 'landable_atmo', 'ringed', 'gg_water_life', 'gg_ammonia_life']
const STAR_KEYS = ['black_hole', 'neutron', 'white_dwarf', 'wolf_rayet', 'carbon', 'giant', 'blue_star']

function Tile({ kind, count }: { kind: string; count: number }) {
  const found = count > 0
  const label = t.stats.notableLabel[kind] ?? kind
  return (
    <li
      className={`flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 sm:gap-3 sm:px-2.5 ${found ? 'bg-zinc-800/40' : ''}`}
      title={found ? `${label}: ${formatNumber(count)}` : `${label}: ${t.stats.notFound}`}
    >
      <span className="shrink-0 [&>svg]:size-8 sm:[&>svg]:size-10">
        <NotableGlyph kind={kind} dim={!found} size={40} />
      </span>
      <div className="min-w-0">
        <div className={`text-lg leading-tight font-semibold proportional-nums ${found ? 'text-zinc-50' : 'text-zinc-600'}`}>
          {found ? bigNumber(count) : t.common.unknown}
        </div>
        <div className={`text-xs leading-snug hyphens-auto break-words ${found ? 'text-zinc-400' : 'text-zinc-600'}`}>{label}</div>
      </div>
    </li>
  )
}

export function Notable({ notable, className = '' }: { notable: readonly StatCount[]; className?: string }) {
  const counts = new Map(notable.map((n) => [n.key, n.count]))
  const known = new Set([...PLANET_KEYS, ...STAR_KEYS])
  // Codes the UI does not know yet still show up, at the end of the planets.
  const extra = notable.filter((n) => !known.has(n.key)).map((n) => n.key)
  const groups = [
    { title: t.stats.notablePlanets, keys: [...PLANET_KEYS, ...extra] },
    { title: t.stats.notableStars, keys: STAR_KEYS },
  ]
  const foundTotal = [...known, ...extra].filter((k) => (counts.get(k) ?? 0) > 0).length

  return (
    <Card
      id="stats-notable"
      title={t.stats.notable}
      icon={Sparkles}
      className={className}
      aside={
        <span className="text-xs text-zinc-500 tabular-nums">
          {foundTotal} / {known.size + extra.length}
        </span>
      }
    >
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.title}>
            <SubLabel className="mb-2">{g.title}</SubLabel>
            <ul className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-1.5">
              {g.keys.map((k) => (
                <Tile key={k} kind={k} count={counts.get(k) ?? 0} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

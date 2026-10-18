// Deaths: all-time totals next to the history of every death (newest first).
import { CarFront, ChevronDown, ChevronUp, Leaf, Map as MapIcon, PersonStanding, Rocket, ShieldCheck, Skull, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { DeathView, KillerView, StatsView } from '../../api/types'
import { Credits } from '../../components/Credits'
import { t } from '../../i18n'
import { exactCredits, formatCredits, formatNumber } from '../../lib/format'
import { bigNumber } from './numbers'
import { shipName } from './ships'
import { Card, MoreButton } from './ui'
import { eventDay, eventFull, eventTime } from '../../lib/when'

const CONTEXT_ICON: Record<DeathView['context'], LucideIcon> = {
  ship: Rocket,
  srv: CarFront,
  on_foot: PersonStanding,
}

/** Rows shown before "show all"; a list one longer than this is shown whole. */
const COLLAPSED = 5

function Total({ value, label, tone = 'text-zinc-50' }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="mt-1 text-sm text-zinc-400">{label}</dt>
      <dd className={`text-3xl font-semibold tracking-tight proportional-nums ${tone}`}>{value}</dd>
    </div>
  )
}

function Killer({ k }: { k: KillerView }) {
  const ship = shipName(k.ship)
  const meta = [ship, k.rank].filter(Boolean).join(' · ')
  return (
    <li className="min-w-0">
      <div className="truncate text-zinc-100" title={k.name ?? undefined}>
        {k.name ?? <span className="text-zinc-400">{t.stats.unknownKiller}</span>}
      </div>
      {meta && (
        <div className="truncate text-xs text-zinc-500" title={k.ship ? `${meta} (${k.ship})` : meta}>
          {meta}
        </div>
      )}
    </li>
  )
}

function LostLine({ icon: Icon, iconTone, text, value, estimate }: { icon: LucideIcon; iconTone: string; text: string; value: number; estimate?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <Icon className={`size-3.5 shrink-0 ${iconTone}`} aria-hidden />
      <span className="text-zinc-200">{text}</span>
      {value > 0 && (
        <>
          <span className="text-zinc-600" aria-hidden>
            ·
          </span>
          <span className="text-rose-300/85" title={`${estimate ? `${t.stats.estimate}: ` : ''}${exactCredits(value)}`}>
            {estimate && '≈ '}
            {formatCredits(value)}
          </span>
        </>
      )}
    </div>
  )
}

function DeathRow({ d }: { d: DeathView }) {
  const ContextIcon = CONTEXT_ICON[d.context] ?? Skull
  const bio = d.lostBioCount > 0 || d.lostBioValue > 0
  const carto = d.lostCartoBodies > 0 || d.lostCartoValue > 0
  const body = d.body && d.system && d.body.startsWith(`${d.system} `) ? d.body.slice(d.system.length + 1) : d.body
  const option = d.rebuyOption ? (t.stats.rebuyOption[d.rebuyOption] ?? d.rebuyOption) : null
  return (
    <tr className="align-top">
      <td className="py-3.5 pr-4" title={eventFull(d.at) ?? undefined}>
        <div className="font-medium whitespace-nowrap text-zinc-100">{eventDay(d.at) ?? t.common.unknown}</div>
        <div className="text-xs text-zinc-500 tabular-nums">{eventTime(d.at)}</div>
      </td>
      <td className="py-3.5 pr-4">
        <div className="truncate text-zinc-100" title={d.system ?? undefined}>
          {d.system ?? <span className="text-zinc-400">{t.stats.unknownSystem}</span>}
        </div>
        {body && (
          <div className="truncate text-xs text-zinc-500" title={d.body ?? undefined}>
            {body}
          </div>
        )}
      </td>
      <td className="py-3.5 pr-4">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800/70 px-2 py-0.5 text-xs whitespace-nowrap text-zinc-300">
          <ContextIcon className="size-3.5 text-zinc-400" aria-hidden />
          {t.stats.deathContext[d.context] ?? d.context}
        </span>
      </td>
      <td className="py-3.5 pr-4">
        {d.killers.length === 0 ? (
          <span className="text-zinc-500">{t.stats.noKiller}</span>
        ) : (
          <ul className="space-y-1.5">
            {d.killers.map((k, i) => (
              <Killer key={`${k.name}-${i}`} k={k} />
            ))}
          </ul>
        )}
      </td>
      <td className="space-y-1 py-3.5 pr-4">
        {bio && (
          <LostLine
            icon={Leaf}
            iconTone="text-emerald-400/70"
            text={t.stats.lostBio(d.lostBioCount, formatNumber(d.lostBioCount))}
            value={d.lostBioValue}
          />
        )}
        {carto && (
          <LostLine
            icon={MapIcon}
            iconTone="text-sky-400/70"
            text={t.stats.lostCarto(d.lostCartoBodies, formatNumber(d.lostCartoBodies))}
            value={d.lostCartoValue}
            estimate
          />
        )}
        {!bio && !carto && <span className="text-zinc-600">{t.stats.lostNothing}</span>}
      </td>
      <td className="py-3.5">
        {option ? (
          <>
            <div className="truncate text-zinc-300" title={option}>
              {option}
            </div>
            {d.rebuyCost !== null && (
              <div className="text-xs">
                {d.rebuyCost > 0 ? (
                  <Credits value={d.rebuyCost} className="text-zinc-200" />
                ) : (
                  <span className="text-zinc-500">{t.stats.rebuyFree}</span>
                )}
              </div>
            )}
          </>
        ) : d.rebuyCost !== null && d.rebuyCost > 0 ? (
          <Credits value={d.rebuyCost} className="text-zinc-200" />
        ) : (
          <span className="text-zinc-600">{t.common.unknown}</span>
        )}
      </td>
    </tr>
  )
}

function DeathTable({ deaths }: { deaths: readonly DeathView[] }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = deaths.length > COLLAPSED + 1
  const shown = collapsible && !expanded ? deaths.slice(0, COLLAPSED) : deaths
  const th = 'pb-2 pr-4 text-left text-[11px] font-medium tracking-wider text-zinc-500 uppercase'
  return (
    <div className="min-w-0">
      <div className="relative overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">{t.stats.deathHistory}</caption>
          <colgroup>
            <col className="w-[6.5rem]" />
            <col />
            <col className="w-[7.5rem]" />
            <col />
            <col className="w-[13.5rem]" />
            <col className="w-[9.5rem]" />
          </colgroup>
          <thead className="border-b border-zinc-800">
            <tr>
              <th scope="col" className={th}>
                {t.stats.deathCol.when}
              </th>
              <th scope="col" className={th}>
                {t.stats.deathCol.where}
              </th>
              <th scope="col" className={th}>
                {t.stats.deathCol.context}
              </th>
              <th scope="col" className={th}>
                {t.stats.deathCol.killers}
              </th>
              <th scope="col" className={th}>
                {t.stats.deathCol.lost}
              </th>
              <th scope="col" className={`${th} pr-0`}>
                {t.stats.deathCol.rebuy}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {shown.map((d, i) => (
              <DeathRow key={`${d.at}-${i}`} d={d} />
            ))}
          </tbody>
        </table>
      </div>
      {collapsible && (
        <div className="mt-3 border-t border-zinc-800/70 pt-3">
          <MoreButton onClick={() => setExpanded((v) => !v)} expanded={expanded}>
            {expanded ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            {expanded ? t.stats.collapse : t.stats.showAll(deaths.length)}
          </MoreButton>
        </div>
      )}
    </div>
  )
}

export function Deaths({ stats, className = '' }: { stats: StatsView; className?: string }) {
  const history = stats.deathHistory ?? []
  const deaths = Math.max(stats.deaths, history.length)
  if (deaths === 0 && stats.valueLost <= 0) {
    return (
      <Card id="stats-deaths" title={t.stats.deathHistory} icon={ShieldCheck} className={className}>
        <div className="flex items-center gap-4">
          <ShieldCheck className="size-9 shrink-0 text-emerald-400/80" aria-hidden />
          <div>
            <p className="text-base font-medium text-zinc-200">{t.stats.noDeaths}</p>
            <p className="mt-0.5 text-sm text-zinc-500">{t.stats.noDeathsHint}</p>
          </div>
        </div>
      </Card>
    )
  }

  const rebuy = history.reduce((a, d) => a + (d.rebuyCost ?? 0), 0)
  // Lost cartography is an estimate, so a total that includes it is one too (rows show "≈").
  const approx = history.some((d) => d.lostCartoValue > 0)
  return (
    <Card id="stats-deaths" title={t.stats.deathHistory} icon={Skull} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <dl className="flex flex-wrap gap-x-14 gap-y-5">
          <Total value={bigNumber(deaths)} label={t.stats.deaths(deaths)} />
          <Total
            value={
              <>
                {approx && <span className="mr-1 text-rose-300/50">≈</span>}
                <Credits value={stats.valueLost} />
              </>
            }
            label={t.stats.valueLost}
            tone="text-rose-300/90"
          />
          {rebuy > 0 && <Total value={<Credits value={rebuy} />} label={t.stats.rebuyTotal} tone="text-zinc-200" />}
        </dl>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-500 lg:text-right">{t.stats.lossesHint}</p>
      </div>
      {history.length > 0 && (
        <div className="mt-7">
          <DeathTable deaths={history} />
        </div>
      )}
    </Card>
  )
}

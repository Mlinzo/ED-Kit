import { CircleCheck, CircleDashed, Dna } from 'lucide-react'
import type { SpeciesView } from '../api/types'
import { HelpTip } from '../guide/HelpTip'
import { t } from '../i18n'
import { sortSpecies } from '../lib/body'
import { exactCredits, formatMeters } from '../lib/format'
import { codexNewStatus, type Tentative } from './codex'
import { CodexBadge } from './CodexBadge'
import { Credits } from './Credits'
import { SampleDots } from './SampleDots'

function statusLabel(s: SpeciesView): string {
  if (s.status === 'analysed') return t.species.analysed
  if (s.status === 'sampling') return t.species.sampling
  if (s.deduced) return t.species.predictedDeduced
  return s.certain ? t.species.predictedCertain : t.species.predicted
}

function StatusIcon({ s }: { s: SpeciesView }) {
  if (s.status === 'analysed') return <CircleCheck className="size-5 text-emerald-400" aria-hidden />
  if (s.status === 'sampling') return <Dna className="size-5 text-accent" aria-hidden />
  if (s.certain) return <Dna className="size-5 text-zinc-400" aria-hidden />
  return <CircleDashed className="size-5 text-zinc-600" aria-hidden />
}

export function SpeciesValue({
  s,
  className = '',
}: {
  s: Pick<SpeciesView, 'value' | 'bonusValue' | 'bonusRuledOut'>
  className?: string
}) {
  // Species missing from the catalog come with value 0: show "unknown", not "0".
  if (s.bonusValue <= 0) {
    return (
      <span className={`inline-flex flex-col items-end ${className}`} title={t.species.valueUnknown}>
        {t.common.unknown}
      </span>
    )
  }
  const bonus = s.value > 0 && s.bonusValue > s.value
  return (
    <span className={`inline-flex flex-col items-end ${className}`}>
      <Credits value={s.bonusValue} />
      {bonus && (
        <span
          className="text-[11px] font-normal text-zinc-500"
          title={`${t.species.baseValue}: ${exactCredits(s.value)} · ${t.species.withBonus}: ${exactCredits(s.bonusValue)}. ${t.species.bonusLikelyHint}`}
        >
          <span className="text-emerald-500/80">×{Math.round(s.bonusValue / s.value)}</span> {t.species.bonusLikely}
        </span>
      )}
      {s.bonusRuledOut && (
        <span className="text-[11px] font-normal text-zinc-500" title={t.species.bonusRuledOutHint}>
          {t.species.bonusRuledOut}
        </span>
      )}
    </span>
  )
}

/**
 * Sorted rows. The predicted candidates of one genus share a row (where its best one stands): one
 * bio signal is one genus, so only one of them grows here.
 */
function rows(species: readonly SpeciesView[]): SpeciesView[][] {
  const sorted = sortSpecies(species)
  const out: SpeciesView[][] = []
  const placed = new Set<string>()
  for (const s of sorted) {
    if (s.status !== 'predicted') out.push([s])
    else if (!placed.has(s.genus)) {
      placed.add(s.genus)
      out.push(sorted.filter((x) => x.status === 'predicted' && x.genus === s.genus))
    }
  }
  return out
}

/** "Ignis" for "Tussock Ignis" under its genus; a name not led by the genus stays whole. */
function epithet(s: SpeciesView): string {
  return s.species.startsWith(`${s.genus} `) ? s.species.slice(s.genus.length + 1) : s.species
}

function nameTone(s: SpeciesView): string {
  return s.status === 'predicted' && !s.certain ? 'text-zinc-300' : 'text-zinc-50'
}

function valueTone(s: SpeciesView): string {
  if (s.status !== 'predicted') return 'text-emerald-300'
  return s.certain ? 'text-zinc-200' : 'text-zinc-400'
}

function SpeciesRow({ s, help }: { s: SpeciesView; help: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 shrink-0">
        <StatusIcon s={s} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-medium ${nameTone(s)}`}>
            {s.species}
            {s.colour && <span className="font-normal text-zinc-400"> · {s.colour}</span>}
          </span>
          {codexNewStatus(s.codex) && (
            <CodexBadge status={s.codex} tentative={s.status === 'predicted' && !s.certain ? 'genus' : undefined} />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1" title={s.deduced ? t.species.deducedHint : undefined}>
            {statusLabel(s)}
            {help && <HelpTip topic="bio" />}
          </span>
          {s.status === 'sampling' && (
            <span className="inline-flex items-center gap-1.5">
              <SampleDots samples={s.samples} />
              <span className="text-zinc-400">{t.species.samples(s.samples)}</span>
            </span>
          )}
          <span aria-hidden>·</span>
          <span title={t.species.colonyRange}>{formatMeters(s.colonyRangeM)}</span>
          {/* New codex entries stand out next to the name; a known one is a quiet note here. */}
          {!codexNewStatus(s.codex) && <CodexBadge status={s.codex} size="sm" className="ml-1" />}
        </div>
      </div>
      <SpeciesValue s={s} className={`shrink-0 text-right text-base font-semibold ${valueTone(s)}`} />
    </li>
  )
}

/** The candidates of one genus: the genus with what is known of it, then each species it may be. */
function GenusRow({ candidates, help }: { candidates: readonly SpeciesView[]; help: boolean }) {
  const lead = candidates[0]
  // A new entry is sure only when the genus is, and every species it may be here would be one.
  const tentative: Tentative | undefined = !lead.certain
    ? 'genus'
    : candidates.every((s) => codexNewStatus(s.codex))
      ? undefined
      : 'species'
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 shrink-0">
        <StatusIcon s={lead} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`font-medium ${nameTone(lead)}`}>{lead.genus}</span>
          <span className="text-sm text-zinc-400" title={t.species.candidatesHint(lead.genus)}>
            {t.species.oneOf(candidates.length)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1" title={lead.deduced ? t.species.deducedHint : undefined}>
            {statusLabel(lead)}
            {help && <HelpTip topic="bio" />}
          </span>
          <span aria-hidden>·</span>
          <span title={t.species.colonyRange}>{formatMeters(lead.colonyRangeM)}</span>
        </div>
        <ul className="mt-2 space-y-2 border-l border-zinc-800 pl-3">
          {candidates.map((s) => (
            <li key={s.species} className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={nameTone(s)}>
                  {epithet(s)}
                  {s.colour && <span className="text-zinc-400"> · {s.colour}</span>}
                </span>
                {codexNewStatus(s.codex) ? (
                  <CodexBadge status={s.codex} tentative={tentative} />
                ) : (
                  <CodexBadge status={s.codex} size="sm" />
                )}
              </div>
              <SpeciesValue s={s} className={`shrink-0 text-right text-sm font-semibold ${valueTone(s)}`} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  )
}

export function SpeciesList({ species }: { species: readonly SpeciesView[] }) {
  const list = rows(species)
  const firstDeduced = list.find((row) => row[0].deduced)
  return (
    <ul className="divide-y divide-zinc-800/70">
      {list.map((row) =>
        row.length > 1 ? (
          <GenusRow key={row[0].genus} candidates={row} help={row === firstDeduced} />
        ) : (
          <SpeciesRow key={row[0].species} s={row[0]} help={row === firstDeduced} />
        ),
      )}
    </ul>
  )
}

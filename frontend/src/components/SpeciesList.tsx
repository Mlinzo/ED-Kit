import { CircleCheck, CircleDashed, Dna } from 'lucide-react'
import type { SpeciesView } from '../api/types'
import { t } from '../i18n'
import { sortSpecies } from '../lib/body'
import { exactCredits, formatMeters } from '../lib/format'
import { codexNewStatus } from './codex'
import { CodexBadge } from './CodexBadge'
import { Credits } from './Credits'
import { SampleDots } from './SampleDots'

function statusLabel(s: SpeciesView): string {
  if (s.status === 'analysed') return t.species.analysed
  if (s.status === 'sampling') return t.species.sampling
  return s.certain ? t.species.predictedCertain : t.species.predicted
}

function StatusIcon({ s }: { s: SpeciesView }) {
  if (s.status === 'analysed') return <CircleCheck className="size-5 text-emerald-400" aria-hidden />
  if (s.status === 'sampling') return <Dna className="size-5 text-accent" aria-hidden />
  if (s.certain) return <Dna className="size-5 text-zinc-400" aria-hidden />
  return <CircleDashed className="size-5 text-zinc-600" aria-hidden />
}

export function SpeciesValue({ s, className = '' }: { s: SpeciesView | { value: number; bonusValue: number }; className?: string }) {
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
          title={`${t.species.baseValue}: ${exactCredits(s.value)} · ${t.species.withBonus}: ${exactCredits(s.bonusValue)}`}
        >
          <span className="text-emerald-500/80">×{Math.round(s.bonusValue / s.value)}</span> {t.species.firstFootfall.toLowerCase()}
        </span>
      )}
    </span>
  )
}

/** Predicted candidates per genus: one bio signal is one genus, so only one of them grows here. */
function candidateCounts(species: readonly SpeciesView[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of species) if (s.status === 'predicted') counts.set(s.genus, (counts.get(s.genus) ?? 0) + 1)
  return counts
}

/** Sorted, with the candidates of one genus kept together (where its best one stands). */
function grouped(species: readonly SpeciesView[]): SpeciesView[] {
  const sorted = sortSpecies(species)
  const out: SpeciesView[] = []
  const placed = new Set<string>()
  for (const s of sorted) {
    if (s.status !== 'predicted') out.push(s)
    else if (!placed.has(s.genus)) {
      placed.add(s.genus)
      out.push(...sorted.filter((x) => x.status === 'predicted' && x.genus === s.genus))
    }
  }
  return out
}

export function SpeciesList({ species }: { species: readonly SpeciesView[] }) {
  const sorted = grouped(species)
  const candidates = candidateCounts(species)
  return (
    <ul className="divide-y divide-zinc-800/70">
      {sorted.map((s) => {
        const tone =
          s.status === 'predicted' && !s.certain
            ? 'text-zinc-400'
            : s.status === 'predicted'
              ? 'text-zinc-200'
              : 'text-emerald-300'
        return (
          <li key={s.species} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 shrink-0">
              <StatusIcon s={s} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`font-medium ${s.status === 'predicted' && !s.certain ? 'text-zinc-300' : 'text-zinc-50'}`}>
                  {s.species}
                </span>
                {codexNewStatus(s.codex) && (
                  <CodexBadge status={s.codex} tentative={s.status === 'predicted' && !s.certain} />
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                <span>{statusLabel(s)}</span>
                {s.status === 'predicted' && (candidates.get(s.genus) ?? 0) > 1 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-zinc-400" title={t.species.candidatesHint(s.genus)}>
                      {t.species.candidates(candidates.get(s.genus) ?? 0)}
                    </span>
                  </>
                )}
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
            <SpeciesValue s={s} className={`shrink-0 text-right text-base font-semibold ${tone}`} />
          </li>
        )
      })}
    </ul>
  )
}

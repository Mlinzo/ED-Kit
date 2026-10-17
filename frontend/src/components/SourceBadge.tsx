// Where body data comes from. The commander's own scans (journal) are the default and carry no
// marker; anything taken from a community database (Spansh / EDSM: other players' scans) is
// labelled everywhere it shows, in one colour (violet) with a database icon.

import { Database, ExternalLink, ScanLine } from 'lucide-react'
import type { BodyView, DataSource } from '../api/types'
import { t } from '../i18n'
import { communityText, isCommunity, sourceDate, sourceName, type SourceMarker } from './source'

const VIOLET = 'text-violet-300'

/** The bare community-data icon, decorative: for places that already say it in text / title. */
export function CommunityGlyph({ className = 'size-3' }: { className?: string }) {
  return <Database className={`${className} shrink-0 ${VIOLET}`} strokeWidth={2.5} aria-hidden />
}

/** Icon-only marker with its own tooltip (map labels). */
export function SourceIcon({ marker, className = 'size-3' }: { marker: SourceMarker; className?: string }) {
  return (
    <span title={marker.title} className="inline-flex shrink-0">
      <Database className={`${className} ${VIOLET}`} strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{marker.title}</span>
    </span>
  )
}

/** Icon + database name ("Spansh"), for list rows next to the body type. */
export function SourceTag({ marker, className = '' }: { marker: SourceMarker; className?: string }) {
  return (
    <span title={marker.title} className={`inline-flex shrink-0 items-center gap-1 font-medium ${VIOLET} ${className}`}>
      <Database className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      <span aria-hidden>{sourceName(marker.source)}</span>
      <span className="sr-only">{marker.title}</span>
    </span>
  )
}

/** Top of the details panel for a body known only from a database: whose data, and what to do. */
export function CommunityNotice({ body }: { body: BodyView }) {
  if (!isCommunity(body.source)) return null
  return (
    <div className="flex gap-3 rounded-xl bg-violet-500/[0.07] px-3 py-2.5 ring-1 ring-violet-400/20 ring-inset">
      <Database className={`mt-0.5 size-4 shrink-0 ${VIOLET}`} strokeWidth={2.25} aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="text-violet-100">{communityText(body.source, body.sourceAt)}</p>
        <p className="mt-0.5 text-xs text-zinc-400">{t.source.scanHint}</p>
      </div>
    </div>
  )
}

/** "ваш скан · 16 окт, 20:48" or "Spansh ↗ (данные других игроков) · 11 окт". */
function SourceValue({
  source,
  at,
  url,
  explain = true,
}: {
  source: DataSource
  at?: string | null
  url?: string | null
  /** Add "(данные других игроков)"; said once per list. */
  explain?: boolean
}) {
  const date = sourceDate(at ?? null, source === 'journal')
  const tail = date && <span className="text-zinc-500"> · {date}</span>
  if (!isCommunity(source)) {
    return (
      <>
        <span className="text-zinc-200">{t.source.journal}</span>
        {tail}
      </>
    )
  }
  const name = sourceName(source)
  return (
    <>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={t.source.open(name)}
          className="focus-ring inline-flex items-center gap-0.5 rounded font-medium text-violet-200 underline decoration-violet-400/40 underline-offset-2 hover:text-violet-100 hover:decoration-violet-300"
        >
          {name}
          <ExternalLink className="size-3" strokeWidth={2.25} aria-hidden />
          <span className="sr-only"> ({t.source.open(name)})</span>
        </a>
      ) : (
        <span className="font-medium text-violet-200">{name}</span>
      )}
      {explain && <span className="text-zinc-400"> ({t.source.others})</span>}
      {tail}
    </>
  )
}

/** "Источники": one row per piece of data (body, signals, genera) with where it comes from. */
export function SourceList({ body }: { body: BodyView }) {
  const rows: { key: string; label: string; source: DataSource; at?: string | null; url?: string | null }[] = [
    { key: 'body', label: t.source.body, source: body.source, at: body.sourceAt, url: body.sourceUrl },
  ]
  // Signals and genera have no date of their own (sourceAt is the body record's).
  if (body.signalsSource) {
    const label = body.signals.bio > 0 ? t.source.bioSignals : t.source.signals
    rows.push({ key: 'signals', label, source: body.signalsSource })
  }
  if (body.genusesSource) rows.push({ key: 'genuses', label: t.source.genuses, source: body.genusesSource })
  const firstCommunity = rows.findIndex((r) => isCommunity(r.source))

  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r, i) => {
        const community = isCommunity(r.source)
        const Icon = community ? Database : ScanLine
        return (
          <li key={r.key} className="flex items-start gap-2.5">
            <Icon
              className={`mt-0.5 size-4 shrink-0 ${community ? VIOLET : 'text-zinc-500'}`}
              strokeWidth={2.25}
              aria-hidden
            />
            <p className="min-w-0 leading-snug">
              <span className="text-zinc-500">{r.label}: </span>
              <SourceValue source={r.source} at={r.at} url={r.url} explain={i === firstCommunity} />
            </p>
          </li>
        )
      })}
    </ul>
  )
}

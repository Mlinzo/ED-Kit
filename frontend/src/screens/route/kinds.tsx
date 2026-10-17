import type { BodyKind, RouteBodyView } from '../../api/types'
import { t } from '../../i18n'

type Kind = BodyKind

/** Colour of each planet kind (close to how the bodies look). */
const KIND_STYLE: Record<Kind, string> = {
  elw: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  tww: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
  thmc: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  ww: 'bg-blue-500/15 text-blue-300 ring-blue-400/30',
  aw: 'bg-orange-500/15 text-orange-300 ring-orange-400/30',
  trocky: 'bg-stone-500/20 text-stone-300 ring-stone-400/30',
  bio: 'bg-lime-500/15 text-lime-300 ring-lime-400/30',
}

/** Short code of a planet kind (ELW, TWW, THMC …) in its colour. */
export function KindChip({ kind, dim = false }: { kind: Kind; dim?: boolean }) {
  return (
    <span
      title={t.route.kinds[kind]}
      className={`inline-flex h-5 min-w-9 items-center justify-center rounded px-1 text-[10px] font-semibold tracking-wide ring-1 ring-inset ${
        dim ? 'bg-zinc-800 text-zinc-500 ring-zinc-700' : KIND_STYLE[kind]
      }`}
    >
      {t.route.kindShort[kind]}
    </span>
  )
}

/** The body's chips: its mapping kind and/or BIO. */
export function BodyChips({ body, dim = false }: { body: RouteBodyView; dim?: boolean }) {
  return (
    <span className="inline-flex shrink-0 gap-1">
      {body.kind !== 'bio' && <KindChip kind={body.kind} dim={dim} />}
      {body.bioSignals > 0 && <KindChip kind="bio" dim={dim} />}
    </span>
  )
}

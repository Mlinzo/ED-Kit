// Every bookmark of yours in one list: find one (search, kind, tag), see how far it is, open it,
// edit it; and bookmark where you are now (the system, the body, your spot, your station).
import { Bookmark, BookmarkPlus, Check, Circle, Globe, MapPin, Orbit, Search, Store, X, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useLiveStatus, useView } from '../../api/hooks'
import type { BookmarkCategory, BookmarkHere, BookmarkHereRequest, BookmarkKind, BookmarkView, LiveStatus } from '../../api/types'
import { BookmarkBox, BookmarkForm } from '../../components/Bookmark'
import { bookmarkName, bookmarkWhere, CATEGORIES, CATEGORY_STYLE, useBookmarkActions, type BookmarkTarget } from '../../components/bookmarks'
import { EmptyState, Label, ViewFallback } from '../../components/States'
import { t } from '../../i18n'
import { formatLy, formatMeters } from '../../lib/format'
import { haversineM } from '../../lib/geo'
import { readStored, writeStored } from '../../lib/storage'

type KindFilter = 'all' | BookmarkKind
type TagFilter = 'all' | BookmarkCategory
type Sort = 'near' | 'latest'

const KINDS: readonly BookmarkKind[] = ['system', 'body', 'station', 'place']
const KIND_ICON: Record<BookmarkKind, LucideIcon> = { system: Orbit, body: Circle, station: Store, place: MapPin }

/** Search and filters survive leaving the tab; the order is remembered in this browser. */
const memory = { query: '', kind: 'all' as KindFilter, tag: 'all' as TagFilter }
const SORT_KEY = 'edk.bookmarks.sort'

function targetOf(b: BookmarkView): BookmarkTarget {
  return {
    kind: b.kind,
    systemAddress: b.systemAddress,
    bodyId: b.bodyId,
    lat: b.lat,
    lon: b.lon,
    title: b.title,
    systemName: b.systemName,
    bodyName: b.bodyName,
  }
}

function matches(b: BookmarkView, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = [bookmarkName(b), b.systemName, b.bodyName, b.comment, t.bookmarks.category[b.category]].join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}

/** Metres from you to a place on the planet you are on (Status.json), else null. */
function metresFromYou(b: BookmarkView, live: LiveStatus | null): number | null {
  if (b.kind !== 'place' || b.lat === null || b.lon === null || !live?.hasLatLong) return null
  if (live.lat === null || live.lon === null || !live.planetRadiusM || live.bodyName !== b.bodyName) return null
  return haversineM({ lat: live.lat, lon: live.lon }, { lat: b.lat, lon: b.lon }, live.planetRadiusM)
}

function sorted(items: readonly BookmarkView[], sort: Sort, live: LiveStatus | null): BookmarkView[] {
  if (sort === 'latest') return [...items]
  const key = (b: BookmarkView) => [b.distanceLy ?? Number.POSITIVE_INFINITY, metresFromYou(b, live) ?? Number.POSITIVE_INFINITY]
  return [...items].sort((a, b) => {
    const [la, ma] = key(a)
    const [lb, mb] = key(b)
    return la - lb || ma - mb
  })
}

function Chip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-colors ring-inset ${
        active ? 'bg-zinc-100 text-zinc-900 ring-zinc-100' : 'text-zinc-400 ring-zinc-800 hover:bg-zinc-900 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full lg:w-80">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.bookmarks.search}
        aria-label={t.bookmarks.search}
        spellCheck={false}
        className="focus-ring h-10 w-full rounded-xl bg-zinc-900 pr-10 pl-9 text-sm text-zinc-100 ring-1 ring-zinc-800 placeholder:text-zinc-500 focus:ring-zinc-700 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title={t.bookmarks.searchClear}
          aria-label={t.bookmarks.searchClear}
          className="focus-ring absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

type HereWhat = BookmarkHereRequest['what']

interface HereOption {
  what: HereWhat
  kind: BookmarkKind
  label: string
  marked: boolean
}

/** What you can bookmark where you are: the journal says the system, the body and the station, Status.json whether you are on the ground or docked. */
function hereOptions(here: BookmarkHere, live: LiveStatus | null, items: readonly BookmarkView[]): HereOption[] {
  if (here.systemAddress === null) return []
  const at = (kind: BookmarkKind, test: (b: BookmarkView) => boolean) => items.some((b) => b.kind === kind && b.systemAddress === here.systemAddress && test(b))
  const out: HereOption[] = [{ what: 'system', kind: 'system', label: here.systemName ?? here.systemAddress, marked: at('system', () => true) }]
  if (here.bodyId !== null) out.push({ what: 'body', kind: 'body', label: here.bodyName ?? String(here.bodyId), marked: at('body', (b) => b.bodyId === here.bodyId) })
  if (live?.hasLatLong && live.lat !== null && live.lon !== null && live.bodyName) out.push({ what: 'place', kind: 'place', label: t.bookmarks.hereSpot, marked: false })
  if (live?.docked && here.station) out.push({ what: 'station', kind: 'station', label: here.station, marked: at('station', (b) => b.title === here.station) })
  return out
}

function HerePanel({ here, items }: { here: BookmarkHere; items: readonly BookmarkView[] }) {
  const live = useLiveStatus()
  const actions = useBookmarkActions()
  const [open, setOpen] = useState<HereWhat | null>(null)
  const options = hereOptions(here, live, items)
  const chosen = options.find((o) => o.what === open)
  return (
    <section aria-labelledby="bookmarks-here" className="rounded-2xl bg-zinc-900/40 p-4 ring-1 ring-zinc-800">
      <Label as="h2" id="bookmarks-here">
        {t.bookmarks.hereTitle}
      </Label>
      {options.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{t.bookmarks.hereNone}</p>
      ) : (
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {options.map((o) => {
            const Icon = KIND_ICON[o.kind]
            return (
              <li key={o.what} className="min-w-0">
                <button
                  type="button"
                  disabled={o.marked}
                  aria-pressed={open === o.what}
                  onClick={() => setOpen(open === o.what ? null : o.what)}
                  title={o.marked ? t.bookmarks.marked : t.bookmarks.addLong}
                  className={`focus-ring flex min-h-10 max-w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm ring-1 ring-inset ${
                    o.marked
                      ? 'cursor-default text-zinc-500 ring-zinc-800'
                      : open === o.what
                        ? 'bg-amber-500/15 text-amber-100 ring-amber-400/40'
                        : 'bg-zinc-900/60 text-zinc-200 ring-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  <Icon className="size-4 shrink-0 text-zinc-400" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[11px] text-zinc-500">{t.bookmarks.kind[o.kind]}</span>
                    <span className="block font-medium break-words">{o.label}</span>
                  </span>
                  {o.marked ? <Check className="size-4 shrink-0 text-emerald-400" aria-label={t.bookmarks.marked} /> : <BookmarkPlus className="size-4 shrink-0 text-zinc-500" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {chosen && (
        <BookmarkForm
          key={chosen.what}
          initial={{ category: chosen.what === 'station' ? 'trade' : 'other', comment: '', title: '' }}
          saving={actions.saving}
          error={actions.error}
          onSave={async (draft) => {
            if (await actions.createHere({ what: chosen.what, category: draft.category, comment: draft.comment })) setOpen(null)
          }}
          onCancel={() => setOpen(null)}
          className="mt-3 max-w-xl"
        />
      )}
    </section>
  )
}

function Row({
  b,
  here,
  live,
  onOpenSystem,
  onShowSurface,
}: {
  b: BookmarkView
  here: BookmarkHere
  live: LiveStatus | null
  onOpenSystem: (address: string | null) => void
  onShowSurface: () => void
}) {
  const Icon = KIND_ICON[b.kind]
  const style = CATEGORY_STYLE[b.category]
  const inHere = b.systemAddress === here.systemAddress
  const metres = metresFromYou(b, live)
  const where = bookmarkWhere(b)
  const distance =
    metres !== null
      ? t.bookmarks.distance(formatMeters(metres))
      : inHere
        ? t.bookmarks.youAreHere
        : b.distanceLy !== null
          ? t.bookmarks.distance(formatLy(b.distanceLy))
          : null
  const button =
    'focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-800 px-3 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700 ring-inset hover:bg-zinc-700'
  return (
    <li className="rounded-2xl bg-zinc-900/40 p-3 ring-1 ring-zinc-800 sm:p-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-950/60 ring-1 ring-zinc-800 ${style.text}`}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words text-zinc-50 proportional-nums">{bookmarkName(b)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {[t.bookmarks.kind[b.kind], where, distance].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row">
          {metres !== null && (
            <button type="button" onClick={onShowSurface} className={button}>
              <Globe className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t.bookmarks.showOnGlobe}</span>
              <span className="sr-only sm:hidden">{t.bookmarks.showOnGlobe}</span>
            </button>
          )}
          <button type="button" onClick={() => onOpenSystem(inHere ? null : b.systemAddress)} className={button}>
            {t.bookmarks.open}
          </button>
        </div>
      </div>
      <BookmarkBox bookmark={b} target={targetOf(b)} compact className="mt-2.5" />
    </li>
  )
}

export function BookmarksScreen({
  onOpenSystem,
  onShowSurface,
}: {
  onOpenSystem: (address: string | null) => void
  onShowSurface: () => void
}) {
  const { data, error, refetch } = useView('bookmarks')
  const live = useLiveStatus()
  const [query, setQueryState] = useState(memory.query)
  const [kind, setKindState] = useState(memory.kind)
  const [tag, setTagState] = useState(memory.tag)
  const [sort, setSortState] = useState<Sort>(() => readStored(SORT_KEY, ['latest', 'near'], 'latest'))
  const setQuery = (v: string) => {
    memory.query = v
    setQueryState(v)
  }
  const setKind = (v: KindFilter) => {
    memory.kind = v
    setKindState(v)
  }
  const setTag = (v: TagFilter) => {
    memory.tag = v
    setTagState(v)
  }
  const setSort = (v: Sort) => {
    writeStored(SORT_KEY, v)
    setSortState(v)
  }

  const items = data?.items
  const searched = useMemo(() => (items ?? []).filter((b) => matches(b, query)), [items, query])
  const kindCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = { all: 0, system: 0, body: 0, station: 0, place: 0 }
    for (const b of searched) {
      if (tag !== 'all' && b.category !== tag) continue
      counts.all += 1
      counts[b.kind] += 1
    }
    return counts
  }, [searched, tag])
  const tagCounts = useMemo(() => {
    const counts: Record<TagFilter, number> = { all: 0, mining: 0, bio: 0, geo: 0, trade: 0, scenic: 0, other: 0 }
    for (const b of searched) {
      if (kind !== 'all' && b.kind !== kind) continue
      counts.all += 1
      counts[b.category] += 1
    }
    return counts
  }, [searched, kind])
  const shown = useMemo(
    () => sorted(searched.filter((b) => (kind === 'all' || b.kind === kind) && (tag === 'all' || b.category === tag)), sort, live),
    [searched, kind, tag, sort, live],
  )

  if (!data) return <ViewFallback error={error} onRetry={refetch} />

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">{t.bookmarks.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t.bookmarks.summary(data.items.length)}</p>
        </div>
        {data.items.length > 0 && <SearchBox value={query} onChange={setQuery} />}
      </section>

      <HerePanel here={data.here} items={data.items} />

      {data.items.length === 0 ? (
        <EmptyState icon={<Bookmark className="size-10" />} title={t.bookmarks.empty} />
      ) : (
        <>
          <div className="space-y-2.5">
            <div role="group" aria-label={t.bookmarks.filterLabel} className="flex flex-wrap gap-2">
              <Chip active={kind === 'all'} onClick={() => setKind('all')}>
                {t.bookmarks.allKinds} <span className="text-zinc-500 tabular-nums">{kindCounts.all}</span>
              </Chip>
              {KINDS.filter((k) => kindCounts[k] > 0 || kind === k).map((k) => (
                <Chip key={k} active={kind === k} onClick={() => setKind(kind === k ? 'all' : k)}>
                  {t.bookmarks.kinds[k]} <span className="text-zinc-500 tabular-nums">{kindCounts[k]}</span>
                </Chip>
              ))}
            </div>
            <div role="group" aria-label={t.bookmarks.tag} className="flex flex-wrap gap-2">
              <Chip active={tag === 'all'} onClick={() => setTag('all')}>
                {t.bookmarks.allTags}
              </Chip>
              {CATEGORIES.filter((c) => tagCounts[c] > 0 || tag === c).map((c) => {
                const Icon = CATEGORY_STYLE[c].icon
                return (
                  <Chip key={c} active={tag === c} onClick={() => setTag(tag === c ? 'all' : c)}>
                    <Icon className={`size-3.5 ${tag === c ? '' : CATEGORY_STYLE[c].text}`} aria-hidden />
                    {t.bookmarks.category[c]} <span className="text-zinc-500 tabular-nums">{tagCounts[c]}</span>
                  </Chip>
                )
              })}
            </div>
            <div role="group" aria-label={t.bookmarks.sortLabel} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">{t.bookmarks.sortLabel}</span>
              {(['latest', 'near'] as const).map((s) => (
                <Chip key={s} active={sort === s} onClick={() => setSort(s)}>
                  {t.bookmarks.sort[s]}
                </Chip>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState icon={<Search className="size-8" />} title={t.bookmarks.none} />
          ) : (
            <ul className="grid gap-3 xl:grid-cols-2">
              {shown.map((b) => (
                <Row key={b.id} b={b} here={data.here} live={live} onOpenSystem={onOpenSystem} onShowSurface={onShowSurface} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

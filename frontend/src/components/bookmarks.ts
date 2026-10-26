// Your bookmarks: the tags with their look, what a bookmark is called, and the hook that writes
// them (POST / PUT / DELETE /api/bookmarks).
import { Bookmark, Camera, Leaf, Mountain, Pickaxe, Store, type LucideIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useStore } from '../api/hooks'
import type { BookmarkCategory, BookmarkHereRequest, BookmarkPatch, BookmarkRequest, BookmarkView, Topic } from '../api/types'
import { t } from '../i18n'

export const CATEGORIES: readonly BookmarkCategory[] = ['mining', 'bio', 'geo', 'trade', 'scenic', 'other']

/** Each tag's icon and colours: `hex` for the globe and the map, the classes for chips and icons. */
export const CATEGORY_STYLE: Record<BookmarkCategory, { icon: LucideIcon; hex: string; text: string; chip: string }> = {
  mining: { icon: Pickaxe, hex: '#fbbf24', text: 'text-amber-300', chip: 'bg-amber-500/15 ring-amber-400/40 text-amber-100' },
  bio: { icon: Leaf, hex: '#a3e635', text: 'text-lime-300', chip: 'bg-lime-500/15 ring-lime-400/40 text-lime-100' },
  geo: { icon: Mountain, hex: '#fb7185', text: 'text-rose-300', chip: 'bg-rose-500/15 ring-rose-400/40 text-rose-100' },
  trade: { icon: Store, hex: '#60a5fa', text: 'text-blue-300', chip: 'bg-blue-500/15 ring-blue-400/40 text-blue-100' },
  scenic: { icon: Camera, hex: '#e879f9', text: 'text-fuchsia-300', chip: 'bg-fuchsia-500/15 ring-fuchsia-400/40 text-fuchsia-100' },
  other: { icon: Bookmark, hex: '#e4e4e7', text: 'text-zinc-300', chip: 'bg-zinc-500/15 ring-zinc-400/40 text-zinc-100' },
}

/** What a bookmark is about and where (a system you have not been to: its name and position). */
export type BookmarkTarget = Omit<BookmarkRequest, 'category' | 'comment'>

export function coords(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

/** The bookmarked thing's name: the system, the body, the station, the place (or its coordinates). */
export function bookmarkName(b: BookmarkView): string {
  if (b.kind === 'system') return b.systemName ?? b.systemAddress
  if (b.kind === 'body') return b.bodyName ?? `${b.systemName ?? b.systemAddress} · ${b.bodyId}`
  if (b.kind === 'station') return b.title ?? '?'
  return b.title ?? (b.lat !== null && b.lon !== null ? t.bookmarks.spot(coords(b.lat, b.lon)) : '?')
}

/** Where it is: the system for a body or a station, the body for a place; null for a system. */
export function bookmarkWhere(b: BookmarkView): string | null {
  if (b.kind === 'system') return null
  if (b.kind === 'place') return b.bodyName ? t.bookmarks.onBody(b.bodyName) : b.systemName ? t.bookmarks.inSystem(b.systemName) : null
  return b.systemName ? t.bookmarks.inSystem(b.systemName) : null
}

/** The views bookmarks show in, refetched after a change. */
const MARKED: readonly Topic[] = ['bookmarks', 'system', 'navroute', 'history', 'galaxy', 'surface', 'sell', 'shop']

/** Writes bookmarks: what an editor needs (from useBookmarkActions, or handed down where there is no store). */
export interface BookmarkActions {
  create: (req: BookmarkRequest) => Promise<BookmarkView | null>
  createHere: (req: BookmarkHereRequest) => Promise<BookmarkView | null>
  update: (id: number, patch: BookmarkPatch) => Promise<BookmarkView | null>
  remove: (id: number) => Promise<boolean>
  saving: boolean
  error: string | null
}

export function useBookmarkActions(): BookmarkActions {
  const store = useStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async <T>(call: () => Promise<T>, failed: T): Promise<T> => {
      setSaving(true)
      setError(null)
      try {
        return await call()
      } catch {
        setError(t.bookmarks.error)
        return failed
      } finally {
        setSaving(false)
        store.invalidate(MARKED)
      }
    },
    [store],
  )
  return useMemo(
    () => ({
      create: (req: BookmarkRequest) => run(() => store.transport.send<BookmarkView>('POST', '/api/bookmarks', req), null),
      createHere: (req: BookmarkHereRequest) => run(() => store.transport.send<BookmarkView>('POST', '/api/bookmarks/here', req), null),
      update: (id: number, patch: BookmarkPatch) =>
        run(() => store.transport.send<BookmarkView>('PUT', `/api/bookmarks/${id}`, patch), null),
      remove: (id: number) =>
        run(async () => {
          await store.transport.send('DELETE', `/api/bookmarks/${id}`)
          return true
        }, false),
      saving,
      error,
    }),
    [run, store, saving, error],
  )
}

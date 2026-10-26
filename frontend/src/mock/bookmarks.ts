// Bookmarks in the demo (?mock=1): kept in memory, written into the views as the backend does.
import type {
  BookmarkHereRequest,
  BookmarkPatch,
  BookmarkRequest,
  BookmarksView,
  BookmarkView,
  GalaxyView,
  HistoryView,
  LiveStatus,
  NavRouteView,
  SellView,
  ShopView,
  SurfaceView,
  SystemView,
} from '../api/types'

let lastId = 0

/** A bookmark with every field filled (tests and the demo). */
export function bookmarkOf(over: Partial<BookmarkView> = {}): BookmarkView {
  lastId += 1
  return {
    id: lastId,
    kind: 'system',
    systemAddress: '1',
    systemName: null,
    bodyId: null,
    bodyName: null,
    lat: null,
    lon: null,
    title: null,
    category: 'other',
    comment: '',
    createdAt: '2026-10-26T12:00:00Z',
    updatedAt: '2026-10-26T12:00:00Z',
    distanceLy: null,
    ...over,
  }
}

type Stored = BookmarkView & { pos: [number, number, number] | null }

/** Where you are in the demo: the system, and the live status. */
export interface DemoHere {
  system: SystemView
  status: () => LiveStatus
}

export function createMockBookmarks(here: DemoHere) {
  const marks = new Map<number, Stored>()

  const same = (req: { kind: string; systemAddress: string; bodyId?: number | null; title?: string | null }) =>
    [...marks.values()].find(
      (m) =>
        m.kind === req.kind &&
        m.systemAddress === req.systemAddress &&
        (req.kind === 'system' || (req.kind === 'body' && m.bodyId === req.bodyId) || (req.kind === 'station' && m.title === req.title)),
    )

  const create = (req: BookmarkRequest): BookmarkView => {
    if ((req.kind === 'body' || req.kind === 'place') && (req.bodyId === null || req.bodyId === undefined)) throw new Error('HTTP 422')
    if (req.kind === 'place' && (req.lat === null || req.lat === undefined || req.lon === null || req.lon === undefined)) throw new Error('HTTP 422')
    if (req.kind === 'station' && !req.title) throw new Error('HTTP 422')
    const known = req.kind !== 'place' ? same(req) : undefined
    if (known) return known
    const now = new Date().toISOString()
    const mark: Stored = {
      ...bookmarkOf({
        kind: req.kind,
        systemAddress: req.systemAddress,
        systemName: req.systemName ?? null,
        bodyId: req.kind === 'body' || req.kind === 'place' ? (req.bodyId ?? null) : null,
        bodyName: req.bodyName ?? null,
        lat: req.kind === 'place' ? (req.lat ?? null) : null,
        lon: req.kind === 'place' ? (req.lon ?? null) : null,
        title: req.title?.trim() || null,
        category: req.category ?? (req.kind === 'station' ? 'trade' : 'other'),
        comment: (req.comment ?? '').trim(),
        createdAt: now,
        updatedAt: now,
      }),
      pos: req.x !== undefined && req.y !== undefined && req.z !== undefined ? [req.x, req.y, req.z] : null,
    }
    marks.set(mark.id, mark)
    return mark
  }

  const createHere = (req: BookmarkHereRequest): BookmarkView => {
    const { system } = here
    const status = here.status()
    const address = system.address ?? ''
    const [x, y, z] = system.starPos ?? []
    const where = { systemAddress: address, systemName: system.name, ...(x !== undefined ? { x, y, z } : {}) }
    const extra = { category: req.category, comment: req.comment }
    if (req.what === 'system') return create({ kind: 'system', ...where, ...extra })
    const body = system.bodies.find((b) => b.name === status.bodyName)
    if (!body) throw new Error('HTTP 409')
    if (req.what === 'body') return create({ kind: 'body', ...where, bodyId: body.bodyId, bodyName: body.name, ...extra })
    if (req.what === 'place' && status.lat !== null && status.lon !== null)
      return create({ kind: 'place', ...where, bodyId: body.bodyId, bodyName: body.name, lat: status.lat, lon: status.lon, ...extra })
    throw new Error('HTTP 409') // not docked in the demo
  }

  const update = (id: number, patch: BookmarkPatch): BookmarkView => {
    const mark = marks.get(id)
    if (!mark) throw new Error('HTTP 404')
    if (patch.title !== undefined && mark.kind !== 'station') mark.title = patch.title?.trim() || null
    if (patch.category !== undefined) mark.category = patch.category
    if (patch.comment !== undefined) mark.comment = patch.comment.trim()
    mark.updatedAt = new Date().toISOString()
    return mark
  }

  const remove = (id: number) => {
    if (!marks.delete(id)) throw new Error('HTTP 404')
  }

  const plain = ({ pos: _pos, ...mark }: Stored): BookmarkView => ({ ...mark })
  const all = () => [...marks.values()]
  const systemOf = (address: string | null) => all().find((m) => m.kind === 'system' && m.systemAddress === address)

  /** The view with your bookmarks in it (`data` is a copy, changed in place). */
  const apply = (path: string, data: unknown): unknown => {
    if (path === '/api/view/system') {
      const view = data as SystemView
      const own = systemOf(view.address)
      view.bookmark = own ? plain(own) : null
      view.stations = all()
        .filter((m) => m.kind === 'station' && m.systemAddress === view.address)
        .map(plain)
      for (const b of view.bodies) {
        const mine = all().filter((m) => m.systemAddress === view.address && m.bodyId === b.bodyId)
        const body = mine.find((m) => m.kind === 'body')
        b.bookmark = body ? plain(body) : null
        b.places = mine.filter((m) => m.kind === 'place').map(plain)
      }
    } else if (path === '/api/view/surface') {
      const view = data as SurfaceView
      const body = view.body
      if (view.globe && body) view.globe.places = all().filter((m) => m.kind === 'place' && m.bodyId === body.bodyId && m.bodyName === view.globe?.bodyName).map(plain)
    } else if (path === '/api/view/navroute') {
      for (const h of (data as NavRouteView).hops) {
        const own = systemOf(h.address)
        h.bookmark = own ? plain(own) : null
      }
    } else if (path === '/api/view/history') {
      for (const e of (data as HistoryView).systems) {
        const own = systemOf(e.address)
        e.bookmark = own ? plain(own) : null
        e.innerBookmarks = all().filter((m) => m.systemAddress === e.address && m.kind !== 'system').length
      }
    } else if (path === '/api/view/galaxy') {
      const view = data as GalaxyView
      const at = new Map(view.systems.map((s) => [s.address, s]))
      const addresses = [...new Set(all().map((m) => m.systemAddress))]
      view.bookmarks = addresses.flatMap((address) => {
        const mine = all().filter((m) => m.systemAddress === address)
        const s = at.get(address)
        const pos = mine.find((m) => m.pos)?.pos ?? (s ? ([s.x, s.y, s.z] as const) : null)
        if (!pos) return []
        const own = mine.find((m) => m.kind === 'system')
        return [
          {
            address,
            name: mine.find((m) => m.systemName)?.systemName ?? s?.name ?? null,
            x: pos[0],
            y: pos[1],
            z: pos[2],
            bookmark: own ? plain(own) : null,
            inner: mine.filter((m) => m.kind !== 'system').length,
          },
        ]
      })
    } else if (path === '/api/view/sell' || path === '/api/view/shop') {
      for (const place of (data as SellView | ShopView).places) {
        for (const s of place.stations) {
          const found = all().find((m) => m.kind === 'station' && m.systemAddress === place.systemAddress && m.title === s.name)
          s.bookmark = found ? plain(found) : null
        }
      }
    } else if (path === '/api/view/bookmarks') {
      const view = data as BookmarksView
      const origin = here.system.starPos
      view.items = all()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
        .map((m) => ({
          ...plain(m),
          distanceLy: origin && m.pos ? Math.round(Math.hypot(m.pos[0] - origin[0], m.pos[1] - origin[1], m.pos[2] - origin[2]) * 100) / 100 : null,
        }))
    }
    return data
  }

  /** The bookmarks view before your bookmarks go in (`apply` fills them). */
  const view = (): BookmarksView => {
    const status = here.status()
    const body = here.system.bodies.find((b) => b.name === status.bodyName)
    return {
      items: [],
      here: {
        systemAddress: here.system.address,
        systemName: here.system.name,
        bodyId: body?.bodyId ?? null,
        bodyName: body?.name ?? null,
        station: null,
      },
    }
  }

  return { create, createHere, update, remove, apply, view }
}

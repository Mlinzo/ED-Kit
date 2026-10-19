// Notes in the demo (?mock=1): kept in memory, written into the views as the backend does.
import type { GalaxyView, HistoryView, NavRouteView, NoteRequest, SystemView } from '../api/types'

const key = (address: string, bodyId: number | null) => `${address}:${bodyId ?? -1}`

export function createMockNotes() {
  const notes = new Map<string, NoteRequest>()
  const systemNote = (address: string | null) => (address ? (notes.get(key(address, null))?.text ?? null) : null)

  const put = (req: NoteRequest) => {
    const k = key(req.systemAddress, req.bodyId)
    const text = req.text.trim()
    if (text) notes.set(k, { ...notes.get(k), ...req, text })
    else notes.delete(k)
  }

  /** The view with your notes in it (`data` is a copy, changed in place). */
  const apply = (path: string, data: unknown): unknown => {
    if (path === '/api/view/system') {
      const view = data as SystemView
      view.note = systemNote(view.address)
      for (const b of view.bodies) b.note = view.address ? (notes.get(key(view.address, b.bodyId))?.text ?? null) : null
    } else if (path === '/api/view/navroute') {
      for (const h of (data as NavRouteView).hops) h.note = systemNote(h.address)
    } else if (path === '/api/view/history') {
      for (const e of (data as HistoryView).systems) {
        e.note = systemNote(e.address)
        e.bodyNotes = [...notes.values()].filter((n) => n.systemAddress === e.address && n.bodyId !== null).length
      }
    } else if (path === '/api/view/galaxy') {
      const view = data as GalaxyView
      const at = new Map(view.systems.map((s) => [s.address, s]))
      view.notes = [...notes.values()].flatMap((n) => {
        if (n.bodyId !== null) return []
        const s = at.get(n.systemAddress)
        const x = n.x ?? s?.x
        const y = n.y ?? s?.y
        const z = n.z ?? s?.z
        if (x === undefined || y === undefined || z === undefined) return []
        return [{ address: n.systemAddress, name: n.systemName ?? s?.name ?? null, x, y, z, text: n.text }]
      })
    }
    return data
  }

  return { put, apply }
}

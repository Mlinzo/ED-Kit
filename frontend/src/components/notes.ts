// Writing your notes (PUT /api/notes): the target of a note and the hook the editors use.
import { useCallback, useMemo, useState } from 'react'
import { useStore } from '../api/hooks'
import type { NoteRequest } from '../api/types'
import { t } from '../i18n'

/** What the note is about: a system (bodyId null) or one of its bodies, and where (a system you have not been to). */
export type NoteTarget = Omit<NoteRequest, 'text'>

/** Writes notes: what an editor needs (from useSaveNote, or handed down where there is no store). */
export interface NoteSaver {
  save: (target: NoteTarget, text: string) => Promise<boolean>
  saving: boolean
  error: string | null
}

/** Saves a note; the views showing notes refetch afterwards. */
export function useSaveNote(): NoteSaver {
  const store = useStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useCallback(
    async (target: NoteTarget, text: string): Promise<boolean> => {
      setSaving(true)
      setError(null)
      try {
        await store.transport.send('PUT', '/api/notes', { ...target, text } satisfies NoteRequest)
        return true
      } catch {
        setError(t.notes.error)
        return false
      } finally {
        setSaving(false)
        store.invalidate(['system', 'navroute', 'history', 'galaxy'])
      }
    },
    [store],
  )
  return useMemo(() => ({ save, saving, error }), [save, saving, error])
}

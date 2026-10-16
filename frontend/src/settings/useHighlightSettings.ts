import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../api/hooks'
import type { HighlightSettings } from '../api/types'

export const DEFAULT_HIGHLIGHT: HighlightSettings = { dssMin: 500_000, bioMin: 2_000_000 }

// Demo mode has no backend: keep the values in memory for the session.
let demoSettings: HighlightSettings = DEFAULT_HIGHLIGHT

export interface HighlightSettingsState {
  settings: HighlightSettings | null
  saving: boolean
  error: string | null
  save: (next: HighlightSettings) => Promise<boolean>
}

/** Highlight thresholds stored by the backend (GET/PUT /api/settings). */
export function useHighlightSettings(): HighlightSettingsState {
  const store = useStore()
  const mock = store.transport.mock
  const [settings, setSettings] = useState<HighlightSettings | null>(mock ? demoSettings : null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mock) return
    const abort = new AbortController()
    store.transport
      .fetchJson<HighlightSettings>('/api/settings', abort.signal)
      .then(setSettings)
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => abort.abort()
  }, [store, mock])

  const save = useCallback(
    async (next: HighlightSettings): Promise<boolean> => {
      setSaving(true)
      setError(null)
      try {
        if (mock) {
          demoSettings = next
          setSettings(next)
          return true
        }
        const response = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setSettings((await response.json()) as HighlightSettings)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setSaving(false)
      }
    },
    [mock],
  )

  return { settings, saving, error, save }
}

// Small per-browser preferences (view mode, sort order, language) in localStorage, and per-tab
// state that survives a reload (the open tab) in sessionStorage.

export function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

/** A free-form stored string (null: none, or storage unavailable). */
export function readStoredText(key: string): string | null {
  try {
    return localStorage.getItem(key) || null
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable (private mode); the choice just won't persist.
  }
}

export function readSession<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = sessionStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : null
  } catch {
    return null
  }
}

export function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Unavailable: a reload just opens the default tab.
  }
}

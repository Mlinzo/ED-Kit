import { createContext, useContext } from 'react'

/** A part of the settings dialog to open at. */
export type SettingsFocus = 'journal' | 'phone'

export interface SettingsApi {
  /** Opens the settings dialog, at a part of it if one is given. */
  open: (focus?: SettingsFocus) => void
}

export const SettingsContext = createContext<SettingsApi>({ open: () => {} })

export const useSettings = () => useContext(SettingsContext)

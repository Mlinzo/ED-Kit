import { ChartNoAxesColumn, History, Orbit, Radar, Route, Wallet, type LucideIcon } from 'lucide-react'
import { ru } from '../i18n/ru'

export type Tab = 'system' | 'surface' | 'route' | 'session' | 'history' | 'stats'

export const TABS: ReadonlyArray<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'system', label: ru.tabs.system, icon: Orbit },
  { id: 'surface', label: ru.tabs.surface, icon: Radar },
  { id: 'route', label: ru.tabs.route, icon: Route },
  { id: 'session', label: ru.tabs.session, icon: Wallet },
  { id: 'history', label: ru.tabs.history, icon: History },
  { id: 'stats', label: ru.tabs.stats, icon: ChartNoAxesColumn },
]

export const tabId = (tab: Tab) => `tab-${tab}`
export const panelId = (tab: Tab) => `panel-${tab}`

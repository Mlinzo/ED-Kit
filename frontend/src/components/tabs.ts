import { ChartNoAxesColumn, Galaxy, History, Orbit, Radar, Route, Wallet, type LucideIcon } from 'lucide-react'
import { t } from '../i18n'

export type Tab = 'system' | 'surface' | 'route' | 'session' | 'history' | 'galaxy' | 'stats'

export const TABS: ReadonlyArray<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'system', label: t.tabs.system, icon: Orbit },
  { id: 'surface', label: t.tabs.surface, icon: Radar },
  { id: 'route', label: t.tabs.route, icon: Route },
  { id: 'session', label: t.tabs.session, icon: Wallet },
  { id: 'history', label: t.tabs.history, icon: History },
  { id: 'galaxy', label: t.tabs.galaxy, icon: Galaxy },
  { id: 'stats', label: t.tabs.stats, icon: ChartNoAxesColumn },
]

export const tabId = (tab: Tab) => `tab-${tab}`
export const panelId = (tab: Tab) => `panel-${tab}`

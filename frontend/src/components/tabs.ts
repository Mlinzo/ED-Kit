import { ChartNoAxesColumn, Galaxy, History, Orbit, Radar, Route, ShoppingCart, Wallet, type LucideIcon } from 'lucide-react'
import { t } from '../i18n'

export type Tab = 'system' | 'surface' | 'route' | 'session' | 'history' | 'galaxy' | 'shop' | 'stats'

export const TABS: ReadonlyArray<{ id: Tab; label: string; short: string; icon: LucideIcon }> = [
  { id: 'system', label: t.tabs.system, short: t.tabs.short.system, icon: Orbit },
  { id: 'surface', label: t.tabs.surface, short: t.tabs.short.surface, icon: Radar },
  { id: 'route', label: t.tabs.route, short: t.tabs.short.route, icon: Route },
  { id: 'session', label: t.tabs.session, short: t.tabs.short.session, icon: Wallet },
  { id: 'history', label: t.tabs.history, short: t.tabs.short.history, icon: History },
  { id: 'galaxy', label: t.tabs.galaxy, short: t.tabs.short.galaxy, icon: Galaxy },
  { id: 'shop', label: t.tabs.shop, short: t.tabs.short.shop, icon: ShoppingCart },
  { id: 'stats', label: t.tabs.stats, short: t.tabs.short.stats, icon: ChartNoAxesColumn },
]

export const tabId = (tab: Tab) => `tab-${tab}`
export const panelId = (tab: Tab) => `panel-${tab}`

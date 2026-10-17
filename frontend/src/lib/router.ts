// Pages have their own paths (/system, /route, /galaxy, ...; /system/<address> for a system from
// the history), so a page can be bookmarked, reloaded and reached with Back / Forward. The query
// (?mock=1) and the hash are kept as they are.

import { TABS, type Tab } from '../components/tabs'

export interface Page {
  tab: Tab
  /** A system from the history shown on the System tab; null: where you are. */
  address: string | null
}

const IDS = new Set<string>(TABS.map((x) => x.id))

/** The page of a path; null for "/" and paths that are not a page. */
export function parsePath(pathname: string): Page | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [tab, address, ...rest] = parts
  if (!tab || !IDS.has(tab) || rest.length > 0) return null
  if (address !== undefined) return tab === 'system' && /^\d+$/.test(address) ? { tab: 'system', address } : null
  return { tab: tab as Tab, address: null }
}

export function pathOf(page: Page): string {
  return page.tab === 'system' && page.address !== null ? `/system/${encodeURIComponent(page.address)}` : `/${page.tab}`
}

export const samePage = (a: Page, b: Page) => a.tab === b.tab && a.address === b.address

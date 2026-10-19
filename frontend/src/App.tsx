import { useCallback, useEffect, useState } from 'react'
import { useLiveStatusSelector, useView } from './api/hooks'
import { OfflineBanner } from './components/OfflineBanner'
import { BottomTabs } from './components/TabBar'
import { panelId, tabId, TABS, type Tab } from './components/tabs'
import { TopBar } from './components/TopBar'
import { Welcome } from './components/Welcome'
import { GuideProvider } from './guide/GuideProvider'
import { GalaxyScreen } from './screens/galaxy/GalaxyScreen'
import { HistoryScreen } from './screens/history/HistoryScreen'
import { RouteScreen } from './screens/route/RouteScreen'
import { SessionScreen } from './screens/session/SessionScreen'
import { StatsScreen } from './screens/stats/StatsScreen'
import { SurfaceScreen } from './screens/surface/SurfaceScreen'
import { SystemScreen } from './screens/system/SystemScreen'
import { parsePath, pathOf, type Page } from './lib/router'
import { readSession, writeSession } from './lib/storage'
import { SettingsProvider } from './settings/SettingsDialog'

/** The tab open last in this browser tab: where "/" leads. */
const TAB_KEY = 'edk.tab'

const here = () => window.location.pathname + window.location.search + window.location.hash
const urlOf = (page: Page) => pathOf(page) + window.location.search + window.location.hash

/** The page in the address bar; for "/" (or a path that is no page) the tab open last. */
function initialPage(): Page {
  const page = parsePath(window.location.pathname)
  if (page) return page
  const tab = readSession(
    TAB_KEY,
    TABS.map((x) => x.id),
  )
  return { tab: tab ?? 'system', address: null }
}

/**
 * Identifies the sampling run in progress near the commander, or null.
 *
 * "Near" means Status.json has lat/long (on foot, in an SRV, landed, or flying low/orbital
 * cruise over the body) — so hopping between colonies in the ship does not flap it — and the
 * body Status.json reports is the body of the scan (an unfinished scan elsewhere does not count).
 */
function useSurfaceLiveKey(): string | null {
  const hasLatLong = useLiveStatusSelector((s) => Boolean(s?.hasLatLong))
  const statusBody = useLiveStatusSelector((s) => s?.bodyName ?? null)
  const { data } = useView('surface')
  const scan = data?.activeScan
  if (!hasLatLong || !scan) return null
  const body = data.body
  if (body && statusBody && statusBody !== body.name) return null
  return `${body?.id64 ?? '?'}|${scan.species}`
}

export default function App() {
  // Every page has its path: it survives a reload (a language switch reloads the page) and Back /
  // Forward walk through the pages.
  const [page, setPage] = useState<Page>(initialPage)
  const tab = page.tab
  useEffect(() => writeSession(TAB_KEY, tab), [tab])
  // Pages set without a click (the first one, the automatic switches below) replace the address;
  // clicks push it (navigate) before the page changes, so there is nothing left to do then.
  useEffect(() => {
    if (here() !== urlOf(page)) window.history.replaceState(null, '', urlOf(page))
  }, [page])
  /** The system from the history last shown on the System tab: the tab returns to it. */
  const [pastAddress, setPastAddress] = useState<string | null>(page.address)
  if (tab === 'system' && page.address !== pastAddress) setPastAddress(page.address)
  const liveKey = useSurfaceLiveKey()
  const surfaceLive = liveKey !== null

  // Auto-switch to Surface when a sampling run starts (or resumes), and back when it ends —
  // but never against the user: any manual tab choice cancels the way back, and leaving
  // Surface by hand during a run keeps it closed until a different run starts.
  const [seenKey, setSeenKey] = useState<string | null>(null)
  const [autoFrom, setAutoFrom] = useState<Tab | null>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  if (liveKey !== seenKey) {
    setSeenKey(liveKey)
    if (liveKey !== null) {
      if (tab !== 'surface' && liveKey !== dismissedKey) {
        setAutoFrom(tab)
        setPage({ tab: 'surface', address: null })
      }
    } else {
      if (tab === 'surface' && autoFrom) setPage({ tab: autoFrom, address: autoFrom === 'system' ? pastAddress : null })
      setAutoFrom(null)
    }
  }

  // Back / Forward: the page in the address bar, chosen by the user like a click.
  useEffect(() => {
    const onPop = () => {
      setPage(parsePath(window.location.pathname) ?? { tab: 'system', address: null })
      setAutoFrom(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback(
    (next: Page) => {
      if (next.tab !== tab || next.address !== page.address) window.scrollTo({ top: 0 })
      if (here() !== urlOf(next)) window.history.pushState(null, '', urlOf(next))
      setPage(next)
      setAutoFrom(null)
      setDismissedKey(liveKey !== null && next.tab !== 'surface' ? liveKey : null)
    },
    [liveKey, page.address, tab],
  )

  const goTo = (next: Tab) => navigate({ tab: next, address: next === 'system' ? pastAddress : null })

  const selectTab = (next: Tab) => {
    // Choosing System again while looking at a past system returns to where you are.
    if (next === 'system' && tab === 'system') navigate({ tab: 'system', address: null })
    else goTo(next)
  }

  const openSystem = (address: string | null) => navigate({ tab: 'system', address })

  /** "Route here" from Where to sell: the Route tab opens its form on that system. */
  const [routeTo, setRouteTo] = useState<string | null>(null)
  const routeToUsed = useCallback(() => setRouteTo(null), [])
  const planRouteTo = (name: string) => {
    setRouteTo(name)
    goTo('route')
  }

  return (
    <GuideProvider>
      <SettingsProvider>
        <div className="flex min-h-dvh flex-col">
          <TopBar tab={tab} onTab={selectTab} surfaceLive={surfaceLive} />
          <main
            id={panelId(tab)}
            role="tabpanel"
            aria-labelledby={tabId(tab)}
            className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:px-6 lg:pt-8 lg:pb-12"
          >
            <OfflineBanner />
            {tab === 'system' && <Welcome />}
            {tab === 'system' && (
              <SystemScreen
                address={page.address}
                onOpenSystem={openSystem}
                onShowHistory={() => goTo('history')}
                onShowRoute={() => goTo('route')}
              />
            )}
            {tab === 'surface' && <SurfaceScreen />}
            {tab === 'route' && <RouteScreen prefill={routeTo} onPrefillUsed={routeToUsed} />}
            {tab === 'session' && <SessionScreen onRouteTo={planRouteTo} />}
            {tab === 'history' && <HistoryScreen onOpenSystem={openSystem} />}
            {tab === 'galaxy' && <GalaxyScreen onShowHistory={() => goTo('history')} />}
            {tab === 'stats' && <StatsScreen />}
          </main>
          <BottomTabs tab={tab} onTab={selectTab} surfaceLive={surfaceLive} />
        </div>
      </SettingsProvider>
    </GuideProvider>
  )
}

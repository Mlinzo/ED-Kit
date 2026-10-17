import { useEffect, useState } from 'react'
import { useLiveStatusSelector, useView } from './api/hooks'
import { OfflineBanner } from './components/OfflineBanner'
import { BottomTabs } from './components/TabBar'
import { panelId, tabId, TABS, type Tab } from './components/tabs'
import { TopBar } from './components/TopBar'
import { GalaxyScreen } from './screens/galaxy/GalaxyScreen'
import { HistoryScreen } from './screens/history/HistoryScreen'
import { RouteScreen } from './screens/route/RouteScreen'
import { SessionScreen } from './screens/session/SessionScreen'
import { StatsScreen } from './screens/stats/StatsScreen'
import { SurfaceScreen } from './screens/surface/SurfaceScreen'
import { SystemScreen } from './screens/system/SystemScreen'
import { readSession, writeSession } from './lib/storage'

const TAB_KEY = 'edk.tab'

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
  // The open tab survives a reload (a language switch reloads the page).
  const [tab, setTab] = useState<Tab>(
    () =>
      readSession(
        TAB_KEY,
        TABS.map((x) => x.id),
      ) ?? 'system',
  )
  useEffect(() => writeSession(TAB_KEY, tab), [tab])
  /** A system from the history shown on the System tab; null: the current system. */
  const [pastAddress, setPastAddress] = useState<string | null>(null)
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
        setTab('surface')
      }
    } else {
      if (tab === 'surface' && autoFrom) setTab(autoFrom)
      setAutoFrom(null)
    }
  }

  const goTo = (next: Tab) => {
    if (next !== tab) window.scrollTo({ top: 0 })
    setTab(next)
    setAutoFrom(null)
    setDismissedKey(liveKey !== null && next !== 'surface' ? liveKey : null)
  }

  const selectTab = (next: Tab) => {
    // Choosing System again while looking at a past system returns to where you are.
    if (next === 'system' && tab === 'system') setPastAddress(null)
    goTo(next)
  }

  const openSystem = (address: string | null) => {
    setPastAddress(address)
    goTo('system')
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar tab={tab} onTab={selectTab} surfaceLive={surfaceLive} />
      <main
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:px-6 lg:pt-8 lg:pb-12"
      >
        <OfflineBanner />
        {tab === 'system' && (
          <SystemScreen
            address={pastAddress}
            onOpenSystem={openSystem}
            onShowHistory={() => goTo('history')}
            onShowRoute={() => goTo('route')}
          />
        )}
        {tab === 'surface' && <SurfaceScreen />}
        {tab === 'route' && <RouteScreen />}
        {tab === 'session' && <SessionScreen />}
        {tab === 'history' && <HistoryScreen onOpenSystem={openSystem} />}
        {tab === 'galaxy' && <GalaxyScreen onOpenSystem={openSystem} onShowHistory={() => goTo('history')} />}
        {tab === 'stats' && <StatsScreen />}
      </main>
      <BottomTabs tab={tab} onTab={selectTab} surfaceLive={surfaceLive} />
    </div>
  )
}

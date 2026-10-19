import { FlaskConical, FolderOpen, FolderX, Wallet, X } from 'lucide-react'
import { useIngest, useStream, useView } from '../api/hooks'
import type { IngestState, SessionView } from '../api/types'
import { t } from '../i18n'
import { GuideButton } from '../guide/HelpTip'
import { formatCredits, formatNumber } from '../lib/format'
import { useSettings } from '../settings/context'
import { SettingsButton } from '../settings/SettingsDialog'
import { ConnectionIndicator } from './ConnectionIndicator'
import { Credits } from './Credits'
import { SupportLink } from './SupportLink'
import { TopTabs } from './TabBar'
import type { Tab } from './tabs'

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-accent" aria-hidden fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" strokeWidth="1.6" transform="rotate(-25 12 12)" opacity="0.7" />
    </svg>
  )
}

function exitMockHref(): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('mock')
  return url.pathname + url.search + url.hash
}

function MockBadge() {
  return (
    <a
      href={exitMockHref()}
      title={t.mock.exit}
      className="focus-ring relative inline-flex h-7 items-center gap-1.5 rounded-full after:absolute after:-inset-x-1 after:-inset-y-2.5 bg-sky-500/10 px-2.5 text-xs font-medium text-accent ring-1 ring-sky-500/30 ring-inset hover:bg-sky-500/20"
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {/* At 360 px the word pushes the bar past the screen edge: the flask and the cross say it. */}
      <span className="hidden whitespace-nowrap min-[400px]:inline sm:hidden">{t.mock.badgeShort}</span>
      <span className="hidden whitespace-nowrap sm:inline">{t.mock.badge}</span>
      <X className="size-3.5 opacity-70" aria-hidden />
      <span className="sr-only">{t.mock.exit}</span>
    </a>
  )
}

/**
 * What you would lose right now if the ship were destroyed: the unsold data, always in view
 * (amber: at risk). Hidden when everything is sold. Opens the Session tab.
 */
function AtRisk({ session, onOpen }: { session: SessionView; onOpen: () => void }) {
  if (session.atRiskValue <= 0) return null
  const hint = t.session.headerHint(formatCredits(session.unsoldCartoValue), formatCredits(session.unsoldBioValue))
  return (
    <button
      type="button"
      onClick={onOpen}
      title={hint}
      aria-label={`${t.session.headerLabel}: ${formatCredits(session.atRiskValue)}. ${hint}`}
      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors hover:bg-zinc-800/70"
    >
      <Wallet className="size-4 shrink-0 text-amber-400" aria-hidden />
      <span className="hidden text-zinc-500 2xl:inline">{t.session.headerLabel}</span>
      <Credits value={session.atRiskValue} className="font-semibold text-amber-300 tabular-nums" />
    </button>
  )
}

/**
 * No journal to read: the folder is missing, or has no journal files yet (the game was never run
 * there). Starting the game fixes both for a newcomer; anyone else picks the folder in the settings.
 */
function JournalProblem({ ingest }: { ingest: IngestState }) {
  const { open } = useSettings()
  return (
    <div className="border-t border-amber-500/20 bg-amber-500/10 text-sm text-amber-200">
      <div className="mx-auto flex max-w-[1600px] min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 lg:px-6">
        <FolderX className="size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 basis-60">
          <p>
            <span className="font-medium">{ingest.journalDirFound ? t.ingest.noJournals : t.ingest.dirMissing}</span>
            <span className="text-amber-200/80"> · {t.ingest.startGame}</span>
          </p>
          <code className="block truncate font-mono text-xs text-amber-100/70" title={ingest.journalDir}>
            {ingest.journalDir}
          </code>
        </div>
        <button
          type="button"
          onClick={() => open('journal')}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-400/15 px-3 text-sm font-medium text-amber-100 ring-1 ring-amber-400/30 ring-inset hover:bg-amber-400/25"
        >
          <FolderOpen className="size-4" aria-hidden />
          {t.ingest.choose}
        </button>
      </div>
    </div>
  )
}

function IngestStrip() {
  const ingest = useIngest()
  if (!ingest) return null

  if (!ingest.journalDirFound || (ingest.backfillDone && ingest.journalFiles === 0)) {
    return <JournalProblem ingest={ingest} />
  }
  if (ingest.backfillDone) return null

  const total = Math.max(1, ingest.filesTotal)
  const pct = Math.min(100, Math.round((ingest.filesDone / total) * 100))
  return (
    <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 pb-2 text-xs text-zinc-400 lg:px-6">
      <span className="shrink-0">{t.ingest.reading}</span>
      <div
        className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label={t.ingest.reading}
        aria-valuemin={0}
        aria-valuemax={ingest.filesTotal}
        aria-valuenow={ingest.filesDone}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0">
        {t.ingest.files(ingest.filesDone, ingest.filesTotal)} · {formatNumber(ingest.events)}
      </span>
    </div>
  )
}

export function TopBar({ tab, onTab, surfaceLive }: { tab: Tab; onTab: (t: Tab) => void; surfaceLive: boolean }) {
  const { mock } = useStream()
  const session = useView('session')
  const commander = session.data?.commander

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 lg:gap-6 lg:px-6 xl:gap-4 2xl:gap-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <span className="truncate text-[15px] font-semibold tracking-tight whitespace-nowrap text-zinc-100 max-[379px]:sr-only">{t.appName}</span>
        </div>
        <div className="hidden lg:block">
          <TopTabs tab={tab} onTab={onTab} surfaceLive={surfaceLive} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4 xl:gap-3 2xl:gap-4">
          {mock && <MockBadge />}
          {session.data && <AtRisk session={session.data} onOpen={() => onTab('session')} />}
          {/* Below 2xl the tabs, the unsold value and the app name need the room (the name is on the Session tab too). */}
          {commander && (
            <span className="hidden text-sm text-zinc-500 2xl:inline">
              {t.common.commander} <span className="font-medium text-zinc-200">{commander}</span>
            </span>
          )}
          <GuideButton />
          <SupportLink />
          <SettingsButton />
          <ConnectionIndicator />
        </div>
      </div>
      <IngestStrip />
    </header>
  )
}

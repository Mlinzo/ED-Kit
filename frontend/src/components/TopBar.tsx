import { FlaskConical, FolderX, X } from 'lucide-react'
import { useIngest, useStream, useView } from '../api/hooks'
import { t } from '../i18n'
import { formatNumber } from '../lib/format'
import { SettingsButton } from '../settings/SettingsDialog'
import { ConnectionIndicator } from './ConnectionIndicator'
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
      <span className="whitespace-nowrap sm:hidden">{t.mock.badgeShort}</span>
      <span className="hidden whitespace-nowrap sm:inline">{t.mock.badge}</span>
      <X className="size-3.5 opacity-70" aria-hidden />
      <span className="sr-only">{t.mock.exit}</span>
    </a>
  )
}

function IngestStrip() {
  const ingest = useIngest()
  if (!ingest) return null

  if (!ingest.journalDirFound) {
    return (
      <div className="border-t border-amber-500/20 bg-amber-500/10 text-sm text-amber-200">
        <div className="mx-auto flex max-w-[1600px] min-w-0 items-center gap-2 px-4 py-2 lg:px-6">
          <FolderX className="size-4 shrink-0" aria-hidden />
          <span className="shrink-0">{t.ingest.dirMissing}</span>
          <code className="min-w-0 truncate font-mono text-xs text-amber-100/80" title={ingest.journalDir}>
            {ingest.journalDir}
          </code>
        </div>
      </div>
    )
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
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 lg:gap-6 lg:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <span className="truncate text-[15px] font-semibold tracking-tight whitespace-nowrap text-zinc-100">{t.appName}</span>
        </div>
        <div className="hidden lg:block">
          <TopTabs tab={tab} onTab={onTab} surfaceLive={surfaceLive} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4">
          {mock && <MockBadge />}
          {commander && (
            <span className="hidden text-sm text-zinc-500 md:inline">
              {t.common.commander} <span className="font-medium text-zinc-200">{commander}</span>
            </span>
          )}
          <SettingsButton />
          <ConnectionIndicator />
        </div>
      </div>
      <IngestStrip />
    </header>
  )
}

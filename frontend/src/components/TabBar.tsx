import { useRef, type KeyboardEvent } from 'react'
import { t } from '../i18n'
import { panelId, tabId, TABS, type Tab } from './tabs'

interface TabProps {
  tab: Tab
  onTab: (tab: Tab) => void
  /** Show a live marker on the Surface tab (sampling in progress). */
  surfaceLive: boolean
}

function LiveDot() {
  return (
    <span className="relative flex size-2" aria-hidden>
      <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
      <span className="relative size-2 rounded-full bg-emerald-400" />
    </span>
  )
}

/** Desktop tabs in the top bar (ARIA tablist with arrow-key navigation). */
export function TopTabs({ tab, onTab, surfaceLive }: TabProps) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((x) => x.id === tab)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    const id = TABS[next].id
    onTab(id)
    refs.current[id]?.focus()
  }

  return (
    // Too little room (a wide right side, the demo's badge): the tabs scroll, the page does not.
    <div
      role="tablist"
      aria-label={t.tabs.label}
      onKeyDown={onKeyDown}
      className="flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] xl:gap-0.5 [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map(({ id, label, short, icon: Icon }) => {
        const active = id === tab
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el
            }}
            id={tabId(id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={active ? panelId(id) : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(id)}
            title={label}
            className={`focus-ring flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors xl:px-2 ${
              active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <Icon className={`size-4 ${active ? 'text-accent' : ''}`} aria-hidden />
            {/* Icons only below 1440 px, the short names from there: ten full names do not fit next to the rest of the bar. */}
            {short !== label && (
              <span aria-hidden className="hidden min-[1440px]:inline">
                {short}
              </span>
            )}
            <span className={short !== label ? 'sr-only' : 'sr-only min-[1440px]:not-sr-only'}>{label}</span>
            {id === 'surface' && surfaceLive && (
              <>
                <LiveDot />
                <span className="sr-only">{t.tabs.surfaceActive}</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Phone tabs: fixed bottom bar with large touch targets. */
export function BottomTabs({ tab, onTab, surfaceLive }: TabProps) {
  return (
    <nav
      aria-label={t.tabs.label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/80 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {TABS.map(({ id, label, short, icon: Icon }) => {
          const active = id === tab
          return (
            // From 360 px a cell is as wide as its label needs (ten tabs: 36 px each would cut a few
            // Russian ones by a pixel or four), and below 390 px the labels are a pixel smaller to
            // keep a gap between them; narrower than 360 px, labels are cut.
            <li key={id} className="min-w-0 flex-1 min-[360px]:min-w-min">
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-controls={active ? panelId(id) : undefined}
                onClick={() => onTab(id)}
                className={`focus-ring relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[10px] font-medium max-[390px]:text-[9px] tracking-tight ${
                  active ? 'text-accent' : 'text-zinc-400 active:text-zinc-200'
                }`}
              >
                {active && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent" aria-hidden />}
                <span className="relative">
                  <Icon className="size-6" aria-hidden />
                  {id === 'surface' && surfaceLive && (
                    <span className="absolute -top-0.5 -right-1.5">
                      <LiveDot />
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate tracking-tighter" aria-hidden={short !== label}>
                  {short}
                </span>
                {short !== label && <span className="sr-only">{label}</span>}
                {id === 'surface' && surfaceLive && <span className="sr-only">{t.tabs.surfaceActive}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

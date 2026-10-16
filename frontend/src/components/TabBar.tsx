import { useRef, type KeyboardEvent } from 'react'
import { ru } from '../i18n/ru'
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
    const i = TABS.findIndex((t) => t.id === tab)
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
    <div role="tablist" aria-label={ru.tabs.label} onKeyDown={onKeyDown} className="flex items-center gap-1">
      {TABS.map(({ id, label, icon: Icon }) => {
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
            className={`focus-ring flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
              active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
            }`}
          >
            <Icon className={`size-4 ${active ? 'text-accent' : ''}`} aria-hidden />
            {label}
            {id === 'surface' && surfaceLive && (
              <>
                <LiveDot />
                <span className="sr-only">{ru.tabs.surfaceActive}</span>
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
      aria-label={ru.tabs.label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800/80 bg-zinc-950/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-controls={active ? panelId(id) : undefined}
                onClick={() => onTab(id)}
                className={`focus-ring relative flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium ${
                  active ? 'text-accent' : 'text-zinc-400 active:text-zinc-200'
                }`}
              >
                {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" aria-hidden />}
                <span className="relative">
                  <Icon className="size-6" aria-hidden />
                  {id === 'surface' && surfaceLive && (
                    <span className="absolute -top-0.5 -right-1.5">
                      <LiveDot />
                    </span>
                  )}
                </span>
                {label}
                {id === 'surface' && surfaceLive && <span className="sr-only">{ru.tabs.surfaceActive}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

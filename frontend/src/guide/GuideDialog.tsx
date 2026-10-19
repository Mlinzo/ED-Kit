import { AppWindow, BookOpen, ExternalLink, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import { LOOP, searchTopics, SECTIONS, SOURCES, type SectionId, type TopicId } from './topics'

const topicDomId = (id: TopicId) => `guide-${id}`
const sectionDomId = (id: SectionId) => `guide-section-${id}`

function topicText(id: TopicId): string {
  const topic = t.guide.topics[id]
  return [topic.title, topic.short, ...topic.body, topic.inApp].join(' ')
}

/** Scrolls the guide to an element and moves focus there (screen readers read on from it). */
function jumpTo(domId: string) {
  const el = document.getElementById(domId)
  if (!el) return
  el.focus({ preventScroll: true })
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
}

/**
 * The guide: a panel on the right (full screen on a phone) over the app, which is made inert while
 * it is open. Opened at a topic, it scrolls there and marks it.
 */
export function GuideDialog({ topic, onClose }: { topic: TopicId | null; onClose: () => void }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<TopicId | null>(topic)
  const found = useMemo(() => searchTopics(query, topicText), [query])
  const searching = query.trim() !== ''

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const app = document.getElementById('root')
    if (app) app.inert = true
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    const start = topic && document.getElementById(topicDomId(topic))
    if (start) {
      start.focus({ preventScroll: true })
      start.scrollIntoView({ block: 'start' })
    } else {
      panel.current?.focus()
    }
    return () => {
      if (app) app.inert = false
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [topic])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const showTopic = (id: TopicId) => {
    setTarget(id)
    jumpTo(topicDomId(id))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-zinc-950 shadow-2xl outline-none motion-safe:animate-[drawer-in_180ms_ease-out] sm:max-w-xl sm:border-l sm:border-zinc-800"
      >
        <header className="shrink-0 border-b border-zinc-800/80 pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center gap-2.5 px-4">
            <BookOpen className="size-5 shrink-0 text-accent" aria-hidden />
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-50">
              {t.guide.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
            >
              <X className="size-5" aria-hidden />
              <span className="sr-only">{t.guide.close}</span>
            </button>
          </div>
          <div className="px-4 pb-3">
            <label className="relative block">
              <span className="sr-only">{t.guide.search}</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.guide.searchPlaceholder}
                className="h-10 w-full rounded-lg bg-zinc-900 pr-3 pl-9 text-sm text-zinc-100 ring-1 ring-zinc-800 ring-inset placeholder:text-zinc-600 focus:ring-sky-500/60 focus:outline-none"
              />
            </label>
            {!searching && (
              <nav aria-label={t.guide.sectionsLabel} className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jumpTo(sectionDomId(s.id))}
                    className="focus-ring h-9 shrink-0 rounded-full bg-zinc-900 px-3 text-xs font-medium whitespace-nowrap text-zinc-300 ring-1 ring-zinc-800 ring-inset hover:text-zinc-50 hover:ring-zinc-600"
                  >
                    {t.guide.sections[s.id]}
                  </button>
                ))}
              </nav>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
          {searching ? (
            found.length > 0 ? (
              <div className="space-y-3">
                {found.map((id) => (
                  <Topic key={id} id={id} marked={false} />
                ))}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-zinc-500">{t.guide.nothingFound}</p>
            )
          ) : (
            <>
              <p className="text-sm text-zinc-400">{t.guide.intro}</p>
              <Loop onShow={showTopic} />
              {SECTIONS.map((s) => (
                <section key={s.id} aria-labelledby={sectionDomId(s.id)} className="mt-8">
                  <h3
                    id={sectionDomId(s.id)}
                    tabIndex={-1}
                    className="scroll-mt-4 text-xs font-medium tracking-wide text-zinc-500 uppercase outline-none"
                  >
                    {t.guide.sections[s.id]}
                  </h3>
                  <div className="mt-3 space-y-3">
                    {s.topics.map((id) => (
                      <Topic key={id} id={id} marked={id === target} />
                    ))}
                  </div>
                </section>
              ))}
              <p className="mt-8 text-xs text-zinc-600">{t.guide.checked}</p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Loop({ onShow }: { onShow: (id: TopicId) => void }) {
  return (
    <section aria-labelledby="guide-loop" className="mt-5 rounded-xl bg-zinc-900/40 p-2 ring-1 ring-zinc-800 ring-inset">
      <h3 id="guide-loop" className="px-2 pt-2 pb-1 text-sm font-semibold text-zinc-100">
        {t.guide.loopTitle}
      </h3>
      <ol>
        {t.guide.loop.map((step, i) => (
          <li key={LOOP[i]}>
            <button
              type="button"
              onClick={() => onShow(LOOP[i])}
              className="focus-ring flex w-full gap-3 rounded-lg p-2 text-left text-sm text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-50"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sky-500/15 text-xs font-semibold text-accent" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">{step}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Topic({ id, marked }: { id: TopicId; marked: boolean }) {
  const topic = t.guide.topics[id]
  const titleId = `${topicDomId(id)}-title`
  return (
    <article
      id={topicDomId(id)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={`scroll-mt-3 rounded-xl p-4 ring-1 outline-none ring-inset ${
        marked ? 'bg-sky-500/[0.06] ring-sky-400/45' : 'bg-zinc-900/40 ring-zinc-800'
      }`}
    >
      <h4 id={titleId} className="text-[15px] font-semibold text-zinc-50">
        {topic.title}
      </h4>
      <p className="mt-1.5 text-sm font-medium text-zinc-200">{topic.short}</p>
      {topic.body.map((text) => (
        <p key={text} className="mt-2 text-sm leading-relaxed text-zinc-400">
          {text}
        </p>
      ))}
      <p className="mt-3 flex gap-2 rounded-lg bg-sky-500/[0.07] px-3 py-2 text-sm text-sky-100/90">
        <AppWindow className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0">
          <span className="font-medium text-accent-strong">{t.guide.inApp}:</span> {topic.inApp}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-zinc-500">{t.guide.sources}:</span>
        {SOURCES[id].map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
          >
            <span className="min-w-0">
              <span className="font-medium text-zinc-100">{source.site}</span> · {source.page}
            </span>
            <ExternalLink className="size-3 shrink-0 text-zinc-500" aria-hidden />
          </a>
        ))}
      </div>
    </article>
  )
}

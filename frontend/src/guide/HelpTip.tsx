import { BookOpen, CircleHelp } from 'lucide-react'
import { t } from '../i18n'
import { useGuide } from './context'
import type { TopicId } from './topics'

/**
 * A small "?" next to a game term: opens the guide at its topic. The hover title gives the one-line
 * explanation; the hit area reaches 40 px for touch. Never put it inside another button.
 */
export function HelpTip({ topic, className = '' }: { topic: TopicId; className?: string }) {
  const { open } = useGuide()
  const { title, short } = t.guide.topics[topic]
  return (
    <button
      type="button"
      onClick={() => open(topic)}
      title={short}
      aria-label={t.guide.about(title)}
      data-no-snapshot
      className={`focus-ring relative inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle text-zinc-500 normal-case after:absolute after:-inset-3 hover:text-accent-strong ${className}`}
    >
      <CircleHelp className="size-3.5" aria-hidden />
    </button>
  )
}

/** Book in the top bar: the whole guide. */
export function GuideButton() {
  const { open } = useGuide()
  return (
    <button
      type="button"
      onClick={() => open()}
      title={t.guide.open}
      aria-haspopup="dialog"
      className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
    >
      <BookOpen className="size-5" aria-hidden />
      <span className="sr-only">{t.guide.open}</span>
    </button>
  )
}

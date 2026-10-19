import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { HelpTip } from '../../guide/HelpTip'
import type { TopicId } from '../../guide/topics'

export function Card({
  id,
  title,
  icon: Icon,
  help,
  aside,
  className = '',
  children,
}: {
  id: string
  title: string
  icon: LucideIcon
  help?: TopicId
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-2xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800 sm:p-6 ${className}`}>
      <div className="mb-5 flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">
          <Icon className="size-4 text-zinc-500" aria-hidden />
          {title}
          {help && <HelpTip topic={help} />}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Quiet text button for "show more" / "collapse" inside a card. */
export function MoreButton({
  onClick,
  expanded,
  children,
  className = '',
}: {
  onClick: () => void
  expanded?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={`focus-ring relative inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-400 ring-1 ring-zinc-800 after:absolute after:-inset-1 hover:bg-zinc-800 hover:text-zinc-200 ${className}`}
    >
      {children}
    </button>
  )
}

/** Small uppercase sub-heading inside a card. */
export function SubLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-[11px] font-medium tracking-wider text-zinc-500 uppercase ${className}`}>{children}</h3>
}

/** A labelled figure: value on top (proportional figures), label below. */
export function Figure({
  value,
  label,
  detail,
  size = 'md',
  className = '',
}: {
  value: ReactNode
  label: ReactNode
  detail?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const text = size === 'lg' ? 'text-4xl sm:text-5xl' : size === 'md' ? 'text-2xl sm:text-3xl' : 'text-xl'
  return (
    <div className={`flex min-w-0 flex-col-reverse ${className}`}>
      <dt className="mt-1 text-sm text-zinc-400">
        {label}
        {detail && <span className="mt-0.5 block text-xs text-zinc-500">{detail}</span>}
      </dt>
      <dd className={`${text} font-semibold tracking-tight text-zinc-50 proportional-nums`}>{value}</dd>
    </div>
  )
}

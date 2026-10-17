import type { LucideIcon } from 'lucide-react'

/** A row of mutually exclusive buttons (view mode, sort order). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; icon: LucideIcon }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800">
      {options.map(({ id, label: text, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`focus-ring flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors lg:h-8 ${
            value === id ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Icon className="size-4" aria-hidden />
          {text}
        </button>
      ))}
    </div>
  )
}

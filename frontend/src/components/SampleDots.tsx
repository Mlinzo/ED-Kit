import { ru } from '../i18n/ru'

/** Three dots for the three samples a species needs. */
export function SampleDots({ samples, size = 'sm' }: { samples: number; size?: 'sm' | 'lg' }) {
  const dot = size === 'lg' ? 'size-4' : 'size-2'
  const gap = size === 'lg' ? 'gap-2' : 'gap-1'
  return (
    <span
      className={`inline-flex items-center ${gap}`}
      role="img"
      aria-label={`${ru.surface.progress}: ${ru.species.samples(samples)}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`${dot} rounded-full ${i < samples ? 'bg-accent' : 'border border-zinc-600 bg-transparent'}`}
        />
      ))}
    </span>
  )
}

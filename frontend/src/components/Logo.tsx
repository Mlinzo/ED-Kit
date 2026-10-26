// The app's mark: a star with an orbit, in the accent colour.

export function Logo({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 text-accent`} aria-hidden fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" strokeWidth="1.6" transform="rotate(-25 12 12)" opacity="0.7" />
    </svg>
  )
}

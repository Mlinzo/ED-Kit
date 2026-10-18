import { Heart } from 'lucide-react'
import { t } from '../i18n'

/** The author's Patreon page; the support links stay hidden while it is empty. */
export const SUPPORT_URL = 'https://www.patreon.com/mlinzo'

/** Heart in the top bar (icon only: the bar is full in every language). */
export function SupportLink() {
  if (!SUPPORT_URL) return null
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noreferrer"
      title={t.settings.supportButton}
      className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-rose-300 hover:bg-zinc-800/70 hover:text-rose-200"
    >
      <Heart className="size-5" aria-hidden />
      <span className="sr-only">{t.settings.supportButton}</span>
    </a>
  )
}

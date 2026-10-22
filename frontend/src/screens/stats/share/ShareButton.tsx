import { Share2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../../i18n'

// The dialog and the screenshot library load on the first click.
const ShareDialog = lazy(() => import('./ShareDialog').then((m) => ({ default: m.ShareDialog })))

/** Opens the Stats tab as a picture to post. */
export function ShareButton({ target, hasName }: { target: RefObject<HTMLElement | null>; hasName: boolean }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const ref = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setNode(null)
    ref.current?.focus()
  }, [])
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setNode(target.current)}
        aria-haspopup="dialog"
        className="focus-ring relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-300 ring-1 ring-zinc-700 after:absolute after:-inset-1 hover:bg-zinc-800 hover:text-zinc-100"
      >
        <Share2 className="size-3.5" aria-hidden />
        {t.stats.share.button}
      </button>
      {node &&
        createPortal(
          <Suspense fallback={null}>
            <ShareDialog target={node} hasName={hasName} onClose={close} />
          </Suspense>,
          document.body,
        )}
    </>
  )
}

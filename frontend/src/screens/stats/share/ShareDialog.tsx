// "Share": the Stats tab as it is on the screen, as one long picture to post. modern-screenshot
// copies the tab into an SVG (styles and fonts inlined) and draws it on a canvas. Controls marked
// `data-no-snapshot` stay out of it, the commander's name (`data-snapshot-name`) on request. The
// dialog shows the PNG it saves, so on a phone the picture itself can be held to save it where
// the browser offers nothing else.

import { Check, Copy, Download, Send, X } from 'lucide-react'
import { domToBlob } from 'modern-screenshot'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { t } from '../../../i18n'
import { readStored, writeStored } from '../../../lib/storage'

const NAME_KEY = 'edk.share.name'
const CONFIRM_MS = 1_500
const BACKGROUND = '#09090b' // zinc-950, the page
/** Canvas size limits: iOS Safari draws nothing above ~16.7 M pixels; desktops take far more. */
const MAX_PIXELS = { touch: 16_000_000, desktop: 40_000_000 }

interface Picture {
  blob: Blob
  url: string
}

const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches

/**
 * Marks the elements whose text sits on one line on the page: the copy keeps them on one line.
 * The copy takes every box at its size on the page, while some browsers set its text a hair
 * wider; a label as wide as its box ("Farthest from Sol") would then wrap and run into the
 * next line.
 */
function markSingleLines(root: HTMLElement): HTMLElement[] {
  const first = new Map<HTMLElement, DOMRect>()
  const several = new Set<HTMLElement>()
  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const el = text.parentElement
    if (!(el instanceof HTMLElement) || several.has(el) || !text.textContent?.trim()) continue
    range.selectNodeContents(text)
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue
      const line = first.get(el)
      if (!line) first.set(el, rect)
      else if (Math.abs(rect.top - line.top) > line.height / 2) {
        several.add(el)
        break
      }
    }
  }
  // Truncated boxes (one line by design) clip what their spans hold.
  const single = [...new Set([...first.keys(), ...root.querySelectorAll<HTMLElement>('.truncate')])].filter((el) => !several.has(el))
  // "fits": nothing cut on the page, so a hair more in the copy may show past the box (index.css).
  for (const el of single) el.setAttribute('data-snapshot-line', el.scrollWidth > el.clientWidth ? 'cut' : 'fits')
  return single
}

/**
 * Marks the wrapping flex rows whose items sit on one line on the page: the copy keeps them on
 * one line too. A row is as wide as its items on the page, and a hair less in the copy (wider
 * text, or its size rounded the other way): the Deaths card's totals then put "spent on rebuys"
 * on a line of its own, over the table below.
 */
function markSingleRows(root: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const style = getComputedStyle(el)
    if (!style.display.endsWith('flex') || style.flexWrap === 'nowrap' || style.flexDirection.startsWith('column')) continue
    const items = [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    // One line: the items share a band across (an item shorter than the others still crosses it).
    if (items.length > 1 && Math.max(...items.map((r) => r.top)) < Math.min(...items.map((r) => r.bottom))) {
      el.setAttribute('data-snapshot-row', '')
      rows.push(el)
    }
  }
  return rows
}

/**
 * Widens the tab until its side-scrolling tables fit (Deaths, Firsts on a phone): the copy shows
 * a scroll box as it stands, so their right columns would be cut off. Returns the undo.
 */
function fitScrollBoxes(root: HTMLElement): () => void {
  let extra = 0
  // The same boxes index.css stops from scrolling in the copy.
  for (const el of root.querySelectorAll<HTMLElement>('.overflow-auto, .overflow-x-auto, .overflow-y-auto')) {
    extra = Math.max(extra, el.scrollWidth - el.clientWidth)
  }
  if (extra <= 1) return () => {}
  const width = root.style.width
  root.style.width = `${root.offsetWidth + extra}px`
  return () => {
    root.style.width = width
  }
}

/**
 * The tab with a margin of page around it, twice as sharp as the screen when it fits. What stays
 * out is hidden on the page for the moment (index.css): the copy takes sizes as laid out, so
 * leaving nodes out of it would not close the gaps.
 */
async function capture(node: HTMLElement, showName: boolean): Promise<Blob> {
  node.setAttribute('data-snapshot', showName ? '' : 'no-name')
  const unfit = fitScrollBoxes(node)
  // After the controls are hidden and the tab widened: lines are measured as the picture lays them out.
  const lines = markSingleLines(node)
  const rows = markSingleRows(node)
  try {
    const pad = node.offsetWidth < 640 ? 12 : 24
    const width = node.offsetWidth + pad * 2
    const height = node.offsetHeight + pad * 2
    const max = coarsePointer() ? MAX_PIXELS.touch : MAX_PIXELS.desktop
    const scale = Math.min(2, Math.sqrt(max / (width * height)))
    return await domToBlob(node, {
      width,
      height,
      scale,
      backgroundColor: BACKGROUND,
      style: { padding: `${pad}px`, margin: '0' },
    })
  } finally {
    node.removeAttribute('data-snapshot')
    unfit()
    for (const el of lines) el.removeAttribute('data-snapshot-line')
    for (const el of rows) el.removeAttribute('data-snapshot-row')
  }
}

// One picture at a time: each one hides and shows parts of the page.
let queue: Promise<unknown> = Promise.resolve()

function snapshot(node: HTMLElement, showName: boolean): Promise<Blob> {
  const run = queue.then(() => capture(node, showName))
  queue = run.catch(() => {})
  return run
}

function fileName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `ed-explorer-kit-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.png`
}

const canCopyImage = () => window.isSecureContext && typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write

export function ShareDialog({ target, hasName, onClose }: { target: HTMLElement; hasName: boolean; onClose: () => void }) {
  const titleId = useId()
  const nameId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [showName, setShowName] = useState(() => readStored(NAME_KEY, ['1', '0'], '1') === '1')
  const [picture, setPicture] = useState<Picture | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const [name] = useState(fileName)
  const pictureUrl = useRef<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    panel.current?.focus()
    return () => {
      if (pictureUrl.current) URL.revokeObjectURL(pictureUrl.current)
    }
  }, [])

  useEffect(() => {
    let live = true
    snapshot(target, showName)
      .then((blob) => {
        if (!live) return
        if (pictureUrl.current) URL.revokeObjectURL(pictureUrl.current)
        pictureUrl.current = URL.createObjectURL(blob)
        setPicture({ blob, url: pictureUrl.current })
        setFailed(false)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [target, showName])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const file = useMemo(() => (picture ? new File([picture.blob], name, { type: 'image/png' }) : null), [picture, name])
  const canSend = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  const canCopy = canCopyImage()
  // Where the browser can neither copy nor send the picture (a phone on plain http), holding it saves it.
  const holdHint = !canSend && !canCopy && coarsePointer()

  const copy = async () => {
    if (!picture) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture.blob })])
      setCopied('yes')
    } catch {
      setCopied('failed')
    }
  }
  const send = () => {
    if (file) navigator.share({ files: [file] }).catch(() => {})
  }

  const button =
    'focus-ring inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-medium ring-1 ring-inset disabled:opacity-50'
  const quiet = `${button} bg-zinc-800 text-zinc-100 ring-zinc-700 hover:bg-zinc-700`
  const primary = `${button} bg-sky-400 font-semibold text-zinc-950 ring-sky-300`

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
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
        className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl outline-none sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-zinc-50">
            {t.stats.share.title}
          </h2>
          <button type="button" onClick={onClose} className="focus-ring -m-1 rounded-md p-1 text-zinc-500 hover:text-zinc-200">
            <X className="size-5" aria-hidden />
            <span className="sr-only">{t.settings.close}</span>
          </button>
        </div>

        <div className="mt-4 max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl bg-zinc-900 ring-1 ring-zinc-800">
          {picture ? (
            <img src={picture.url} alt={t.stats.share.alt} className="block h-auto w-full" />
          ) : (
            <div className="grid h-48 place-items-center px-4 text-center text-sm text-zinc-500" role="status">
              {failed ? t.stats.share.failed : t.stats.share.preparing}
            </div>
          )}
        </div>
        {holdHint && picture && <p className="mt-2 text-xs text-zinc-500">{t.stats.share.holdToSave}</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {hasName ? (
            <div className="flex items-center gap-2.5">
              <input
                id={nameId}
                type="checkbox"
                checked={showName}
                onChange={(e) => {
                  setShowName(e.target.checked)
                  writeStored(NAME_KEY, e.target.checked ? '1' : '0')
                }}
                className="focus-ring size-4 shrink-0 accent-sky-500"
              />
              <label htmlFor={nameId} className="text-sm text-zinc-300">
                {t.stats.share.showName}
              </label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            {canSend && (
              <button type="button" onClick={send} className={quiet}>
                <Send className="size-4" aria-hidden />
                {t.stats.share.send}
              </button>
            )}
            {canCopy && (
              <button
                type="button"
                onClick={copy}
                disabled={!picture}
                className={copied === 'yes' ? `${button} bg-emerald-500/15 text-emerald-300 ring-emerald-400/30` : quiet}
              >
                {copied === 'yes' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied === 'yes' ? t.stats.share.copied : copied === 'failed' ? t.stats.share.copyFailed : t.stats.share.copy}
              </button>
            )}
            {picture ? (
              <a href={picture.url} download={name} className={`${primary} hover:bg-sky-300`}>
                <Download className="size-4" aria-hidden />
                {t.stats.share.download}
              </a>
            ) : (
              <button type="button" disabled className={primary}>
                <Download className="size-4" aria-hidden />
                {t.stats.share.download}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

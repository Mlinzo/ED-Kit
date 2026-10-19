// Your note on a system or a body: free text shown where the system appears (System tab, the
// route plotted in the game, the history, the galaxy map) and edited in place. Saving an empty
// note deletes it.
import { Pencil, StickyNote } from 'lucide-react'
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { t } from '../i18n'
import { useSaveNote, type NoteSaver, type NoteTarget } from './notes'

const MAX_LENGTH = 1000

/** The note's text, as written (line breaks kept); `clamp`: at most two lines. Phrasing content (fits in a button). */
export function NoteText({ text, clamp = false, className = '' }: { text: string; clamp?: boolean; className?: string }) {
  return (
    <span className={`flex items-start gap-2 text-sm text-amber-100/90 ${className}`}>
      <StickyNote className="mt-[0.2em] size-3.5 shrink-0 text-amber-300" aria-label={t.notes.label} />
      <span className={`min-w-0 break-words whitespace-pre-wrap ${clamp ? 'line-clamp-2' : ''}`}>{text}</span>
    </span>
  )
}

interface NoteProps {
  note: string | null
  target: NoteTarget
  compact?: boolean
  className?: string
  onClose?: () => void
}

/**
 * A note with its editor: the text and a pencil, or an "add a note" button; `compact` for tight
 * places (a table row, a map card). `onClose`: opened straight in the editor, and told when it
 * closes (saved or cancelled).
 */
export function Note(props: NoteProps) {
  return <NoteEditor {...props} saver={useSaveNote()} />
}

/** `Note` with the saving handed in: for a separate React root without the data store (map labels). */
export function NoteEditor({ note, target, compact = false, className = '', onClose, saver }: NoteProps & { saver: NoteSaver }) {
  const [editing, setEditingState] = useState(onClose !== undefined)
  const [draft, setDraft] = useState(onClose !== undefined ? (note ?? '') : '')
  const setEditing = (on: boolean) => {
    setEditingState(on)
    if (!on) onClose?.()
  }
  // Shown until the refetched view brings the saved text (or its absence).
  const [saved, setSaved] = useState<{ text: string | null; over: string | null } | null>(null)
  if (saved && saved.over !== note) setSaved(null)
  const shown = saved ? saved.text : note
  const { save, saving, error } = saver
  const id = useId()

  const open = () => {
    setDraft(shown ?? '')
    setEditing(true)
  }
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = draft.trim()
    if (await save(target, text)) {
      setSaved({ text: text || null, over: note })
      setEditing(false)
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
    if (e.key === 'Escape') {
      e.stopPropagation() // not the map card's Esc
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className={`space-y-2 ${className}`}>
        <label htmlFor={id} className="sr-only">
          {t.notes.label}
        </label>
        <textarea
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          maxLength={MAX_LENGTH}
          rows={compact ? 2 : 3}
          autoFocus
          placeholder={t.notes.placeholder}
          className="focus-ring block w-full resize-y rounded-lg bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 ring-1 ring-zinc-700 ring-inset placeholder:text-zinc-600"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="focus-ring inline-flex h-8 items-center rounded-lg bg-amber-500/15 px-3 text-sm font-medium text-amber-100 ring-1 ring-amber-400/30 ring-inset hover:bg-amber-500/25 disabled:opacity-60"
          >
            {saving ? t.notes.saving : t.notes.save}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="focus-ring inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {t.notes.cancel}
          </button>
          <span className="hidden text-[11px] text-zinc-600 pointer-fine:inline">{t.notes.keys}</span>
        </div>
        {error && (
          <p role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        )}
      </form>
    )
  }
  if (shown) {
    return (
      <div className={`group flex items-start gap-2 rounded-lg bg-amber-500/[0.07] px-3 py-2 ring-1 ring-amber-400/20 ring-inset ${className}`}>
        <NoteText text={shown} className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={open}
          title={t.notes.edit}
          aria-label={t.notes.edit}
          className="focus-ring -my-1 -mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-amber-200/60 hover:bg-amber-500/15 hover:text-amber-100"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={open}
      title={t.notes.addLong}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 ${
        compact ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm'
      } ${className}`}
    >
      <StickyNote className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
      {compact ? t.notes.add : t.notes.addLong}
    </button>
  )
}

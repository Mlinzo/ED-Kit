// Your bookmark on a system, a body, a station or a place: its tag and your comment, shown where
// the thing appears (System tab, the route plotted in the game, the history, the galaxy map, the
// globe, Where to sell, the Shop, the Bookmarks tab) and edited in place.
import { BookmarkPlus, Pencil } from 'lucide-react'
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { BookmarkCategory, BookmarkView } from '../api/types'
import { t } from '../i18n'
import { CATEGORIES, CATEGORY_STYLE, useBookmarkActions, type BookmarkActions, type BookmarkTarget } from './bookmarks'

const MAX_COMMENT = 1000
const MAX_TITLE = 120

/** A tag: its icon in its colour, and its name. */
export function BookmarkTag({ category, className = '' }: { category: BookmarkCategory; className?: string }) {
  const style = CATEGORY_STYLE[category]
  const Icon = style.icon
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Icon className={`size-3.5 shrink-0 ${style.text}`} aria-hidden />
      <span>{t.bookmarks.category[category]}</span>
    </span>
  )
}

/** A bookmark in one line (or two with `clamp`): its tag's icon and your comment, or the tag. Phrasing content. */
export function BookmarkLine({ bookmark, clamp = false, className = '' }: { bookmark: BookmarkView; clamp?: boolean; className?: string }) {
  const style = CATEGORY_STYLE[bookmark.category]
  const Icon = style.icon
  return (
    <span className={`flex items-start gap-2 text-sm text-amber-100/90 ${className}`}>
      <Icon className={`mt-[0.2em] size-3.5 shrink-0 ${style.text}`} aria-label={`${t.bookmarks.label}: ${t.bookmarks.category[bookmark.category]}`} />
      <span className={`min-w-0 break-words whitespace-pre-wrap ${clamp ? 'line-clamp-2' : ''}`}>
        {bookmark.comment || <span className="text-zinc-400">{t.bookmarks.category[bookmark.category]}</span>}
      </span>
    </span>
  )
}

export interface BookmarkDraft {
  category: BookmarkCategory
  comment: string
  title: string
}

/** The tag chips, the name (a place), the comment, Save / Cancel and Delete (an existing bookmark). */
export function BookmarkForm({
  initial,
  withTitle = false,
  compact = false,
  saving,
  error,
  onSave,
  onCancel,
  onDelete,
  className = '',
}: {
  initial: BookmarkDraft
  withTitle?: boolean
  compact?: boolean
  saving: boolean
  error: string | null
  onSave: (draft: BookmarkDraft) => void
  onCancel: () => void
  onDelete?: () => void
  className?: string
}) {
  const [draft, setDraft] = useState(initial)
  const id = useId()
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    onSave({ ...draft, comment: draft.comment.trim(), title: draft.title.trim() })
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
    if (e.key === 'Escape') {
      e.stopPropagation() // not the map card's Esc
      onCancel()
    }
  }
  const field =
    'focus-ring block w-full rounded-lg bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 ring-1 ring-zinc-700 ring-inset placeholder:text-zinc-600'
  return (
    <form onSubmit={submit} onKeyDown={onKey} className={`space-y-2.5 ${className}`}>
      <div>
        <p id={`${id}-tag`} className="mb-1.5 text-xs text-zinc-500">
          {t.bookmarks.tag}
        </p>
        <div role="radiogroup" aria-labelledby={`${id}-tag`} className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const on = draft.category === c
            const Icon = CATEGORY_STYLE[c].icon
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setDraft({ ...draft, category: c })}
                className={`focus-ring flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset ${
                  on ? CATEGORY_STYLE[c].chip : 'bg-zinc-900/60 text-zinc-400 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                <Icon className={`size-3.5 shrink-0 ${on ? '' : CATEGORY_STYLE[c].text}`} aria-hidden />
                {t.bookmarks.category[c]}
              </button>
            )
          })}
        </div>
      </div>
      {withTitle && (
        <div>
          <label htmlFor={`${id}-title`} className="mb-1 block text-xs text-zinc-500">
            {t.bookmarks.name}
          </label>
          <input
            id={`${id}-title`}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={MAX_TITLE}
            placeholder={t.bookmarks.namePlaceholder}
            className={`${field} h-9`}
          />
        </div>
      )}
      <div>
        <label htmlFor={`${id}-comment`} className="mb-1 block text-xs text-zinc-500">
          {t.bookmarks.comment}
        </label>
        <textarea
          id={`${id}-comment`}
          value={draft.comment}
          onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
          maxLength={MAX_COMMENT}
          rows={compact ? 2 : 3}
          autoFocus
          placeholder={t.bookmarks.placeholder}
          className={`${field} resize-y`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="focus-ring inline-flex h-9 items-center rounded-lg bg-amber-500/15 px-3 text-sm font-medium text-amber-100 ring-1 ring-amber-400/30 ring-inset hover:bg-amber-500/25 disabled:opacity-60"
        >
          {saving ? t.bookmarks.saving : t.bookmarks.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {t.bookmarks.cancel}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="focus-ring ml-auto inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-60"
          >
            {t.bookmarks.remove}
          </button>
        )}
        <span className="hidden w-full text-[11px] text-zinc-600 pointer-fine:inline">{t.bookmarks.keys}</span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </form>
  )
}

interface BookmarkProps {
  bookmark: BookmarkView | null
  /** What a new bookmark marks. */
  target: BookmarkTarget
  /** The tag a new bookmark starts with. */
  suggest?: BookmarkCategory
  compact?: boolean
  className?: string
  /** Opened straight in the editor, and told when it closes (saved or cancelled). */
  onClose?: () => void
}

/**
 * A bookmark in a wrapped line of facts (a station in a list): a small button in the line, and the
 * bookmark or its editor on a line of its own.
 */
export function InlineBookmark({ bookmark, target, suggest }: { bookmark: BookmarkView | null; target: BookmarkTarget; suggest?: BookmarkCategory }) {
  const [adding, setAdding] = useState(false)
  if (bookmark || adding) {
    return (
      <div className="mt-1 basis-full">
        <BookmarkBox bookmark={bookmark} target={target} suggest={suggest} compact onClose={adding ? () => setAdding(false) : undefined} />
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setAdding(true)}
      title={t.bookmarks.addLong}
      aria-label={target.title ? `${t.bookmarks.addLong}: ${target.title}` : t.bookmarks.addLong}
      className="focus-ring inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
    >
      <BookmarkPlus className="size-3.5" aria-hidden />
    </button>
  )
}

/**
 * A bookmark with its editor: the tag and your comment with a pencil, or a "Bookmark it" button;
 * `compact` for tight places (a table row, a map card).
 */
export function BookmarkBox(props: BookmarkProps) {
  return <BookmarkEditor {...props} actions={useBookmarkActions()} />
}

/** `BookmarkBox` with the saving handed in: for a separate React root without the data store (map labels). */
export function BookmarkEditor({
  bookmark,
  target,
  suggest = 'other',
  compact = false,
  className = '',
  onClose,
  actions,
}: BookmarkProps & { actions: BookmarkActions }) {
  const [editing, setEditingState] = useState(onClose !== undefined)
  const setEditing = (on: boolean) => {
    setEditingState(on)
    if (!on) onClose?.()
  }
  // Shown until the refetched view brings the saved bookmark (or its absence).
  const [saved, setSaved] = useState<{ value: BookmarkView | null; over: BookmarkView | null } | null>(null)
  if (saved && saved.over !== bookmark) setSaved(null)
  const shown = saved ? saved.value : bookmark
  const withTitle = target.kind === 'place'

  const save = async (draft: BookmarkDraft) => {
    const result = shown
      ? await actions.update(shown.id, { category: draft.category, comment: draft.comment, ...(withTitle ? { title: draft.title } : {}) })
      : await actions.create({ ...target, category: draft.category, comment: draft.comment, ...(withTitle && draft.title ? { title: draft.title } : {}) })
    if (result) {
      setSaved({ value: result, over: bookmark })
      setEditing(false)
    }
  }
  const remove = async () => {
    if (shown && (await actions.remove(shown.id))) {
      setSaved({ value: null, over: bookmark })
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <BookmarkForm
        initial={{ category: shown?.category ?? suggest, comment: shown?.comment ?? '', title: shown?.title ?? target.title ?? '' }}
        withTitle={withTitle}
        compact={compact}
        saving={actions.saving}
        error={actions.error}
        onSave={save}
        onCancel={() => setEditing(false)}
        onDelete={shown ? remove : undefined}
        className={className}
      />
    )
  }
  if (shown) {
    return (
      <div className={`flex items-start gap-2 rounded-lg bg-amber-500/[0.07] px-3 py-2 ring-1 ring-amber-400/20 ring-inset ${className}`}>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-300">
            <BookmarkTag category={shown.category} />
          </p>
          {shown.comment && <p className="mt-1 text-sm break-words whitespace-pre-wrap text-amber-100/90">{shown.comment}</p>}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={t.bookmarks.edit}
          aria-label={t.bookmarks.edit}
          className="focus-ring -my-1 -mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-amber-200/60 hover:bg-amber-500/15 hover:text-amber-100"
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={t.bookmarks.addLong}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 ${
        compact ? 'h-8 px-2 text-xs' : 'h-9 px-2.5 text-sm'
      } ${className}`}
    >
      <BookmarkPlus className={compact ? 'size-3.5' : 'size-4'} aria-hidden />
      {compact ? t.bookmarks.add : t.bookmarks.addLong}
    </button>
  )
}

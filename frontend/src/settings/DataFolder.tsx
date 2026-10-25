import { CircleAlert, FolderInput, HardDrive, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useIngest, useStream } from '../api/hooks'
import { t } from '../i18n'
import { formatBytes } from './dataSize'

type Problem = keyof typeof t.settings.data.problems | 'other_device' | 'failed'

/**
 * PUT /api/data-dir (null: back to the standard folder) or DELETE /api/data-dir/move (stay). The
 * new ingest state also comes through the stream. Only the PC the app runs on may do it.
 */
async function request(method: 'PUT' | 'DELETE', path: string | null): Promise<Problem | null> {
  try {
    const response = await fetch(method === 'PUT' ? '/api/data-dir' : '/api/data-dir/move', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ path }) : undefined,
    })
    if (response.status === 403) return 'other_device'
    if (response.status === 422) {
      const detail = ((await response.json()) as { detail?: string }).detail
      return detail && detail in t.settings.data.problems ? (detail as Problem) : 'failed'
    }
    return response.ok ? null : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * Where the database is, how big, and a field to move it: the move happens at the next start (the
 * app cannot reopen its database on the fly). A folder set at launch (--data-dir) is only shown,
 * and so is the folder on a phone.
 */
export function DataFolder({ autoFocus, thisPc }: { autoFocus: boolean; thisPc: boolean | null }) {
  const ingest = useIngest()
  const { mock } = useStream()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const inputId = useId()
  const titleId = useId()
  const section = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const s = t.settings.data

  // Again once thisPc is known: the phone section above may have pushed this one down.
  useEffect(() => {
    if (!autoFocus) return
    section.current?.scrollIntoView({ block: 'nearest' })
    input.current?.focus({ preventScroll: true })
  }, [autoFocus, thisPc])

  if (!ingest) return null

  const apply = async (method: 'PUT' | 'DELETE', value: string | null) => {
    setBusy(true)
    setProblem(null)
    const result = await request(method, value)
    setBusy(false)
    setProblem(result)
    if (!result) setPath('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (path.trim()) void apply('PUT', path)
  }
  const pending = ingest.dataDirPending

  return (
    <section ref={section} aria-labelledby={titleId} className="mt-7 border-t border-zinc-800 pt-5">
      <h3 id={titleId} className="text-sm font-semibold text-zinc-100">
        {s.title}
      </h3>
      <p className="mt-1 text-xs text-zinc-500">{s.hint}</p>
      <div className="mt-3 rounded-lg bg-zinc-900/70 px-3 py-2.5 ring-1 ring-zinc-800 ring-inset">
        <p className="font-mono text-xs break-all text-zinc-200">{ingest.dataDir}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-400">
          <HardDrive className="size-3.5 shrink-0" aria-hidden />
          <span>{s.size(formatBytes(ingest.dbBytes))}</span>
          {ingest.freeBytes !== null && <span className="text-zinc-500">· {s.free(formatBytes(ingest.freeBytes))}</span>}
        </p>
      </div>
      {pending && (
        <div role="status" className="mt-3 rounded-lg bg-sky-500/10 px-3 py-2.5 text-sm text-sky-100 ring-1 ring-sky-400/30 ring-inset">
          <p className="break-words">{s.pending(pending)}</p>
          <p className="mt-1 text-xs text-sky-200/80">{s.restart}</p>
          {thisPc !== false && !mock && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply('DELETE', null)}
              className="focus-ring -mx-2 mt-1.5 inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-sky-200 hover:bg-sky-400/10 disabled:opacity-40"
            >
              {s.cancel}
            </button>
          )}
        </div>
      )}
      {ingest.dataDirFixed ? (
        <p className="mt-2 text-xs text-zinc-500">{s.fixed}</p>
      ) : mock ? (
        <p className="mt-2 text-xs text-zinc-500">{s.demo}</p>
      ) : thisPc === false ? (
        <p className="mt-2 text-xs text-zinc-500">{s.otherDevice}</p>
      ) : (
        <form onSubmit={submit} className="mt-3">
          <label htmlFor={inputId} className="block text-xs text-zinc-500">
            {s.other}
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              ref={input}
              id={inputId}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\EDExplorerKit"
              spellCheck={false}
              autoComplete="off"
              className="focus-ring h-10 min-w-0 flex-1 basis-56 rounded-lg bg-zinc-900 px-3 font-mono text-xs text-zinc-100 ring-1 ring-zinc-800 ring-inset placeholder:text-zinc-600 focus:ring-sky-500/50"
            />
            <button
              type="submit"
              disabled={busy || !path.trim()}
              className="focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> : <FolderInput className="size-4" aria-hidden />}
              {busy ? s.applying : s.apply}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">{s.copyHint}</p>
          {problem && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-rose-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {problem === 'other_device' ? s.otherDevice : problem === 'failed' ? s.failed : s.problems[problem]}
            </p>
          )}
          {ingest.dataDir !== ingest.dataDirDefault && pending !== ingest.dataDirDefault && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply('PUT', null)}
              className="focus-ring -mx-2 mt-2 inline-flex h-9 items-center rounded-lg px-2 text-sm text-accent hover:bg-zinc-800/60 disabled:opacity-40"
            >
              {s.useDefault}
            </button>
          )}
        </form>
      )}
    </section>
  )
}

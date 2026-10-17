import { useIngest, useStream } from '../api/hooks'
import type { ConnectionState } from '../api/transport'
import { t } from '../i18n'

const SPEC: Record<ConnectionState, { dot: string; label: string; pulse: boolean }> = {
  open: { dot: 'bg-emerald-400', label: t.connection.open, pulse: false },
  connecting: { dot: 'bg-amber-400', label: t.connection.connecting, pulse: true },
  reconnecting: { dot: 'bg-amber-400', label: t.connection.reconnecting, pulse: true },
  offline: { dot: 'bg-rose-500', label: t.connection.offline, pulse: false },
}

/**
 * The server connection, and once it is up, whether the game is running: "Online" alone read as
 * the game's state, while it only ever meant the app's own server.
 */
export function ConnectionIndicator() {
  const { connection } = useStream()
  const game = useIngest()?.gameRunning ?? null
  let spec = SPEC[connection]
  if (connection === 'open' && game !== null) {
    spec = game
      ? { dot: 'bg-emerald-400', label: t.connection.inGame, pulse: false }
      : { dot: 'bg-zinc-500', label: t.connection.gameClosed, pulse: false }
  }
  const server = `${t.connection.label}: ${SPEC[connection].label}`
  const label = spec.label
  const full = label === SPEC[connection].label ? server : `${label} · ${server}`
  return (
    <div role="status" aria-label={full} title={full} className="flex items-center gap-2 text-sm text-zinc-400">
      <span className="relative flex size-2.5" aria-hidden>
        {spec.pulse && (
          <span className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${spec.dot}`} />
        )}
        <span className={`relative size-2.5 rounded-full ${spec.dot}`} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  )
}

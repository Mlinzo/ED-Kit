// What the top bar says about the database's room: the journal read waits (the database would not
// fit on its drive, or would grow big in the standard folder: the backend holds the read until
// the user decides), the drive runs out of space, or the database has grown big. And byte sizes.

import type { IngestState } from '../api/types'
import { t } from '../i18n'
import { formatNumber } from '../lib/format'

/** Where "Hide" on the low-space warning is remembered: the free bytes then; shown again at half. */
export const LOW_DISMISS_KEY = 'edk.lowspace'

export type DataNotice =
  /** The read waits: space = no room for `bytes` more; large = `bytes` more in the standard folder. */
  | { kind: 'hold'; reason: 'space' | 'large'; bytes: number }
  /** Little room left on the database's drive. */
  | { kind: 'low'; free: number }
  /** The database has grown big. */
  | { kind: 'big'; bytes: number }

/** The most pressing notice, or null. `lowDismissedAt`: free bytes when "Hide" was pressed. */
export function dataNotice(ingest: IngestState, lowDismissedAt: number | null): DataNotice | null {
  if (ingest.hold) return { kind: 'hold', reason: ingest.hold, bytes: ingest.holdBytes }
  if (ingest.dataDirFixed || ingest.dataDirPending) return null
  const free = ingest.freeBytes
  if (free !== null && free < ingest.lowFreeBytes && (lowDismissedAt === null || free < lowDismissedAt / 2)) {
    return { kind: 'low', free }
  }
  if (ingest.dbBytes >= ingest.largeDbBytes && !ingest.bigDataOk) return { kind: 'big', bytes: ingest.dbBytes }
  return null
}

/** "38 МБ", "1.2 ГБ". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${formatNumber(bytes / 1e9, 1)} ${t.units.gb}`
  const mb = bytes / 1e6
  return `${formatNumber(mb, mb < 10 ? 1 : 0)} ${t.units.mb}`
}

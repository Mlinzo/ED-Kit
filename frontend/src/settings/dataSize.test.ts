import { describe, expect, it } from 'vitest'
import type { IngestState } from '../api/types'
import { dataNotice, formatBytes } from './dataSize'

const MB = 1_000_000

function ingest(patch: Partial<IngestState>): IngestState {
  return {
    backfillDone: true,
    filesTotal: 40,
    filesDone: 40,
    events: 1,
    journalDir: 'C:\\journal',
    journalDirFound: true,
    journalFiles: 40,
    journalDirFixed: false,
    journalDirDefault: 'C:\\journal',
    gameRunning: null,
    dataDir: 'C:\\data',
    dataDirDefault: 'C:\\data',
    dataDirFixed: false,
    dataDirPending: null,
    dbBytes: 38 * MB,
    journalBytes: 9 * MB,
    freeBytes: 50_000 * MB,
    hold: null,
    holdBytes: 0,
    bigDataOk: false,
    largeDbBytes: 500 * MB,
    lowFreeBytes: 1_000 * MB,
    ...patch,
  }
}

describe('database room notice', () => {
  it('stays quiet for a small database on a roomy drive', () => {
    expect(dataNotice(ingest({}), null)).toBeNull()
  })

  it('puts a waiting read first, even with the folder fixed or a move waiting', () => {
    const held = ingest({ hold: 'space', holdBytes: 720 * MB, freeBytes: 300 * MB, dataDirPending: 'D:\\EDK' })
    expect(dataNotice(held, null)).toEqual({ kind: 'hold', reason: 'space', bytes: 720 * MB })
    expect(dataNotice(ingest({ hold: 'large', holdBytes: 720 * MB, dataDirFixed: true }), null)).toMatchObject({ reason: 'large' })
  })

  it('warns when the drive runs low, again once the room has halved since "Hide"', () => {
    expect(dataNotice(ingest({ freeBytes: 800 * MB }), null)).toEqual({ kind: 'low', free: 800 * MB })
    expect(dataNotice(ingest({ freeBytes: 500 * MB }), 800 * MB)).toBeNull()
    expect(dataNotice(ingest({ freeBytes: 300 * MB }), 800 * MB)).toEqual({ kind: 'low', free: 300 * MB })
  })

  it('offers to move a big database until "keep it here"', () => {
    expect(dataNotice(ingest({ dbBytes: 650 * MB }), null)).toEqual({ kind: 'big', bytes: 650 * MB })
    expect(dataNotice(ingest({ dbBytes: 650 * MB, bigDataOk: true }), null)).toBeNull()
    expect(dataNotice(ingest({ dbBytes: 650 * MB, dataDirPending: 'D:\\EDK' }), null)).toBeNull()
  })

  it('writes sizes in MB and GB', () => {
    expect(formatBytes(4.6 * MB)).toBe('4.6\u202fMB')
    expect(formatBytes(38 * MB)).toBe('38\u202fMB')
    expect(formatBytes(1_234 * MB)).toBe('1.2\u202fGB')
  })
})

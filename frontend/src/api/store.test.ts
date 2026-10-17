import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store, viewPath } from './store'
import type { StreamHandlers, Transport } from './transport'

function fakeTransport() {
  const calls: string[] = []
  let handlers: StreamHandlers | null = null
  const transport: Transport = {
    mock: true,
    async fetchJson<T>(path: string): Promise<T> {
      calls.push(path)
      return { path } as T
    },
    async send() {
      return null
    },
    stream(h) {
      handlers = h
      return () => {}
    },
  }
  return { transport, calls, emit: (e: Parameters<StreamHandlers['onEvent']>[0]) => handlers?.onEvent(e) }
}

describe('viewPath', () => {
  it('adds sorted, encoded parameters', () => {
    expect(viewPath('system')).toBe('/api/view/system')
    expect(viewPath('system', { address: '10477373803' })).toBe('/api/view/system?address=10477373803')
    expect(viewPath('history', { b: '2', a: 'x y' })).toBe('/api/view/history?a=x+y&b=2')
  })
})

describe('Store with view parameters', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('caches each variant and refetches all of a topic on invalidate', async () => {
    const { transport, calls, emit } = fakeTransport()
    const store = new Store(transport)
    store.start()
    emit({ type: 'hello', data: { seq: 1 } })
    const live = viewPath('system')
    const past = viewPath('system', { address: '42' })
    store.retain('system', live)
    store.retain('system', past)
    await vi.runAllTimersAsync()
    expect(calls.filter((c) => c.startsWith('/api/view'))).toEqual([live, past])
    expect(store.getEntry(past).data).toEqual({ path: past })

    emit({ type: 'invalidate', data: { seq: 2, topics: ['system'] } })
    await vi.advanceTimersByTimeAsync(300)
    expect(calls.filter((c) => c.startsWith('/api/view'))).toEqual([live, past, live, past])
  })

  it('evicts idle variants beyond the cache size, never the plain view', async () => {
    const { transport, emit } = fakeTransport()
    const store = new Store(transport)
    store.start()
    emit({ type: 'hello', data: { seq: 1 } })
    const release = store.retain('system', viewPath('system'))
    for (let i = 0; i < 20; i++) {
      const path = viewPath('system', { address: String(i) })
      const free = store.retain('system', path)
      await vi.runAllTimersAsync()
      free()
    }
    release()
    expect(store.getEntry(viewPath('system')).data).not.toBeNull()
    expect(store.getEntry(viewPath('system', { address: '19' })).data).not.toBeNull()
    expect(store.getEntry(viewPath('system', { address: '0' })).data).toBeNull()
  })
})

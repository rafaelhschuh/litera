import { describe, expect, it, vi } from 'vitest'
import { ReaderPreparation } from '../src/web/lib/reader-preparation'

const value = () => ({ release: vi.fn() })
describe('bounded adjacent reader preparation', () => {
  it('deduplicates warm work and transfers ownership exactly once', async () => {
    const cache = new ReaderPreparation(), prepared = value(), load = vi.fn(async () => prepared)
    cache.warm('chapter/appearance', load); cache.warm('chapter/appearance', load)
    expect(await cache.take('chapter/appearance')).toBe(prepared)
    expect(cache.take('chapter/appearance')).toBeUndefined()
    cache.clear()
    expect(prepared.release).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledOnce()
    prepared.release()
  })
  it('bounds retention to two entries and releases evicted resources', async () => {
    const cache = new ReaderPreparation(), first = value(), second = value(), third = value()
    cache.warm('one', async () => first); cache.warm('two', async () => second)
    await vi.waitFor(() => expect(cache).toBeDefined())
    cache.warm('three', async () => third)
    await vi.waitFor(() => expect(first.release).toHaveBeenCalledOnce())
    expect(cache.take('one')).toBeUndefined()
    cache.retain(['three'])
    await vi.waitFor(() => expect(second.release).toHaveBeenCalledOnce())
    cache.clear(); await vi.waitFor(() => expect(third.release).toHaveBeenCalledOnce())
  })
  it('aborts pending work and disposes a late completion after leaving the book', async () => {
    const cache = new ReaderPreparation(), late = value()
    let resolve!: (prepared: typeof late) => void, signal!: AbortSignal
    cache.warm('late', async incoming => { signal = incoming; return new Promise(done => { resolve = done }) })
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    cache.clear(); expect(signal.aborted).toBe(true); resolve(late)
    await vi.waitFor(() => expect(late.release).toHaveBeenCalledOnce())
    expect(cache.take('late')).toBeUndefined()
  })
  it('discards failures and allows the ordinary load to retry', async () => {
    const cache = new ReaderPreparation(), prepared = value()
    cache.warm('page', async () => { throw new Error('Unavailable') })
    await expect(cache.take('page')).rejects.toThrow('Unavailable')
    cache.warm('page', async () => prepared)
    expect(await cache.take('page')).toBe(prepared)
  })
  it('does not reuse another appearance or page scale', async () => {
    const cache = new ReaderPreparation(), prepared = value()
    cache.warm('chapter/light', async () => prepared)
    expect(cache.take('chapter/dark')).toBeUndefined()
    cache.clear()
  })
})

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { offlineBookCacheName, offlineBookMarker, offlineDataCacheName, offlineEpubChapterUrl } from '../src/shared/offline.js'

describe('offline reading contract', () => {
  it('partitions private caches by user and book', () => {
    expect(offlineBookCacheName(7, 42)).toBe('litera-books-u7-b42-v1')
    expect(offlineDataCacheName(7)).toBe('litera-data-u7-v1')
    expect(offlineBookMarker(42)).toBe('/_litera/offline/books/42')
    expect(() => offlineBookCacheName(0, 42)).toThrow()
  })

  it('builds the exact EPUB reader URL for the saved preferences', () => {
    expect(offlineEpubChapterUrl(3, 'Text/chapter 1.xhtml', { fontScale: 110, theme: 'sepia', lineHeight: 'relaxed', margins: 'wide' }))
      .toBe('/api/v1/books/3/epub/chapter?href=Text%2Fchapter%201.xhtml&scale=110&theme=sepia&lineHeight=relaxed&margins=wide')
  })

  it('keeps authenticated content behind an active-user cache in the worker', () => {
    const worker = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    expect(worker).toContain("const activeUserMarker='/_litera/offline/active-user'")
    expect(worker).toContain('const userId=await currentUser()')
    expect(worker).toContain("[401,403,404].includes(response.status)")
    expect(worker).toContain("key.startsWith(`litera-books-u${data.userId}-`)")
    expect(worker).not.toContain("url.pathname.startsWith('/api/'))return")
  })

  it('registers the worker before saving and tolerates optional asset cache failures', () => {
    const pwa = fs.readFileSync(new URL('../src/web/lib/pwa.ts', import.meta.url), 'utf8')
    expect(pwa).toContain('await registerWorker()')
    expect(pwa).toContain('Promise.allSettled')
    expect(pwa).toContain('aberto por HTTPS')
  })
})

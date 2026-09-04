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

  // SW isolation, complete precaching and controller readiness are exercised by
  // pwa-shell.test.ts rather than assertions coupled to the old worker source.
})

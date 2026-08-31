import { describe, expect, it } from 'vitest'
import { clearOfflineProgress, clearOfflineProgressUser, offlineProgressKey, readOfflineProgress, writeOfflineProgress } from '../src/web/lib/offline-progress.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return { get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}

describe('offline progress drafts', () => {
  it('keeps a format-aware locator per account and book until synchronization', () => {
    const storage = memoryStorage(), draft = { format: 'epub' as const, progressRatio: .42, locator: { type: 'epub-cfi' as const, cfi: 'epubcfi(/6/4)', chapterHref: 'chapter.xhtml' }, revision: 3 }
    writeOfflineProgress(storage, 7, 12, draft)
    expect(offlineProgressKey(7, 12)).toBe('litera-offline-progress-u7-b12')
    expect(readOfflineProgress(storage, 7, 12)).toEqual(draft)
    clearOfflineProgress(storage, 7, 12)
    expect(readOfflineProgress(storage, 7, 12)).toBeUndefined()
  })

  it('ignores malformed local data', () => {
    const storage = memoryStorage(); storage.setItem(offlineProgressKey(1, 2), '{broken')
    expect(readOfflineProgress(storage, 1, 2)).toBeUndefined()
  })

  it('clears drafts only for the account that signed out', () => {
    const storage = memoryStorage(); writeOfflineProgress(storage, 1, 2, { format: 'pdf', progressRatio: .2, locator: { type: 'pdf-page', page: 2 } }); writeOfflineProgress(storage, 2, 2, { format: 'pdf', progressRatio: .3, locator: { type: 'pdf-page', page: 3 } })
    clearOfflineProgressUser(storage as Storage, 1)
    expect(readOfflineProgress(storage, 1, 2)).toBeUndefined(); expect(readOfflineProgress(storage, 2, 2)?.locator).toMatchObject({ page: 3 })
  })
})

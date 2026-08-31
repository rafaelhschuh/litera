import type { ReadingLocator } from '../../shared/progress'

export type OfflineProgressDraft = {
  format: 'epub' | 'pdf'
  progressRatio: number
  locator: ReadingLocator
  revision?: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function offlineProgressKey(userId: number, bookId: number): string {
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(bookId) || bookId < 1) throw new Error('Offline progress requires positive user and book ids')
  return `litera-offline-progress-u${userId}-b${bookId}`
}

export function readOfflineProgress(storage: StorageLike, userId: number, bookId: number): OfflineProgressDraft | undefined {
  try {
    const value = JSON.parse(storage.getItem(offlineProgressKey(userId, bookId)) ?? 'null')
    if (!value || !['epub', 'pdf'].includes(value.format) || typeof value.progressRatio !== 'number' || !value.locator?.type) return undefined
    return value as OfflineProgressDraft
  } catch { return undefined }
}

export function writeOfflineProgress(storage: StorageLike, userId: number, bookId: number, draft: OfflineProgressDraft): void {
  storage.setItem(offlineProgressKey(userId, bookId), JSON.stringify(draft))
}

export function clearOfflineProgress(storage: StorageLike, userId: number, bookId: number): void {
  storage.removeItem(offlineProgressKey(userId, bookId))
}

export function clearOfflineProgressUser(storage: Storage, userId: number): void {
  const prefix = `litera-offline-progress-u${userId}-`
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix)))
  for (const key of keys) storage.removeItem(key)
}

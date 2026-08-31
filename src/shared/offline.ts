export type OfflineBookFormat = 'epub' | 'pdf'

const VERSION = 1

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  return value
}

export function offlineBookCacheName(userId: number, bookId: number): string {
  return `litera-books-u${positiveInteger(userId, 'userId')}-b${positiveInteger(bookId, 'bookId')}-v${VERSION}`
}

export function offlineDataCacheName(userId: number): string {
  return `litera-data-u${positiveInteger(userId, 'userId')}-v${VERSION}`
}

export function offlineBookMarker(bookId: number): string {
  return `/_litera/offline/books/${positiveInteger(bookId, 'bookId')}`
}

export function offlineEpubChapterUrl(bookId: number, href: string, preferences: { fontScale: number; theme: string; lineHeight: string; margins: string }): string {
  return `/api/v1/books/${positiveInteger(bookId, 'bookId')}/epub/chapter?href=${encodeURIComponent(href)}&scale=${preferences.fontScale}&theme=${encodeURIComponent(preferences.theme)}&lineHeight=${encodeURIComponent(preferences.lineHeight)}&margins=${encodeURIComponent(preferences.margins)}`
}

import { watch } from 'vue'
import { api } from './api'
import { auth } from './auth'
import { getOfflineUser, offlineContext } from './offline-context'
import { syncState } from './offline-sync'

type BookSummary = { id: number; hasCover?: boolean; fileRevision?: string }
export type HomeData = { continueReading: any[]; recentlyAdded: any[] }
export type BookDetail = { book: any; highlights: any[] }
type Entry = { revision?: string; expires: number; data?: BookDetail; promise: Promise<void>; controller: AbortController }
const books = new Map<number, Entry>()
const queue: Array<() => Promise<void>> = []
const controllers = new Set<AbortController>()
let running = 0
let home: { data: HomeData; expires: number } | undefined
const current = () => `${getOfflineUser() ?? ''}:${auth.user?.role ?? ''}:${offlineContext.generation}:${syncState.online}`

function clear() {
  home = undefined
  for (const controller of controllers) controller.abort()
  controllers.clear(); books.clear()
  // Queued jobs settle as no-ops against their captured account generation.
}
window.addEventListener('litera-account-changed', clear)
watch(() => syncState.online, clear)
watch(() => `${auth.user?.id ?? ''}:${auth.user?.role ?? ''}`, clear, { flush: 'sync' })

function drain() {
  while (running < 2 && queue.length) {
    const task = queue.shift()!
    running++
    void task().finally(() => { running--; drain() })
  }
}

function cover(book: BookSummary, signal: AbortSignal): Promise<void> {
  if (!book.hasCover || signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const image = new Image()
    const finish = () => { image.onload = image.onerror = null; signal.removeEventListener('abort', abort); resolve() }
    const abort = () => { image.src = ''; finish() }
    image.onload = image.onerror = finish
    image.decoding = 'async'
    signal.addEventListener('abort', abort, { once: true })
    image.src = `/api/v1/books/${book.id}/cover`
  })
}

/** Optional, bounded preparation of visible book details and browser-cached covers. */
export function warmBook(book: BookSummary): Promise<void> {
  if (!getOfflineUser() || auth.user?.id !== getOfflineUser() || !syncState.online || navigator.onLine === false) return Promise.resolve()
  const existing = books.get(book.id)
  if (existing && existing.revision === book.fileRevision && existing.expires > Date.now()) return existing.promise
  if (queue.length >= 12) return Promise.resolve()
  const owner = current(), controller = new AbortController()
  const entry: Entry = { revision: book.fileRevision, expires: Date.now() + 30_000, controller, promise: Promise.resolve() }
  controllers.add(controller)
  entry.promise = new Promise(resolve => {
    queue.push(async () => {
      if (current() !== owner || controller.signal.aborted) { controllers.delete(controller); resolve(); return }
      const timer = window.setTimeout(() => controller.abort(), 2500)
      try {
        const [detail, highlights] = await Promise.all([
          api<{book: any}>(`/api/v1/books/${book.id}`, { signal: controller.signal }),
          api<{highlights: any[]}>(`/api/v1/books/${book.id}/highlights`, { signal: controller.signal }),
          cover(book, controller.signal),
        ])
        if (current() === owner && !controller.signal.aborted) {
          entry.data = { book: detail.book, highlights: highlights.highlights }
          entry.expires = Date.now() + 30_000
        }
      } catch { if (books.get(book.id) === entry) books.delete(book.id) }
      finally { window.clearTimeout(timer); controllers.delete(controller); resolve() }
    })
  })
  books.set(book.id, entry)
  while (books.size > 24) {
    const first = books.keys().next().value!
    books.get(first)?.controller.abort()
    books.delete(first)
  }
  drain()
  return entry.promise
}

export function preparedBook(id: number): BookDetail | undefined {
  const entry = books.get(id)
  return syncState.online && entry && entry.expires > Date.now() ? entry.data : undefined
}
export function preparedHome(): HomeData | undefined {
  return home && home.expires > Date.now() ? home.data : undefined
}

/** Login is successful even when optional preparation fails or hits its deadline. */
export async function prepareHome(): Promise<void> {
  const owner = current(), controller = new AbortController()
  controllers.add(controller)
  const timer = window.setTimeout(() => controller.abort(), 2500)
  try {
    const data = await api<HomeData>('/api/v1/home', { signal: controller.signal })
    if (owner !== current() || controller.signal.aborted) return
    home = { data, expires: Date.now() + 10_000 }
    // Only the first screen is awaited; later rows are prepared as they approach view.
    const first = [...new Map([...data.continueReading, ...data.recentlyAdded].map(book => [book.id, book])).values()].slice(0, 2)
    const preparation = Promise.allSettled([import('../pages/HomePage.vue'), import('../pages/BookPage.vue'), ...first.map(warmBook)])
    await Promise.race([preparation, new Promise<void>(resolve => {
      if (controller.signal.aborted) resolve()
      else controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })])
  } catch { /* The destination retains its normal loading, error and offline paths. */ }
  finally { window.clearTimeout(timer); controllers.delete(controller) }
}

let observer: IntersectionObserver | undefined
const observed = new Map<Element, () => BookSummary>()
export function observeBook(element: HTMLElement, summary: () => BookSummary): () => void {
  if (!('IntersectionObserver' in window)) return () => { /* Pointer/focus intent remains available. */ }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const book = observed.get(entry.target)?.()
      if (book) void warmBook(book)
      observer?.unobserve(entry.target); observed.delete(entry.target)
    }
  }, { rootMargin: '240px' })
  observed.set(element, summary); observer.observe(element)
  return () => { observer?.unobserve(element); observed.delete(element) }
}

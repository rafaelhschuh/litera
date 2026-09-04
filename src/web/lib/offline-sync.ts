import { reactive } from 'vue'
import { normalizeProgress, type ReadingLocator } from '../../shared/progress'
import { getOfflineUser, offlineContext } from './offline-context'
import { getOfflineBook, getOfflineResource, listOfflineBooks } from './offline-store'
import { clearOfflineProgressUser, readOfflineProgress } from './offline-progress'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}

type Context = { userId: number; generation: number }
type Kind = 'progress' | 'highlight-create' | 'highlight-delete' | 'favorite' | 'settings'
type State = { userId: number; key: string; value: any; updatedAt: string; conflict?: { local: any; server?: any } }
type Operation = {
  userId: number; id: string; sequence: number; key: string; kind: Kind; bookId?: number
  url: string; method: string; body?: any; tempId?: number
  phase: 'queued' | 'sent' | 'conflict' | 'failed'; attempts: number; nextAttemptAt: number
  leaseOwner?: string; leaseUntil?: number; error?: string
}
type ReadingTransaction = { state: IDBObjectStore; pending: IDBObjectStore }
const DB_NAME = 'litera-reading'
const DB_VERSION = 1
const REQUEST_TIMEOUT = 12_000
const LEASE_MS = 30_000
const owner = Math.random().toString(36).slice(2)
let database: Promise<IDBDatabase> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | undefined
let cleanup: (() => void) | undefined
let probeFailures = 0
const controllers = new Set<AbortController>()
const defaultPreferences = { theme: 'light', fontScale: 100, lineHeight: 'normal', margins: 'normal', appTheme: 'system', reducedMotion: false, pdfInvert: false }
function operationId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export const syncState = reactive({
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
  pending: 0, syncing: false, message: '', lastSyncedAt: null as string | null,
  conflicts: [] as Array<{ bookId: number; kind: 'progress' }>,
})

function context(): Context | undefined {
  const userId = getOfflineUser()
  return userId ? { userId, generation: offlineContext.generation } : undefined
}
function assertContext(ctx: Context): void {
  if (ctx.userId !== getOfflineUser() || ctx.generation !== offlineContext.generation) throw new ApiError('A conta ativa mudou. Abra novamente o aplicativo.', 409, 'SESSION_USER_MISMATCH')
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error) })
}
function openReading(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('O navegador não oferece armazenamento de leitura offline.')); return }
    const opening = indexedDB.open(DB_NAME, DB_VERSION)
    let blocked = false
    opening.onupgradeneeded = () => {
      for (const [name, key] of [['state', 'key'], ['pendingOperations', 'id']] as const) {
        if (!opening.result.objectStoreNames.contains(name)) opening.result.createObjectStore(name, { keyPath: ['userId', key] }).createIndex('userId', 'userId')
      }
    }
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => { blocked = true; reject(new Error('Feche outras abas antigas para atualizar o armazenamento offline.')) }
    opening.onsuccess = () => {
      const db = opening.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
  }).catch(error => { database = undefined; throw error })
  return database
}
async function transaction<T>(mode: IDBTransactionMode, action: (tx: ReadingTransaction) => Promise<T>, ctx?: Context): Promise<T> {
  const db = await openReading()
  if (ctx) assertContext(ctx)
  const tx = db.transaction(['state', 'pendingOperations'], mode)
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Não foi possível persistir a leitura neste dispositivo.')); tx.onerror = () => undefined })
  void done.catch(() => undefined)
  try {
    const result = await action({ state: tx.objectStore('state'), pending: tx.objectStore('pendingOperations') })
    if (ctx) assertContext(ctx)
    await done
    if (ctx) assertContext(ctx)
    return result
  } catch (error) {
    try { tx.abort() } catch { /* Already completed/aborted. */ }
    await done.catch(() => undefined)
    throw error
  }
}
const states = (tx: ReadingTransaction, userId: number): Promise<State[]> => request(tx.state.index('userId').getAll(userId))
const operations = (tx: ReadingTransaction, userId: number): Promise<Operation[]> => request(tx.pending.index('userId').getAll(userId))
const stateKey = (bookId: number, suffix = '') => `/api/v1/books/${bookId}${suffix}`
function putState(tx: ReadingTransaction, ctx: Context, key: string, value: any, conflict?: State['conflict']): void {
  tx.state.put({ userId: ctx.userId, key, value, updatedAt: new Date().toISOString(), ...(conflict ? { conflict } : {}) } satisfies State)
}
async function readState(ctx: Context, key: string): Promise<State | undefined> {
  return transaction('readonly', tx => request(tx.state.get([ctx.userId, key])), ctx)
}

async function network<T>(url: string, options: RequestInit = {}, ctx?: Context): Promise<T> {
  if (ctx) assertContext(ctx)
  const controller = new AbortController()
  const abort = () => controller.abort()
  let timedOut = false
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_TIMEOUT)
  controllers.add(controller)
  try {
    const headers = new Headers(options.headers)
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (new URL(url, window.location.origin).pathname.startsWith('/api/v1/auth/')) headers.delete('X-Litera-User')
    else if (ctx) headers.set('X-Litera-User', String(ctx.userId))
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    const body = response.status === 204 ? undefined : await response.json().catch(error => {
      if (controller.signal.aborted) throw error
      if (response.ok) throw new ApiError('O servidor retornou uma resposta inválida.', 502, 'INVALID_RESPONSE')
      return {}
    })
    if (ctx) assertContext(ctx)
    if (!response.ok) throw new ApiError(body?.error?.message ?? 'Não foi possível concluir a solicitação.', response.status, body?.error?.code)
    syncState.online = true
    return body as T
  } catch (error) {
    if (ctx) assertContext(ctx)
    if (timedOut) { syncState.online = false; throw new TypeError('O servidor demorou para responder. Seus dados locais foram preservados.') }
    if (error instanceof TypeError) syncState.online = false
    throw error
  } finally {
    clearTimeout(timeout); controllers.delete(controller); options.signal?.removeEventListener('abort', abort)
  }
}
function transient(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && (error.status >= 500 || error.status === 429 || error.status === 408))
}
function readable(path: string): boolean {
  return /^\/api\/v1\/(?:books(?:\/\d+(?:\/(?:progress|highlights))?)?|home|settings)$/.test(path)
}
function mutationKind(path: string, method: string): Kind | undefined {
  if (method === 'PUT' && /^\/api\/v1\/books\/\d+\/progress$/.test(path)) return 'progress'
  if (method === 'POST' && /^\/api\/v1\/books\/\d+\/highlights$/.test(path)) return 'highlight-create'
  if (method === 'DELETE' && /^\/api\/v1\/highlights\/-?\d+$/.test(path)) return 'highlight-delete'
  if (['PUT', 'DELETE'].includes(method) && /^\/api\/v1\/books\/\d+\/favorite$/.test(path)) return 'favorite'
  if (method === 'PUT' && path === '/api/v1/settings') return 'settings'
}

async function snapshot(ctx: Context, key: string): Promise<any | undefined> {
  const bookId = Number(key.match(/^\/api\/v1\/books\/(\d+)/)?.[1])
  if (bookId) {
    const resource = await getOfflineResource(ctx.userId, bookId, key)
    if (resource) return JSON.parse(await resource.text())
    const book = await getOfflineBook(ctx.userId, bookId)
    if (book && key === stateKey(bookId)) return { book: book.metadata }
  } else if (key === '/api/v1/settings') {
    for (const book of await listOfflineBooks(ctx.userId)) {
      const resource = await getOfflineResource(ctx.userId, book.bookId, key)
      if (resource) { const saved = JSON.parse(await resource.text()); return { preferences: { ...defaultPreferences, ...saved.preferences } } }
    }
    return { preferences: { ...defaultPreferences } }
  }
}
async function seed(ctx: Context, key: string): Promise<void> {
  if (await readState(ctx, key)) return
  const value = await snapshot(ctx, key)
  if (value === undefined) return
  await transaction('readwrite', async tx => {
    if (!await request(tx.state.get([ctx.userId, key]))) putState(tx, ctx, key, value)
  }, ctx)
}
async function cacheRead(ctx: Context, key: string, body: any): Promise<any> {
  return transaction('readwrite', async tx => {
    const [stored, pending] = await Promise.all([request<State | undefined>(tx.state.get([ctx.userId, key])), operations(tx, ctx.userId)])
    if (stored && (stored.conflict || pending.some(op => op.key === key))) return stored.value
    if (key === '/api/v1/settings') body = { preferences: { ...defaultPreferences, ...body.preferences } }
    if (/^\/api\/v1\/books\/\d+$/.test(key) && !pending.some(op => op.key === `${key}/favorite`)) putState(tx, ctx, `${key}/favorite`, { favorite: Boolean(body.book.favorite) })
    putState(tx, ctx, key, body)
    return body
  }, ctx)
}
function overlayBook(book: any, stored: State[], pending: Operation[], offline: boolean): any {
  const progress = stored.find(row => row.key === stateKey(book.id, '/progress'))?.value?.progress
  const favorite = stored.find(row => row.key === stateKey(book.id, '/favorite'))?.value
  const hasPending = (key: string) => pending.some(op => op.key === key)
  const value = { ...book }
  const date = (text?: string) => text ? Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`) : 0
  if (progress && (hasPending(stateKey(book.id, '/progress')) || date(progress.lastReadAt) >= date(book.lastReadAt))) Object.assign(value, { progressRatio: progress.progressRatio, locator: progress.locator, completed: progress.completed, lastReadAt: progress.lastReadAt })
  if (favorite && (offline || hasPending(stateKey(book.id, '/favorite')))) value.favorite = favorite.favorite
  return value
}
async function localCatalog(ctx: Context, url: URL): Promise<any> {
  const downloads = await listOfflineBooks(ctx.userId)
  const [stored, pending] = await transaction('readonly', tx => Promise.all([states(tx, ctx.userId), operations(tx, ctx.userId)]), ctx)
  const books = downloads.map(book => {
    const metadata = stored.find(row => row.key === stateKey(book.bookId))?.value?.book ?? book.metadata
    return overlayBook({ ...metadata, id: book.bookId, offline: true }, stored, pending, true)
  })
  if (url.pathname === '/api/v1/home') return {
    offline: true,
    continueReading: books.filter(book => book.progressRatio > 0 && !book.completed).sort((a, b) => String(b.lastReadAt).localeCompare(String(a.lastReadAt))).slice(0, 12),
    recentlyAdded: books.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))).slice(0, 18),
  }
  const query = (url.searchParams.get('q') ?? '').trim(), search = query.toLocaleLowerCase()
  const filtered = books.filter(book => {
    if (search && !`${book.title ?? ''} ${book.author ?? ''}`.toLocaleLowerCase().includes(search)) return false
    for (const key of ['format', 'author', 'series']) if (url.searchParams.get(key) && book[key] !== url.searchParams.get(key)) return false
    if (url.searchParams.get('genre') && !book.genres?.includes(url.searchParams.get('genre'))) return false
    return url.searchParams.get('favorite') !== 'true' || book.favorite
  })
  const sort = url.searchParams.get('sort')
  filtered.sort((a, b) => sort === 'recent' ? String(b.addedAt).localeCompare(String(a.addedAt)) : sort === 'author' ? `${a.author ?? ''} ${a.title}`.localeCompare(`${b.author ?? ''} ${b.title}`) : String(a.title).localeCompare(String(b.title)))
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 24)))
  return { offline: true, books: filtered.slice((page - 1) * pageSize, page * pageSize), query, pagination: { page, pageSize, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) } }
}
async function overlayResponse(ctx: Context, body: any, offline: boolean): Promise<any> {
  if (!body?.book && !body?.books && !body?.continueReading) return body
  const [stored, pending] = await transaction('readonly', tx => Promise.all([states(tx, ctx.userId), operations(tx, ctx.userId)]), ctx)
  const downloads = new Set((await listOfflineBooks(ctx.userId)).map(book => book.bookId))
  assertContext(ctx)
  const overlay = (book: any) => overlayBook({ ...book, offline: downloads.has(book.id) }, stored, pending, offline)
  const result = { ...body }
  if (body.book) result.book = overlay(body.book)
  for (const key of ['books', 'continueReading', 'recentlyAdded']) if (body[key]) result[key] = body[key].map(overlay)
  return result
}

export async function offlineRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const parsed = new URL(url, window.location.origin)
  if (parsed.origin !== window.location.origin) throw new ApiError('A API deve pertencer ao servidor Litera.', 400)
  const ctx = context(), method = (options.method ?? 'GET').toUpperCase(), kind = mutationKind(parsed.pathname, method)
  if (ctx && kind) {
    const id = operationId()
    try { return await mutate(ctx, parsed.pathname, method, kind, options, id) }
    catch (error) {
      assertContext(ctx)
      if (error instanceof ApiError) throw error
      syncState.message = 'O armazenamento local falhou. Esta alteração só será salva se o servidor confirmar.'
      if (navigator.onLine === false) throw error
      // A temporary highlight id has no meaning to the server without its local mapping.
      if (kind === 'highlight-delete' && Number(parsed.pathname.split('/').at(-1)) < 0) throw error
      const headers = new Headers(options.headers); headers.set('X-Litera-Operation', id)
      return network<T>(url, { ...options, headers }, ctx)
    }
  }
  if (!ctx || method !== 'GET' || !readable(parsed.pathname)) return network<T>(url, options, ctx)
  let body: any
  try {
    if (navigator.onLine === false || !syncState.online) throw new TypeError('Offline')
    body = await network<any>(url, options, ctx)
  } catch (error) {
    if (!transient(error)) throw error
    syncState.online = false
    if (navigator.onLine !== false && !timer) schedule(2000)
    if (parsed.pathname === '/api/v1/books' || parsed.pathname === '/api/v1/home') return localCatalog(ctx, parsed)
    await seed(ctx, parsed.pathname)
    const stored = await readState(ctx, parsed.pathname)
    if (!stored) throw new ApiError('Estes dados não estão disponíveis offline neste dispositivo.', 503, 'OFFLINE_UNAVAILABLE')
    return overlayResponse(ctx, stored.value, true)
  }
  try {
    if (parsed.pathname !== '/api/v1/books' && parsed.pathname !== '/api/v1/home') body = await cacheRead(ctx, parsed.pathname, body)
    else for (const book of body.books ?? [...body.continueReading, ...body.recentlyAdded]) await cacheRead(ctx, stateKey(book.id), { book })
    return await overlayResponse(ctx, body, false)
  } catch (error) {
    assertContext(ctx)
    syncState.message = error instanceof Error ? error.message : 'Armazenamento local indisponível.'
    return body as T
  }
}

async function mutate(ctx: Context, url: string, method: string, kind: Kind, options: RequestInit, operationId: string): Promise<any> {
  let body = options.body ? JSON.parse(String(options.body)) : undefined
  let bookId = Number(url.match(/^\/api\/v1\/books\/(\d+)/)?.[1]) || undefined
  let key = kind === 'settings' ? url : bookId ? stateKey(bookId, kind === 'highlight-create' ? '/highlights' : kind === 'favorite' ? '/favorite' : '/progress') : ''
  if (key) await seed(ctx, key)
  if (kind === 'progress') {
    if (!['epub', 'pdf'].includes(body?.format)) throw new ApiError('Formato de progresso inválido.', 400)
    const normalized = normalizeProgress(body.format, body.locator as ReadingLocator, body.progressRatio)
    body = { ...normalized, format: body.format, ...(typeof body.completed === 'boolean' ? { completed: body.completed } : {}), revision: body.revision }
  }
  if (kind === 'highlight-create' && (typeof body?.quoteText !== 'string' || !body.quoteText.trim() || body.quoteText.length > 10_000 || !body.locator?.type)) throw new ApiError('Destaque inválido.', 400)
  const result = await transaction('readwrite', async tx => {
    const [all, pending] = await Promise.all([states(tx, ctx.userId), operations(tx, ctx.userId)])
    const counter = all.find(row => row.key === '$sequence')?.value ?? 0
    const sequence = counter + 1
    if (!Number.isSafeInteger(sequence)) throw new Error('Limite de operações locais atingido.')
    putState(tx, ctx, '$sequence', sequence)
    let tempId: number | undefined, response: any
    if (kind === 'highlight-delete') {
      const requestedId = Number(url.split('/').at(-1))
      const alias = all.find(row => row.key === `$highlight:${requestedId}`)?.value
      const actualId = alias?.id ?? requestedId
      const highlightState = all.find(row => row.key.endsWith('/highlights') && row.value?.highlights?.some((item: any) => item.id === requestedId || item.id === actualId))
      bookId = alias?.bookId ?? (Number(highlightState?.key.match(/books\/(\d+)/)?.[1]) || undefined)
      if (!bookId) throw new ApiError('Destaque não encontrado neste dispositivo.', 404)
      key = stateKey(bookId, '/highlights'); tempId = actualId < 0 ? actualId : undefined
      url = `/api/v1/highlights/${actualId}`
      const create = pending.find(op => op.kind === 'highlight-create' && op.tempId === requestedId)
      const highlights = (highlightState?.value?.highlights ?? []).filter((item: any) => item.id !== requestedId && item.id !== actualId)
      putState(tx, ctx, key, { highlights })
      if (create?.phase === 'queued') { tx.pending.delete([ctx.userId, create.id]); return undefined }
    } else {
      const stored = all.find(row => row.key === key)
      if (kind === 'progress') {
        if (stored?.conflict) throw new ApiError('Há um conflito de posição. Reabra o livro usando a posição do servidor para continuar sincronizando.', 409, 'STALE_PROGRESS')
        body.revision = stored?.value?.progress?.revision ?? body.revision ?? 0
        response = { progress: { ...body, completed: body.completed ?? body.progressRatio >= .98, lastReadAt: new Date().toISOString() } }
      } else if (kind === 'highlight-create') {
        tempId = -sequence
        const highlight = { ...body, quoteText: body.quoteText.trim(), id: tempId, rating: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        response = { highlight }
        putState(tx, ctx, key, { highlights: [highlight, ...(stored?.value?.highlights ?? [])] })
      } else if (kind === 'favorite') response = { favorite: method === 'PUT' }
      else response = { preferences: body }
      if (kind !== 'highlight-create') putState(tx, ctx, key, response)
    }
    // A sent operation stays immutable after timeout: it may already be committed.
    if (kind !== 'highlight-create' && kind !== 'highlight-delete') for (const op of pending) {
      if (op.key === key && (op.phase === 'queued' || op.phase === 'failed')) tx.pending.delete([ctx.userId, op.id])
    }
    tx.pending.put({ userId: ctx.userId, id: operationId, sequence, key, kind, bookId, url, method, body, tempId, phase: 'queued', attempts: 0, nextAttemptAt: 0 } satisfies Operation)
    return method === 'DELETE' ? undefined : response
  }, ctx)
  await refresh(ctx).catch(() => undefined)
  assertContext(ctx)
  schedule(500)
  return result
}

async function refresh(ctx = context()): Promise<void> {
  if (!ctx) { syncState.pending = 0; syncState.conflicts = []; return }
  const pending = await transaction('readonly', tx => operations(tx, ctx.userId), ctx)
  assertContext(ctx)
  syncState.pending = pending.length
  syncState.conflicts = [...new Set(pending.filter(op => op.kind === 'progress' && op.phase === 'conflict').map(op => op.bookId!))].map(bookId => ({ bookId, kind: 'progress' as const }))
}
function schedule(delay: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; void flushOfflineSync() }, delay)
}
async function claim(ctx: Context): Promise<Operation | undefined> {
  return transaction('readwrite', async tx => {
    const pending = (await operations(tx, ctx.userId)).sort((a, b) => a.sequence - b.sequence)
    const blocked = new Set<string>()
    for (const op of pending) {
      if (blocked.has(op.key)) continue
      if (op.phase === 'failed') continue // A terminal rejection must not starve independent later highlights.
      blocked.add(op.key)
      if (op.phase === 'conflict' || op.nextAttemptAt > Date.now() || (op.leaseOwner !== owner && (op.leaseUntil ?? 0) > Date.now())) continue
      if (op.kind === 'highlight-delete' && op.tempId) continue
      op.phase = 'sent'; op.leaseOwner = owner; op.leaseUntil = Date.now() + LEASE_MS
      tx.pending.put(op)
      return op
    }
  }, ctx)
}
async function acknowledge(ctx: Context, op: Operation, body: any): Promise<void> {
  await transaction('readwrite', async tx => {
    if (!await request(tx.pending.get([ctx.userId, op.id]))) return
    const [stored, pending] = await Promise.all([request<State | undefined>(tx.state.get([ctx.userId, op.key])), operations(tx, ctx.userId)])
    tx.pending.delete([ctx.userId, op.id])
    const successors = pending.filter(item => item.id !== op.id && item.key === op.key)
    if (op.kind === 'progress') {
      if (successors.length) {
        for (const item of successors) if (item.phase === 'queued') { item.body.revision = body.progress.revision; tx.pending.put(item) }
        putState(tx, ctx, op.key, { progress: { ...stored?.value?.progress, revision: body.progress.revision } })
      } else putState(tx, ctx, op.key, body)
    } else if (op.kind === 'highlight-create') {
      const highlight = body.highlight
      putState(tx, ctx, op.key, { highlights: (stored?.value?.highlights ?? []).map((item: any) => item.id === op.tempId ? highlight : item) })
      putState(tx, ctx, `$highlight:${op.tempId}`, { id: highlight.id, bookId: op.bookId })
      for (const item of successors) if (item.kind === 'highlight-delete' && item.tempId === op.tempId) { item.url = `/api/v1/highlights/${highlight.id}`; item.tempId = undefined; tx.pending.put(item) }
    } else if (!successors.length && op.kind === 'settings') putState(tx, ctx, op.key, body)
  }, ctx)
}
async function failed(ctx: Context, op: Operation, error: unknown): Promise<void> {
  let server: any
  if (error instanceof ApiError && error.code === 'STALE_PROGRESS') {
    try { server = await network(op.url, {}, ctx) } catch { /* Fetch again during explicit resolution. */ }
  }
  await transaction('readwrite', async tx => {
    const current = await request<Operation | undefined>(tx.pending.get([ctx.userId, op.id]))
    if (!current) return
    current.leaseUntil = 0; current.attempts++
    current.error = error instanceof Error ? error.message : 'Falha de sincronização.'
    if (error instanceof ApiError && error.code === 'STALE_PROGRESS') {
      current.phase = 'conflict'
      const stored = await request<State | undefined>(tx.state.get([ctx.userId, op.key]))
      putState(tx, ctx, op.key, server ?? stored?.value, { local: stored?.value, server })
    } else if (transient(error) || (error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_USER_MISMATCH'))) {
      current.nextAttemptAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(current.attempts, 6)) + Math.floor(Math.random() * 500)
    } else current.phase = 'failed'
    tx.pending.put(current)
  }, ctx)
}
async function drain(ctx: Context): Promise<void> {
  await importLegacyDrafts(ctx)
  await refresh(ctx)
  if (navigator.onLine === false) { syncState.online = false; return }
  if (!syncState.pending) {
    if (!syncState.online) await network('/health', {}, ctx)
    probeFailures = 0
    return
  }
  const session = await network<{ user: { id: number } }>('/api/v1/auth/me', {}, ctx)
  if (session.user.id !== ctx.userId) throw new ApiError('A sessão pertence a outra conta. Entre novamente antes de sincronizar.', 409, 'SESSION_USER_MISMATCH')
  probeFailures = 0
  syncState.syncing = true
  let op: Operation | undefined
  while ((op = await claim(ctx))) {
    try {
      const body = await network(op.url, { method: op.method, headers: { 'X-Litera-Operation': op.id }, ...(op.body !== undefined ? { body: JSON.stringify(op.body) } : {}) }, ctx)
      await acknowledge(ctx, op, body)
      syncState.lastSyncedAt = new Date().toISOString()
    } catch (error) {
      assertContext(ctx)
      if (op.kind === 'highlight-delete' && error instanceof ApiError && error.status === 404) await acknowledge(ctx, op, undefined)
      else {
        await failed(ctx, op, error)
        syncState.message = error instanceof Error ? error.message : 'Falha de sincronização.'
        if (transient(error) || (error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_USER_MISMATCH'))) break
      }
    }
  }
  await refresh(ctx)
  if (!syncState.pending) syncState.message = 'Sincronizado.'
  const pending = await transaction('readonly', tx => operations(tx, ctx.userId), ctx)
  const heads = new Map<string, Operation>()
  for (const item of pending.sort((a, b) => a.sequence - b.sequence)) if (!heads.has(item.key)) heads.set(item.key, item)
  const retryable = [...heads.values()].filter(item => item.phase === 'queued' || item.phase === 'sent')
  if (retryable.length) schedule(Math.max(1000, Math.min(...retryable.map(item => Math.max(item.nextAttemptAt, item.leaseOwner !== owner ? item.leaseUntil ?? 0 : 0))) - Date.now()))
}

export async function flushOfflineSync(): Promise<void> {
  if (running) return running
  const ctx = context()
  if (!ctx) { await refresh(); return }
  if (timer) clearTimeout(timer)
  timer = undefined
  running = drain(ctx).catch(error => {
    if (ctx.userId !== getOfflineUser() || ctx.generation !== offlineContext.generation) return
    syncState.message = error instanceof Error ? error.message : 'Não foi possível sincronizar.'
    if (transient(error)) { syncState.online = false; probeFailures++; schedule(Math.min(60_000, 2000 * 2 ** Math.min(probeFailures, 5))) }
  }).finally(() => { running = undefined; syncState.syncing = false })
  return running
}

export function initializeOfflineSync(): () => void {
  if (cleanup) return cleanup
  const online = () => { syncState.online = true; void flushOfflineSync() }
  const offline = () => { syncState.online = false }
  const foreground = () => { if (document.visibilityState === 'visible') void flushOfflineSync() }
  const account = () => {
    for (const controller of controllers) controller.abort()
    if (timer) clearTimeout(timer)
    syncState.pending = 0; syncState.conflicts = []; syncState.message = ''; syncState.lastSyncedAt = null
    void (running ?? Promise.resolve()).finally(() => { void flushOfflineSync() })
  }
  window.addEventListener('online', online); window.addEventListener('offline', offline)
  window.addEventListener('litera-account-changed', account); document.addEventListener('visibilitychange', foreground)
  cleanup = () => {
    window.removeEventListener('online', online); window.removeEventListener('offline', offline)
    window.removeEventListener('litera-account-changed', account); document.removeEventListener('visibilitychange', foreground)
    if (timer) clearTimeout(timer)
    cleanup = undefined
  }
  void flushOfflineSync()
  return cleanup
}

export async function clearReadingUser(userId: number): Promise<void> {
  try { clearOfflineProgressUser(localStorage, userId) } catch { /* Storage may be denied. */ }
  await transaction('readwrite', async tx => {
    const [stored, pending] = await Promise.all([states(tx, userId), operations(tx, userId)])
    for (const row of stored) tx.state.delete([userId, row.key])
    for (const op of pending) tx.pending.delete([userId, op.id])
  })
  await refresh()
}

async function importLegacyDrafts(ctx: Context): Promise<void> {
  let keys: string[]
  try { keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '').filter(key => key.startsWith(`litera-offline-progress-u${ctx.userId}-b`)) }
  catch { return }
  for (const key of keys) {
    const bookId = Number(key.split('-b').at(-1))
    const draft = readOfflineProgress(localStorage, ctx.userId, bookId)
    if (!draft) continue
    await transaction('readwrite', async tx => {
      const target = stateKey(bookId, '/progress')
      if ((await operations(tx, ctx.userId)).some(op => op.key === target)) return
      const counter = await request<State | undefined>(tx.state.get([ctx.userId, '$sequence']))
      const sequence = (counter?.value ?? 0) + 1
      putState(tx, ctx, '$sequence', sequence)
      const body = { ...draft, revision: draft.revision ?? 0 }
      putState(tx, ctx, target, { progress: { ...body, completed: body.progressRatio >= .98, lastReadAt: new Date().toISOString() } })
      tx.pending.put({ userId: ctx.userId, id: operationId(), sequence, key: target, kind: 'progress', bookId, url: target, method: 'PUT', body, phase: 'queued', attempts: 0, nextAttemptAt: 0 } satisfies Operation)
    }, ctx)
    localStorage.removeItem(key)
  }
}

export async function resolveProgressConflict(bookId: number, choice: 'server'): Promise<void> {
  const ctx = context()
  if (!ctx || choice !== 'server') throw new ApiError('Uma conta ativa é necessária.', 401)
  const key = stateKey(bookId, '/progress')
  const server = await network(key, {}, ctx)
  await transaction('readwrite', async tx => {
    const stored = await request<State | undefined>(tx.state.get([ctx.userId, key]))
    if (!stored?.conflict) return
    for (const op of await operations(tx, ctx.userId)) if (op.key === key) tx.pending.delete([ctx.userId, op.id])
    putState(tx, ctx, key, server)
  }, ctx)
  await refresh(ctx)
  syncState.message = 'Posição do servidor restaurada.'
}

export type OfflineBook = {
  userId: number
  bookId: number
  generation: string
  format: 'epub' | 'pdf'
  metadata: any
  revision: string
  downloadedAt: string
  bytes: number
}

export type OfflineStage = { userId: number; bookId: number; generation: string; expiresAt: number }
type StoredBinary = { blob: Blob | ArrayBuffer; mimeType?: string }
type Resource = { userId: number; bookId: number; generation: string; url: string } & StoredBinary
const DATABASE = 'litera-offline-books'
const VERSION = 1
const LEASE_MS = 120_000
let database: Promise<IDBDatabase> | undefined
let useArrayBuffers = false

function restoredBlob(value: StoredBinary | undefined): Blob | undefined {
  if (!value) return undefined
  return value.blob instanceof Blob ? value.blob : new Blob([value.blob], { type: value.mimeType ?? 'application/octet-stream' })
}

function ids(userId: number, bookId?: number): void {
  if (!Number.isSafeInteger(userId) || userId < 1 || (bookId !== undefined && (!Number.isSafeInteger(bookId) || bookId < 1))) throw new Error('Conta ou livro offline inválido.')
}

// Appearance belongs to the reader, not to the stored canonical EPUB chapter.
// PDF figure's page parameter is ignored by the server; asset identifies the file.
export function normalizeOfflineUrl(value: string): string {
  const origin = globalThis.location?.origin ?? 'http://localhost'
  const url = new URL(value, origin)
  if (url.origin !== origin || !url.pathname.startsWith('/api/v1/')) throw new Error('Recurso offline fora da aplicação.')
  if (/\/epub\/chapter$/.test(url.pathname)) for (const key of ['scale', 'theme', 'lineHeight', 'margins']) url.searchParams.delete(key)
  if (/\/pdf\/figure$/.test(url.pathname)) url.searchParams.delete('page')
  url.searchParams.sort()
  return url.pathname + url.search
}

function snapshotUrl(url: string, bookId: number): boolean {
  return url === '/api/v1/settings' || url === `/api/v1/books/${bookId}` || url === `/api/v1/books/${bookId}/progress` || url === `/api/v1/books/${bookId}/highlights`
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error) })
}

async function transaction<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = db.transaction(stores, mode)
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new DOMException('Operação offline cancelada.', 'AbortError'))
    tx.onerror = () => { /* onabort owns the transaction failure. */ }
  })
  // Attach immediately: a request can fail before work unwinds its promise chain.
  void finished.catch(() => undefined)
  try { const result = await work(tx); await finished; return result }
  catch (error) { try { tx.abort() } catch { /* Already completed/aborted. */ }; await finished.catch(() => undefined); throw error }
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) throw new Error('Este navegador não permite armazenamento offline. A leitura online continua disponível.')
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, VERSION)
    let blocked = false
    opening.onupgradeneeded = event => {
      const db = opening.result
      // Add future migrations by oldVersion; never recreate existing stores.
      if (event.oldVersion < 1) {
        const books = db.createObjectStore('books', { keyPath: ['userId', 'bookId'] })
        books.createIndex('user', 'userId')
        const resources = db.createObjectStore('resources', { keyPath: ['userId', 'bookId', 'generation', 'url'] })
        resources.createIndex('generation', ['userId', 'bookId', 'generation'])
        resources.createIndex('book', ['userId', 'bookId'])
        resources.createIndex('user', 'userId')
        const stages = db.createObjectStore('stages', { keyPath: ['userId', 'bookId'] })
        stages.createIndex('user', 'userId')
        const snapshots = db.createObjectStore('snapshots', { keyPath: ['userId', 'bookId', 'url'] })
        snapshots.createIndex('user', 'userId')
        const retired = db.createObjectStore('retired', { keyPath: ['userId', 'bookId', 'generation'] })
        retired.createIndex('user', 'userId')
        retired.createIndex('book', ['userId', 'bookId'])
      }
    }
    opening.onerror = () => reject(opening.error)
    opening.onblocked = () => { blocked = true; reject(new Error('Feche as outras abas do Litera para atualizar o armazenamento offline.')) }
    opening.onsuccess = () => {
      const db = opening.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); database = undefined }
      void prepareDatabase(db).then(() => resolve(db), error => { db.close(); reject(error) })
    }
  }).catch(error => { database = undefined; throw error })
  return database
}

function deleteIndex(store: IDBObjectStore, index: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = store.index(index).openKeyCursor(IDBKeyRange.only(key))
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      if (!cursor.result) { resolve(); return }
      store.delete(cursor.result.primaryKey)
      cursor.result.continue()
    }
  })
}

async function prepareDatabase(db: IDBDatabase): Promise<void> {
  // A shared lifetime lock covers all captured reader generations in this tab.
  // On a cold start an exclusive probe can reclaim retired generations; another
  // live tab (including a background reader) makes the probe fail safely.
  if (globalThis.navigator?.locks) {
    try {
      const probe = new AbortController()
      let probeExpired = false
      const lockRequest = navigator.locks.request('litera-offline-readers', { mode: 'exclusive', ifAvailable: true, signal: probe.signal }, lock => probeExpired ? undefined : cleanupDatabase(db, Boolean(lock)))
      let probeTimeout: ReturnType<typeof setTimeout> | undefined
      // WebKit may neither settle the request nor honor AbortSignal. Race the
      // API itself and make a late callback inert instead of blocking storage.
      try {
        await Promise.race([lockRequest, new Promise<never>((_resolve, reject) => { probeTimeout = setTimeout(() => reject(new Error('Web Lock indisponível')), 2_000) })])
      } finally {
        if (probeTimeout) clearTimeout(probeTimeout)
        probeExpired = true
        probe.abort()
        void lockRequest.catch(() => undefined)
      }
      await new Promise<void>((resolve, reject) => {
        let releaseLifetime: (() => void) | undefined
        const lifetime = new Promise<void>(release => { releaseLifetime = release })
        const waiting = new AbortController()
        let waitingExpired = false
        const waitingTimeout = setTimeout(() => { waitingExpired = true; waiting.abort(); reject(new Error('Web Lock indisponível')) }, 2_000)
        const release = () => releaseLifetime?.()
        // WebKit persistent profiles may retain an unresolved lock callback
        // across a document navigation. Release explicitly; a live replacement
        // document acquires its own shared lock during startup.
        void navigator.locks.request('litera-offline-readers', { mode: 'shared', signal: waiting.signal }, () => {
          if (waitingExpired) return
          clearTimeout(waitingTimeout)
          globalThis.addEventListener?.('pagehide', release, { once: true })
          globalThis.addEventListener?.('unload', release, { once: true })
          resolve()
          return lifetime.finally(() => {
            globalThis.removeEventListener?.('pagehide', release)
            globalThis.removeEventListener?.('unload', release)
          })
        }).catch(reject)
      })
      return
    } catch { /* Without a reliable lock, preserve retired reader generations. */ }
  }
  await cleanupDatabase(db)
}

async function cleanupDatabase(db: IDBDatabase, reclaimRetired = false): Promise<void> {
  await transaction(db, ['books', 'stages', 'resources', 'retired'], 'readwrite', async tx => {
    const books = await request<OfflineBook[]>(tx.objectStore('books').getAll())
    const stages = await request<OfflineStage[]>(tx.objectStore('stages').getAll())
    const live = new Set(books.map(book => JSON.stringify([book.userId, book.bookId, book.generation])))
    if (reclaimRetired) await request(tx.objectStore('retired').clear())
    else for (const book of await request<Array<{ userId: number; bookId: number; generation: string }>>(tx.objectStore('retired').getAll())) live.add(JSON.stringify([book.userId, book.bookId, book.generation]))
    for (const stage of stages) {
      if (stage.expiresAt > Date.now()) live.add(JSON.stringify([stage.userId, stage.bookId, stage.generation]))
      else tx.objectStore('stages').delete([stage.userId, stage.bookId])
    }
    // Key-only cursor avoids loading every book Blob into memory during startup.
    await new Promise<void>((resolve, reject) => {
      const store = tx.objectStore('resources'), cursor = store.openKeyCursor()
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        if (!cursor.result) { resolve(); return }
        const key = cursor.result.primaryKey as [number, number, string, string]
        if (!live.has(JSON.stringify(key.slice(0, 3)))) store.delete(key)
        cursor.result.continue()
      }
    })
  })
}

export async function cleanupOfflineOrphans(): Promise<void> { await cleanupDatabase(await openDatabase()) }

export async function listOfflineBooks(userId: number): Promise<OfflineBook[]> {
  ids(userId)
  return transaction(await openDatabase(), ['books'], 'readonly', tx => request(tx.objectStore('books').index('user').getAll(userId)))
}

export async function getOfflineBook(userId: number, bookId: number): Promise<OfflineBook | undefined> {
  ids(userId, bookId)
  return transaction(await openDatabase(), ['books'], 'readonly', tx => request(tx.objectStore('books').get([userId, bookId])))
}

export async function beginOfflineDownload(userId: number, bookId: number): Promise<OfflineStage> {
  ids(userId, bookId)
  const stage: OfflineStage = { userId, bookId, generation: crypto.randomUUID(), expiresAt: Date.now() + LEASE_MS }
  return transaction(await openDatabase(), ['stages', 'resources'], 'readwrite', async tx => {
    const stages = tx.objectStore('stages')
    const previous = await request<OfflineStage | undefined>(stages.get([userId, bookId]))
    if (previous && previous.expiresAt > Date.now()) throw new Error('Este livro já está sendo baixado em outra aba. Aguarde ou tente novamente em dois minutos.')
    if (previous) await deleteIndex(tx.objectStore('resources'), 'generation', [userId, bookId, previous.generation])
    await request(stages.put(stage))
    return stage
  })
}

async function requireStage(tx: IDBTransaction, stage: OfflineStage): Promise<OfflineStage> {
  const current = await request<OfflineStage | undefined>(tx.objectStore('stages').get([stage.userId, stage.bookId]))
  if (!current || current.generation !== stage.generation || current.expiresAt <= Date.now()) throw new DOMException('O download foi cancelado ou expirou. Tente novamente.', 'AbortError')
  return current
}

export async function renewOfflineDownload(stage: OfflineStage): Promise<void> {
  await transaction(await openDatabase(), ['stages'], 'readwrite', async tx => {
    const current = await requireStage(tx, stage)
    await request(tx.objectStore('stages').put({ ...current, expiresAt: Date.now() + LEASE_MS }))
  })
}

export async function putOfflineResource(stage: OfflineStage, url: string, blob: Blob): Promise<void> {
  const normalized = normalizeOfflineUrl(url)
  if (!normalized.startsWith(`/api/v1/books/${stage.bookId}/`) && normalized !== `/api/v1/books/${stage.bookId}` && normalized !== '/api/v1/settings') throw new Error('Recurso de outro livro não pode ser salvo neste download.')
  const persist = async (binary: Blob | ArrayBuffer) => transaction(await openDatabase(), ['stages', 'resources'], 'readwrite', async tx => {
      await requireStage(tx, stage)
      await request(tx.objectStore('resources').put({ userId: stage.userId, bookId: stage.bookId, generation: stage.generation, url: normalized, blob: binary, mimeType: blob.type } satisfies Resource))
      await request(tx.objectStore('stages').put({ ...stage, expiresAt: Date.now() + LEASE_MS }))
    })
  if (useArrayBuffers) { await persist(await blob.arrayBuffer()); return }
  try { await persist(blob) }
  catch (error) {
    // Some WebKit storage backends cannot serialize Blob/File but do support
    // ArrayBuffer. Retry only representation errors, after the first transaction
    // has aborted. Never swallow quota, authorization or cancelled-stage errors.
    const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
    if (!['UnknownError', 'DataCloneError', 'NotSupportedError'].includes(String(name))) throw error
    await persist(await blob.arrayBuffer())
    useArrayBuffers = true
  }
}

export async function commitOfflineDownload(stage: OfflineStage, book: OfflineBook, requiredUrls: string[], isCurrent: () => boolean = () => true): Promise<void> {
  if (book.userId !== stage.userId || book.bookId !== stage.bookId || book.generation !== stage.generation || !requiredUrls.length) throw new Error('Pacote offline inválido.')
  const db = await openDatabase()
  await transaction(db, ['stages', 'books', 'resources', 'snapshots', 'retired'], 'readwrite', async tx => {
    await requireStage(tx, stage)
    const resources = tx.objectStore('resources')
    for (const url of new Set(requiredUrls.map(normalizeOfflineUrl))) {
      const resource = await request<Resource | undefined>(resources.get([stage.userId, stage.bookId, stage.generation, url]))
      if (!resource) throw new Error('Download incompleto. Tente salvar o livro novamente.')
      if (snapshotUrl(url, stage.bookId)) await request(tx.objectStore('snapshots').put({ userId: stage.userId, bookId: stage.bookId, url, blob: resource.blob, mimeType: resource.mimeType }))
    }
    const previous = await request<OfflineBook | undefined>(tx.objectStore('books').get([stage.userId, stage.bookId]))
    if (previous && previous.generation !== stage.generation) await request(tx.objectStore('retired').put({ userId: previous.userId, bookId: previous.bookId, generation: previous.generation }))
    if (!isCurrent()) throw new DOMException('Download cancelado por mudança de conta.', 'AbortError')
    await request(tx.objectStore('books').put(book))
    if (!isCurrent()) throw new DOMException('Download cancelado por mudança de conta.', 'AbortError')
    await request(tx.objectStore('stages').delete([stage.userId, stage.bookId]))
  })
}

export async function discardOfflineDownload(stage: OfflineStage): Promise<void> {
  await transaction(await openDatabase(), ['stages', 'resources', 'books', 'retired'], 'readwrite', async tx => {
    const book = await request<OfflineBook | undefined>(tx.objectStore('books').get([stage.userId, stage.bookId]))
    // A late/repeated cancellation is harmless after publication.
    if (book?.generation === stage.generation || await request(tx.objectStore('retired').get([stage.userId, stage.bookId, stage.generation]))) return
    const current = await request<OfflineStage | undefined>(tx.objectStore('stages').get([stage.userId, stage.bookId]))
    if (current?.generation === stage.generation) await request(tx.objectStore('stages').delete([stage.userId, stage.bookId]))
    await deleteIndex(tx.objectStore('resources'), 'generation', [stage.userId, stage.bookId, stage.generation])
  })
}

export async function removeOfflineBook(userId: number, bookId: number): Promise<void> {
  ids(userId, bookId)
  await transaction(await openDatabase(), ['books', 'resources', 'stages', 'retired'], 'readwrite', async tx => {
    await request(tx.objectStore('stages').delete([userId, bookId]))
    await request(tx.objectStore('books').delete([userId, bookId]))
    await deleteIndex(tx.objectStore('resources'), 'book', [userId, bookId])
    await deleteIndex(tx.objectStore('retired'), 'book', [userId, bookId])
  })
  if ('caches' in globalThis) {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(`litera-books-u${userId}-b${bookId}-`)).map(name => caches.delete(name)))
  }
}

export async function clearOfflineUser(userId: number): Promise<void> {
  ids(userId)
  // Cleanup both backends even if either browser API is denied.
  const results = await Promise.allSettled([
    openDatabase().then(db => transaction(db, ['books', 'resources', 'stages', 'snapshots', 'retired'], 'readwrite', async tx => {
      for (const name of ['stages', 'books', 'resources', 'snapshots', 'retired']) await deleteIndex(tx.objectStore(name), 'user', userId)
    })),
    (async () => {
      if (!('caches' in globalThis)) return
      const names = await caches.keys()
      await Promise.all(names.filter(name => name.startsWith(`litera-books-u${userId}-`) || name.startsWith(`litera-data-u${userId}-`)).map(name => caches.delete(name)))
    })(),
  ])
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

// Non-destructive v1 compatibility: old packets stay readable by exact resource
// (canonical chapter lookup also accepts their saved appearance). They are not
// promoted to the new complete-package catalog: v1 PDFs lack adapted pages and
// v1 EPUBs may lack covers/assets. A successful new download replaces them.
async function legacyResource(userId: number, bookId: number, url: string): Promise<Blob | undefined> {
  if (!('caches' in globalThis)) return undefined
  const names = await caches.keys(), name = `litera-books-u${userId}-b${bookId}-v1`
  if (!names.includes(name)) return undefined
  const cache = await caches.open(name)
  if (!await cache.match(`/_litera/offline/books/${bookId}`)) return undefined
  let response = await cache.match(url)
  if (!response && /\/epub\/chapter\?/.test(url)) {
    for (const key of await cache.keys()) {
      if (new URL(key.url).pathname.endsWith('/epub/chapter') && normalizeOfflineUrl(key.url) === url) { response = await cache.match(key); break }
    }
  }
  if (!response && url === '/api/v1/settings' && names.includes(`litera-data-u${userId}-v1`)) response = await (await caches.open(`litera-data-u${userId}-v1`)).match(url)
  return response?.blob()
}

export async function getOfflineResource(userId: number, bookId: number, url: string, generation?: string): Promise<Blob | undefined> {
  ids(userId, bookId)
  const normalized = normalizeOfflineUrl(url)
  const stored = await transaction(await openDatabase(), ['books', 'resources', 'snapshots', 'retired'], 'readonly', async tx => {
    const book = await request<OfflineBook | undefined>(tx.objectStore('books').get([userId, bookId]))
    if (generation || book) {
      const selected = generation ?? book!.generation
      const allowed = book?.generation === selected || await request(tx.objectStore('retired').get([userId, bookId, selected]))
      const resource = allowed ? await request<Resource | undefined>(tx.objectStore('resources').get([userId, bookId, selected, normalized])) : undefined
      return { resource, committed: true }
    }
    const snapshot = snapshotUrl(normalized, bookId) ? await request<StoredBinary | undefined>(tx.objectStore('snapshots').get([userId, bookId, normalized])) : undefined
    return { resource: snapshot, committed: false }
  })
  // Never fill holes in a new generation with potentially different v1 content.
  return restoredBlob(stored.resource) ?? (stored.committed ? undefined : legacyResource(userId, bookId, normalized))
}

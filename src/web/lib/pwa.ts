import { reactive, watch } from 'vue'
import { cssResourceReferences } from '../../shared/epub-document'
import { getOfflineUser, offlineContext, setOfflineContext } from './offline-context'
import { ensureOfflineShell } from './pwa-shell'
import {
  beginOfflineDownload, clearOfflineUser as clearStoredUser, commitOfflineDownload,
  discardOfflineDownload, getOfflineBook, listOfflineBooks, normalizeOfflineUrl,
  putOfflineResource, putOfflineAlias, removeOfflineBook, renewOfflineDownload, type OfflineStage,
} from './offline-store'

export { offlineSupport, initializePwa, installPwa, pwaInstall, pwaUpdate, applyPwaUpdate, ensureOfflineShell } from './pwa-shell'
export type OfflineSaveProgress = { completed: number; total: number; label: string }
export type OfflineDownloadState = OfflineSaveProgress & {
  status: 'not-downloaded' | 'queued' | 'downloading' | 'downloaded' | 'updating' | 'error'
  error?: string
  phase?: 'preparing' | 'transferring' | 'verifying'
  bytesReceived?: number
  units?: 'chapters' | 'pages'
}
export const downloadStates = reactive<Record<number, OfflineDownloadState>>({})
type Download = { userId: number; bookId: number; contextGeneration: number; controller: AbortController; promise?: Promise<void>; failure?: unknown }
const downloads = new Map<number, Download>()
let activeRequests = 0
const waitingRequests: Array<() => void> = []

function requestSlot(task: Download): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const signal = task.controller.signal
    const cancel = () => { const index = waitingRequests.indexOf(enter); if (index >= 0) waitingRequests.splice(index, 1); reject(new DOMException('Download cancelado.', 'AbortError')) }
    const enter = () => {
      signal.removeEventListener('abort', cancel)
      if (!current(task)) { reject(new DOMException('Download cancelado.', 'AbortError')); waitingRequests.shift()?.(); return }
      activeRequests++
      let released = false
      resolve(() => { if (released) return; released = true; activeRequests--; waitingRequests.shift()?.() })
    }
    if (signal.aborted) { cancel(); return }
    if (activeRequests < 4) enter()
    else { waitingRequests.push(enter); signal.addEventListener('abort', cancel, { once: true }) }
  })
}

async function downloadTogether<T>(task: Download, items: T[], work: (item: T, index: number) => Promise<unknown>, concurrency = 3): Promise<void> {
  let next = 0, failure: { error: unknown } | undefined
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure) {
      const index = next++; if (index >= items.length) return
      try { check(task); await work(items[index]!, index) }
      catch (error) {
        failure ??= { error }
        if (!task.controller.signal.aborted) { task.failure = error; task.controller.abort() }
      }
    }
  }))
  if (failure) throw failure.error
}

function current(task: Download): boolean {
  return !task.controller.signal.aborted && getOfflineUser() === task.userId && offlineContext.generation === task.contextGeneration
}
function check(task: Download): void {
  if (!current(task)) throw new DOMException('Download cancelado.', 'AbortError')
}
function abortable<T>(task: Download, promise: Promise<T>): Promise<T> {
  // Only cancel this waiter; the shell preparation is shared with other callers.
  return new Promise<T>((resolve, reject) => {
    const signal = task.controller.signal
    const abort = () => reject(new DOMException('Download cancelado.', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}
function ownsState(task: Download): boolean {
  return getOfflineUser() === task.userId && offlineContext.generation === task.contextGeneration && downloads.get(task.bookId) === task
}
function changed(): void { window.dispatchEvent(new Event('litera-downloads-changed')) }

watch(() => [offlineContext.userId, offlineContext.generation], () => {
  for (const task of downloads.values()) task.controller.abort()
  for (const key of Object.keys(downloadStates)) delete downloadStates[Number(key)]
  const userId = getOfflineUser(), generation = offlineContext.generation
  if (!userId) return
  void listOfflineBooks(userId).then(books => {
    if (getOfflineUser() !== userId || offlineContext.generation !== generation) return
    for (const book of books) if (!downloads.has(book.bookId)) downloadStates[book.bookId] = { status: 'downloaded', completed: book.bytes, total: book.bytes, label: 'Disponível offline.' }
  }).catch(() => { /* Storage denial must not prevent an online session. */ })
}, { flush: 'sync', immediate: true })

export function setActiveOfflineUser(userId?: number): void { setOfflineContext(userId) }

export async function isBookOffline(bookId: number): Promise<boolean> {
  const userId = getOfflineUser(), generation = offlineContext.generation
  if (!userId) return false
  const book = await getOfflineBook(userId, bookId)
  return Boolean(book && getOfflineUser() === userId && offlineContext.generation === generation)
}

export function cancelBookDownload(bookId: number): void { downloads.get(bookId)?.controller.abort() }

export async function clearOfflineUser(userId: number): Promise<void> {
  const tasks = [...downloads.values()].filter(task => task.userId === userId)
  for (const task of tasks) task.controller.abort()
  try { await clearStoredUser(userId) }
  finally {
    await Promise.allSettled(tasks.map(task => task.promise))
    if (getOfflineUser() === userId || !getOfflineUser()) for (const key of Object.keys(downloadStates)) delete downloadStates[Number(key)]
    changed()
  }
}

export async function removeBookOffline(bookId: number): Promise<void> {
  const userId = getOfflineUser(), generation = offlineContext.generation
  if (!userId) return
  const task = downloads.get(bookId)
  task?.controller.abort()
  await removeOfflineBook(userId, bookId)
  await task?.promise?.catch(() => undefined)
  if (getOfflineUser() === userId && offlineContext.generation === generation) downloadStates[bookId] = { status: 'not-downloaded', completed: 0, total: 0, label: 'Download removido. Sua leitura foi preservada.' }
  changed()
}

function actionableError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  if (name === 'QuotaExceededError') return 'Não há espaço suficiente. Remova downloads ou libere espaço no dispositivo e tente novamente.'
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'UnknownError') return 'O navegador não permitiu salvar os dados. Verifique o armazenamento e as permissões deste site. A leitura online continua disponível.'
  if (error instanceof TypeError) return 'A conexão foi interrompida. Reconecte e tente salvar novamente; um download anterior foi preservado, se existente.'
  return error instanceof Error ? error.message : 'Não foi possível salvar o livro. Tente novamente.'
}

class RetryableDownloadError extends Error {
  constructor(message: string, readonly retryAfter?: number) { super(message) }
}

async function fetchBlob(task: Download, url: string, label: string, report: (progress: OfflineSaveProgress) => void): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    try { return await fetchBlobAttempt(task, url, label, report) }
    catch (error) {
      check(task)
      const retryable = error instanceof TypeError || error instanceof RetryableDownloadError || (error instanceof DOMException && error.name === 'TimeoutError')
      if (!retryable || attempt >= 2) throw error
      const delay = error instanceof RetryableDownloadError ? error.retryAfter ?? 400 * (attempt + 1) : 400 * (attempt + 1)
      await abortable(task, new Promise(resolve => setTimeout(resolve, delay)))
    }
  }
}

async function fetchBlobAttempt(task: Download, url: string, label: string, report: (progress: OfflineSaveProgress) => void): Promise<Blob> {
  check(task)
  const release = await requestSlot(task), controller = new AbortController()
  let timedOut = false, timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => controller.abort()
  const resetTimeout = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort() }, url.includes('prepare=all') ? 120_000 : 30_000) }
  task.controller.signal.addEventListener('abort', cancel, { once: true })
  resetTimeout()
  try {
    check(task)
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'X-Litera-User': String(task.userId) } })
    check(task)
    resetTimeout()
    if (!response.ok || response.status === 206) {
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente para salvar o livro.')
      if (response.status === 403) throw new Error('A conta mudou ou não tem acesso a este livro. Entre novamente e tente salvar.')
      if (response.status === 404) throw new Error('Um arquivo necessário não está mais disponível no servidor. Atualize o acervo e tente novamente.')
      const message = `Não foi possível baixar todos os recursos (HTTP ${response.status}). Tente novamente.`
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        const after = response.headers.get('retry-after')
        const delay = after ? /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now() : NaN
        throw new RetryableDownloadError(message, Number.isFinite(delay) ? Math.min(5_000, Math.max(400, delay)) : undefined)
      }
      throw new Error(message)
    }
    const length = response.headers.get('content-length'), parsed = length !== null ? Number(length) : 0
    // Fetch exposes decoded bytes, not the compressed Content-Length.
    const encoding = response.headers.get('content-encoding')
    const expected = (!encoding || encoding === 'identity') && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
    report({ completed: 0, total: expected, label })
    let blob: Blob
    if (response.body) {
      const reader = response.body.getReader(), chunks: BlobPart[] = []
      let completed = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          check(task)
          if (done) break
          resetTimeout()
          completed += value.byteLength
          chunks.push(value as Uint8Array<ArrayBuffer>)
          report({ completed, total: expected, label })
        }
      } catch (error) { await reader.cancel().catch(() => undefined); throw error }
      finally { reader.releaseLock() }
      blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' })
    } else blob = await response.blob()
    check(task)
    if (expected && blob.size !== expected) throw new RetryableDownloadError('O arquivo recebido está incompleto. Reconecte e tente baixar novamente.')
    report({ completed: blob.size, total: expected, label })
    return blob
  } catch (error) {
    if (timedOut && !task.controller.signal.aborted) throw new DOMException('O servidor ficou sem responder durante o download. Tente novamente.', 'TimeoutError')
    throw error
  } finally { clearTimeout(timer); task.controller.signal.removeEventListener('abort', cancel); release() }
}

function cssReferences(css: string): string[] {
  return cssResourceReferences(css).map(reference => reference.trim()).filter(Boolean)
}

function epubReferences(html: string): string[] {
  const document = new DOMParser().parseFromString(html, 'text/html'), references: string[] = []
  for (const element of document.querySelectorAll('[src], image[href], image[xlink\\:href], link[rel="stylesheet"][href]')) {
    const value = element.getAttribute('src') ?? element.getAttribute('href') ?? element.getAttribute('xlink:href')
    if (value) references.push(value)
  }
  for (const element of document.querySelectorAll('style,[style]')) references.push(...cssReferences(element.tagName.toLowerCase() === 'style' ? element.textContent ?? '' : element.getAttribute('style') ?? ''))
  return references
}

function epubAssetUrl(bookId: number, chapter: string, reference: string, parent?: string): string | undefined {
  if (!reference || reference.startsWith('#') || /^data:/i.test(reference)) return undefined
  if (reference.startsWith(`/api/v1/books/${bookId}/epub/asset?`)) return normalizeOfflineUrl(reference)
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
    const absolute = new URL(reference, location.origin)
    if (absolute.origin === location.origin && absolute.pathname === `/api/v1/books/${bookId}/epub/asset`) return normalizeOfflineUrl(absolute.href)
    throw new Error('Este capítulo contém um recurso externo que não pode ser salvo com segurança. Atualize o arquivo no acervo.')
  }
  let source = reference
  if (parent) {
    const previous = new URL(parent, location.origin).searchParams.get('src') ?? ''
    source = new URL(reference, `https://epub.invalid/${previous}`).pathname.slice(1)
  }
  return normalizeOfflineUrl(`/api/v1/books/${bookId}/epub/asset?chapter=${encodeURIComponent(chapter)}&src=${encodeURIComponent(source)}`)
}

// Chapter-specific URLs can refer to the same ZIP member. Keep their public
// URLs as aliases, without transferring or storing the binary more than once.
function epubAssetIdentity(url: string): string | undefined {
  const parsed = new URL(url, location.origin)
  if (!parsed.pathname.endsWith('/epub/asset')) return
  try {
    const chapter = parsed.searchParams.get('chapter'), source = parsed.searchParams.get('src')
    if (!chapter || !source) return
    const target = new URL(decodeURIComponent(source), new URL(decodeURIComponent(chapter), 'https://epub.invalid/'))
    if (target.origin !== 'https://epub.invalid' || target.search) return
    return target.pathname
  } catch { return undefined }
}

async function performDownload(task: Download, format: 'epub' | 'pdf', onProgress: (progress: OfflineSaveProgress) => void): Promise<void> {
  let stage: OfflineStage | undefined, heartbeat: ReturnType<typeof setInterval> | undefined
  let previous: Awaited<ReturnType<typeof getOfflineBook>>, committed = false
  let bytes = 0, received = 0, completed = 0, total = 0, lastPublished = 0
  let phase: NonNullable<OfflineDownloadState['phase']> = 'preparing', label = 'Preparando download…'
  let units: OfflineDownloadState['units'], freeBytes: number | undefined
  const publish = (force = false) => {
    if (!ownsState(task) || (!force && Date.now() - lastPublished < 80)) return
    lastPublished = Date.now()
    downloadStates[task.bookId] = { status: phase === 'preparing' ? 'queued' : previous ? 'updating' : 'downloading', completed, total, label, phase, units, bytesReceived: received }
  }
  const preparing = (message: string) => { phase = 'preparing'; label = message; publish(true) }
  const receive = (url: string, resourceLabel: string) => {
    let last = 0
    return fetchBlob(task, url, resourceLabel, progress => {
      if (progress.completed === 0) last = 0
      received += Math.max(0, progress.completed - last); last = progress.completed
      publish()
      try { onProgress(progress) } catch { /* A UI callback cannot corrupt a download. */ }
    })
  }
  try {
    try { void navigator.storage?.persist?.().catch(() => false) } catch { /* Optional storage capability. */ }
    preparing('Preparando download…')
    // The shell and book are independent work. Confirm both before publication,
    // but do not serialize every book behind the public application precache.
    const shell = ensureOfflineShell()
    void shell.catch(error => { if (current(task)) { task.failure = error; task.controller.abort() } })
    previous = await abortable(task, getOfflineBook(task.userId, task.bookId))
    check(task)
    stage = await beginOfflineDownload(task.userId, task.bookId)
    check(task)
    const activeStage = stage
    heartbeat = setInterval(() => { void renewOfflineDownload(activeStage).catch(error => { if (current(task)) { task.failure = error; task.controller.abort() } }) }, 30_000)
    const required = new Set<string>(), saves = new Map<string, Promise<void>>()
    const sharedAssets = new Map<string, { url: string; promise: Promise<void> }>()
    const save = async (url: string, resourceLabel: string): Promise<Blob | undefined> => {
      const normalized = normalizeOfflineUrl(url), existing = saves.get(normalized)
      if (existing) { await existing; return undefined }
      if (saves.size >= 50_000) throw new Error('O livro contém recursos demais para este dispositivo.')
      const identity = epubAssetIdentity(normalized), shared = identity ? sharedAssets.get(identity) : undefined
      const pending = (async () => {
        if (shared) {
          await shared.promise; check(task)
          await putOfflineAlias(activeStage, normalized, shared.url)
          required.add(normalized)
          return undefined
        }
        const blob = await receive(url, resourceLabel)
        check(task)
        if (freeBytes !== undefined && bytes + blob.size > freeBytes) throw new DOMException('Espaço insuficiente.', 'QuotaExceededError')
        await putOfflineResource(activeStage, normalized, blob)
        check(task)
        bytes += blob.size; required.add(normalized)
        return blob
      })()
      // Retain completion only. Holding fulfilled Blob promises for every
      // chapter would retain the entire downloaded book in JS memory.
      const stored = pending.then(() => undefined)
      void stored.catch(() => undefined)
      saves.set(normalized, stored)
      if (identity && !shared) sharedAssets.set(identity, { url: normalized, promise: stored })
      return pending
    }
    const json = async (url: string, resourceLabel: string): Promise<any> => {
      const blob = await save(url, resourceLabel)
      if (!blob) throw new Error('Recurso repetido no pacote offline.')
      try { return JSON.parse(await blob.text()) } catch { throw new Error('O servidor retornou dados incompletos. Tente salvar novamente.') }
    }
    const base = `/api/v1/books/${task.bookId}`
    const metadata = (await json(base, 'Salvando informações do livro…')).book
    if (!metadata || Number(metadata.id) !== task.bookId || metadata.format !== format) throw new Error('As informações do livro mudaram. Reabra o livro e tente novamente.')
    const revision = metadata.fileRevision
    const downloadRevision = metadata.downloadRevision ?? revision
    if (typeof revision !== 'string' || !revision) throw new Error('O servidor precisa ser atualizado para verificar a versão do arquivo offline.')
    let estimate: StorageEstimate | undefined
    try { estimate = await navigator.storage?.estimate?.() } catch { /* Quota is an optional estimate. */ }
    check(task)
    if (estimate?.quota !== undefined && estimate.usage !== undefined) freeBytes = estimate.quota - estimate.usage
    if (freeBytes !== undefined && Number(metadata.fileSize) > freeBytes) throw new DOMException('Espaço insuficiente.', 'QuotaExceededError')
    await downloadTogether(task, ['/api/v1/settings', `${base}/progress`, `${base}/highlights`, ...(metadata.hasCover ? [`${base}/cover`] : [])], url => url.endsWith('/cover') ? save(url, 'Salvando capa…') : json(url, 'Salvando informações…'))
    phase = 'transferring'
    if (format === 'pdf') {
      label = 'Baixando PDF e preparando leitura adaptada…'; publish(true)
      let first: any
      await downloadTogether(task, ['binary', 'pages'], async part => {
        if (part === 'pages') { first = await json(`${base}/pdf/reflow?page=1&prepare=all`, 'Preparando leitura adaptada…'); return }
        const binary = await save(`${base}/content`, 'Baixando PDF…')
        if (!binary || !(await binary.slice(0, 1024).text()).includes('%PDF-') || !(await binary.slice(-2048).text()).includes('%%EOF')) throw new Error('O PDF recebido parece incompleto ou inválido. Verifique o arquivo no acervo e tente novamente.')
      }, 2)
      const pageCount = first?.pageCount
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 50_000) throw new Error('O índice de páginas do PDF está incompleto.')
      units = 'pages'; total = pageCount; label = 'Salvando páginas, imagens e fontes…'; publish(true)
      await downloadTogether(task, Array.from({ length: pageCount }, (_, index) => index + 1), async page => {
        const reflow = page === 1 ? first : await json(`${base}/pdf/reflow?page=${page}`, `Salvando leitura adaptada · página ${page}…`)
        if (reflow.pageCount !== pageCount || reflow.page !== page || !Array.isArray(reflow.blocks) || !Array.isArray(reflow.figures)) throw new Error('Uma página adaptada está incompleta ou o PDF mudou. Tente salvar novamente.')
        const assets = new Set<string>()
        for (const figure of reflow.figures) if (figure.asset) assets.add(figure.asset)
        for (const block of reflow.blocks) for (const span of block.spans ?? []) if (span.fontAsset) assets.add(span.fontAsset)
        await downloadTogether(task, [...assets], asset => save(`${base}/pdf/figure?page=${page}&asset=${encodeURIComponent(asset)}`, `Salvando imagens e fontes · página ${page}…`))
        completed++; publish(true)
      })
    } else {
      const manifest = await json(`${base}/epub/manifest`, 'Salvando índice…')
      if (!Array.isArray(manifest.chapters) || !manifest.chapters.length || manifest.chapters.length > 50_000) throw new Error('O EPUB não possui um índice válido para leitura offline.')
      units = 'chapters'; total = manifest.chapters.length; label = 'Baixando capítulos e recursos…'; publish(true)
      await downloadTogether(task, manifest.chapters, async (chapter: { href: string }, index) => {
        if (typeof chapter.href !== 'string' || !chapter.href) throw new Error('O índice do EPUB está incompleto.')
        const chapterBlob = await save(`${base}/epub/chapter?href=${encodeURIComponent(chapter.href)}`, `Salvando capítulo ${index + 1} de ${manifest.chapters.length}…`)
        if (chapterBlob) {
          const queue = [...new Set(epubReferences(await chapterBlob.text()).map(reference => epubAssetUrl(task.bookId, chapter.href, reference)).filter((url): url is string => Boolean(url)))]
          const queued = new Set(queue)
          for (let offset = 0; offset < queue.length; offset += 3) {
            await downloadTogether(task, queue.slice(offset, offset + 3), async url => {
              const blob = await save(url, `Salvando recursos do capítulo ${index + 1}…`)
              if (blob?.type.includes('text/css')) for (const reference of cssReferences(await blob.text())) {
                const asset = epubAssetUrl(task.bookId, chapter.href, reference, url)
                if (asset && !queued.has(asset)) { queued.add(asset); queue.push(asset) }
              }
            })
          }
        }
        completed++; publish(true)
      })
    }
    phase = 'verifying'; label = 'Conferindo download…'; publish(true)
    const after = JSON.parse(await (await receive(base, 'Verificando versão do arquivo…')).text()).book
    if (after?.fileRevision !== revision || (after?.downloadRevision ?? after?.fileRevision) !== downloadRevision || after?.format !== format) throw new Error('O arquivo mudou durante o download. A cópia anterior foi preservada; tente novamente.')
    check(task)
    label = 'Concluindo preparação offline…'; publish(true)
    await abortable(task, shell)
    check(task)
    await commitOfflineDownload(activeStage, { userId: task.userId, bookId: task.bookId, generation: activeStage.generation, format, metadata, revision, downloadedAt: new Date().toISOString(), bytes }, [...required], () => current(task))
    committed = true
    if (ownsState(task)) downloadStates[task.bookId] = { status: 'downloaded', completed: bytes, total: bytes, bytesReceived: received, label: 'Disponível offline.' }
    changed()
    if ('caches' in globalThis) await caches.delete(`litera-books-u${task.userId}-b${task.bookId}-v1`).catch(() => false)
  } catch (reason) {
    const error = task.failure ?? reason
    if (stage && !committed) await discardOfflineDownload(stage).catch(() => undefined)
    const cancelled = !task.failure && task.controller.signal.aborted
    if (ownsState(task)) downloadStates[task.bookId] = cancelled
      ? { status: previous ? 'downloaded' : 'not-downloaded', completed: previous?.bytes ?? 0, total: previous?.bytes ?? 0, label: previous ? 'Atualização cancelada. O download anterior foi preservado.' : 'Download cancelado.' }
      : { status: 'error', completed: 0, total: 0, label: 'Falha ao salvar offline.', error: actionableError(error) }
    if (cancelled) throw new DOMException('Download cancelado.', 'AbortError')
    throw new Error(actionableError(error))
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (downloads.get(task.bookId) === task) downloads.delete(task.bookId)
  }
}

export function saveBookOffline(bookId: number, format: 'epub' | 'pdf', onProgress: (progress: OfflineSaveProgress) => void = () => undefined): Promise<void> {
  const userId = getOfflineUser()
  if (!userId || !Number.isSafeInteger(bookId) || bookId < 1) return Promise.reject(new Error('Entre na sua conta para salvar este livro.'))
  const existing = downloads.get(bookId)
  if (existing && current(existing)) return existing.promise!
  const task: Download = { userId, bookId, contextGeneration: offlineContext.generation, controller: new AbortController() }
  downloads.set(bookId, task)
  downloadStates[bookId] = { status: 'queued', completed: 0, total: 0, label: 'Aguardando preparação do download…' }
  task.promise = performDownload(task, format, onProgress)
  return task.promise
}

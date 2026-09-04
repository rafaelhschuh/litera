import { reactive, watch } from 'vue'
import { cssResourceReferences } from '../../shared/epub-document'
import { getOfflineUser, offlineContext, setOfflineContext } from './offline-context'
import { ensureOfflineShell } from './pwa-shell'
import {
  beginOfflineDownload, clearOfflineUser as clearStoredUser, commitOfflineDownload,
  discardOfflineDownload, getOfflineBook, listOfflineBooks, normalizeOfflineUrl,
  putOfflineResource, removeOfflineBook, renewOfflineDownload, type OfflineStage,
} from './offline-store'

export { offlineSupport, initializePwa, installPwa, pwaInstall, pwaUpdate, applyPwaUpdate, ensureOfflineShell } from './pwa-shell'
export type OfflineSaveProgress = { completed: number; total: number; label: string }
export type OfflineDownloadState = OfflineSaveProgress & {
  status: 'not-downloaded' | 'queued' | 'downloading' | 'downloaded' | 'updating' | 'error'
  error?: string
}
export const downloadStates = reactive<Record<number, OfflineDownloadState>>({})
type Download = { userId: number; bookId: number; contextGeneration: number; controller: AbortController; promise?: Promise<void> }
const downloads = new Map<number, Download>()

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

async function fetchBlob(task: Download, url: string, label: string, report: (progress: OfflineSaveProgress) => void): Promise<Blob> {
  check(task)
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: task.controller.signal, headers: { 'X-Litera-User': String(task.userId) } })
  check(task)
  if (!response.ok || response.status === 206) {
    if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente para salvar o livro.')
    if (response.status === 403) throw new Error('A conta mudou ou não tem acesso a este livro. Entre novamente e tente salvar.')
    if (response.status === 404) throw new Error('Um arquivo necessário não está mais disponível no servidor. Atualize o acervo e tente novamente.')
    throw new Error(`Não foi possível baixar todos os recursos (HTTP ${response.status}). Tente novamente.`)
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
        completed += value.byteLength
        chunks.push(value as Uint8Array<ArrayBuffer>)
        report({ completed, total: expected, label })
      }
    } finally { reader.releaseLock() }
    blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' })
  } else blob = await response.blob()
  check(task)
  if (expected && blob.size !== expected) throw new Error('O arquivo recebido está incompleto. Reconecte e tente baixar novamente.')
  report({ completed: blob.size, total: expected, label })
  return blob
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

async function performDownload(task: Download, format: 'epub' | 'pdf', onProgress: (progress: OfflineSaveProgress) => void): Promise<void> {
  let stage: OfflineStage | undefined, heartbeat: ReturnType<typeof setInterval> | undefined
  let previous: Awaited<ReturnType<typeof getOfflineBook>>
  let committed = false
  const report = (progress: OfflineSaveProgress) => {
    if (!ownsState(task)) return
    downloadStates[task.bookId] = { status: previous ? 'updating' : 'downloading', ...progress }
    try { onProgress(progress) } catch { /* A UI callback cannot corrupt a download. */ }
  }
  const preparing = (label: string) => {
    if (ownsState(task)) downloadStates[task.bookId] = { status: 'queued', completed: 0, total: 0, label }
  }
  try {
    try { void navigator.storage?.persist?.().catch(() => false) } catch { /* Optional API, invoked from a user action. */ }
    preparing('Verificando a cópia neste dispositivo…')
    previous = await abortable(task, getOfflineBook(task.userId, task.bookId))
    check(task)
    preparing('Preparando o aplicativo offline…')
    await abortable(task, ensureOfflineShell())
    check(task)
    preparing('Reservando espaço para o download…')
    stage = await beginOfflineDownload(task.userId, task.bookId)
    check(task)
    const activeStage = stage
    heartbeat = setInterval(() => { void renewOfflineDownload(activeStage).catch(() => task.controller.abort()) }, 30_000)
    let bytes = 0
    const required = new Set<string>()
    const save = async (url: string, label: string): Promise<Blob | undefined> => {
      const normalized = normalizeOfflineUrl(url)
      if (required.has(normalized)) return undefined
      if (required.size >= 50_000) throw new Error('O livro contém recursos demais para este dispositivo.')
      const blob = await fetchBlob(task, url, label, report)
      check(task)
      await putOfflineResource(activeStage, normalized, blob)
      check(task)
      bytes += blob.size
      required.add(normalized)
      return blob
    }
    const json = async (url: string, label: string): Promise<any> => {
      const blob = await save(url, label)
      if (!blob) throw new Error('Recurso repetido no pacote offline.')
      try { return JSON.parse(await blob.text()) } catch { throw new Error('O servidor retornou dados incompletos. Tente salvar novamente.') }
    }
    const base = `/api/v1/books/${task.bookId}`
    const metadata = (await json(base, 'Salvando informações do livro…')).book
    if (!metadata || Number(metadata.id) !== task.bookId || metadata.format !== format) throw new Error('As informações do livro mudaram. Reabra o livro e tente novamente.')
    const revision = metadata.fileRevision
    if (typeof revision !== 'string' || !revision) throw new Error('O servidor precisa ser atualizado para verificar a versão do arquivo offline.')
    let estimate: StorageEstimate | undefined
    try { estimate = await navigator.storage?.estimate?.() } catch { /* Quota is an optional estimate. */ }
    check(task)
    const size = Number(metadata.fileSize)
    if (estimate?.quota !== undefined && estimate.usage !== undefined && Number.isFinite(size) && size > estimate.quota - estimate.usage) throw new DOMException('Espaço insuficiente.', 'QuotaExceededError')
    await json('/api/v1/settings', 'Salvando preferências…')
    await json(`${base}/progress`, 'Salvando posição de leitura…')
    await json(`${base}/highlights`, 'Salvando destaques…')
    if (metadata.hasCover) await save(`${base}/cover`, 'Salvando capa…')
    if (format === 'pdf') {
      const binary = await save(`${base}/content`, 'Baixando PDF…')
      if (!binary || !(await binary.slice(0, 1024).text()).includes('%PDF-') || !(await binary.slice(-2048).text()).includes('%%EOF')) throw new Error('O PDF recebido parece incompleto ou inválido. Verifique o arquivo no acervo e tente novamente.')
      let pageCount = 1
      for (let page = 1; page <= pageCount; page++) {
        const reflow = await json(`${base}/pdf/reflow?page=${page}`, `Salvando leitura adaptada · página ${page}…`)
        if (!Number.isSafeInteger(reflow.pageCount) || reflow.pageCount < 1 || reflow.page !== page || !Array.isArray(reflow.blocks) || !Array.isArray(reflow.figures)) throw new Error('Uma página adaptada está incompleta. Tente salvar o PDF novamente.')
        if (page === 1) pageCount = reflow.pageCount
        else if (reflow.pageCount !== pageCount) throw new Error('O PDF mudou durante o download. Tente novamente.')
        const assets = new Set<string>()
        for (const figure of reflow.figures) if (figure.asset) assets.add(figure.asset)
        for (const block of reflow.blocks) for (const span of block.spans ?? []) if (span.fontAsset) assets.add(span.fontAsset)
        for (const asset of assets) await save(`${base}/pdf/figure?page=${page}&asset=${encodeURIComponent(asset)}`, `Salvando imagens e fontes · página ${page}…`)
      }
    } else {
      const manifest = await json(`${base}/epub/manifest`, 'Salvando índice…')
      if (!Array.isArray(manifest.chapters) || !manifest.chapters.length) throw new Error('O EPUB não possui capítulos disponíveis para leitura offline.')
      for (let index = 0; index < manifest.chapters.length; index++) {
        const chapter = manifest.chapters[index]
        if (typeof chapter.href !== 'string' || !chapter.href) throw new Error('O índice do EPUB está incompleto.')
        const chapterBlob = await save(`${base}/epub/chapter?href=${encodeURIComponent(chapter.href)}`, `Salvando capítulo ${index + 1} de ${manifest.chapters.length}…`)
        if (!chapterBlob) continue
        const queue = epubReferences(await chapterBlob.text()).map(reference => epubAssetUrl(task.bookId, chapter.href, reference)).filter((url): url is string => Boolean(url))
        for (let item = 0; item < queue.length; item++) {
          const url = queue[item]!, blob = await save(url, `Salvando recursos do capítulo ${index + 1}…`)
          if (blob?.type.includes('text/css')) for (const reference of cssReferences(await blob.text())) {
            const asset = epubAssetUrl(task.bookId, chapter.href, reference, url)
            if (asset && !required.has(asset) && !queue.includes(asset)) queue.push(asset)
          }
        }
      }
    }
    const after = JSON.parse(await (await fetchBlob(task, base, 'Verificando versão do arquivo…', report)).text()).book
    if (after?.fileRevision !== revision || after?.format !== format) throw new Error('O arquivo mudou durante o download. A cópia anterior foi preservada; tente novamente.')
    check(task)
    await commitOfflineDownload(activeStage, { userId: task.userId, bookId: task.bookId, generation: activeStage.generation, format, metadata, revision, downloadedAt: new Date().toISOString(), bytes }, [...required], () => current(task))
    committed = true
    if (ownsState(task)) downloadStates[task.bookId] = { status: 'downloaded', completed: bytes, total: bytes, label: 'Disponível offline.' }
    changed()
    // v1 is retained until the replacement transaction has actually completed.
    if ('caches' in globalThis) await caches.delete(`litera-books-u${task.userId}-b${task.bookId}-v1`).catch(() => false)
  } catch (error) {
    if (stage && !committed) await discardOfflineDownload(stage).catch(() => undefined)
    const cancelled = task.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
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

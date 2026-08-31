import { reactive } from 'vue'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { offlineBookCacheName, offlineBookMarker, offlineDataCacheName, offlineEpubChapterUrl, type OfflineBookFormat } from '../../shared/offline'
import { clearOfflineProgressUser } from './offline-progress'

type InstallPromptEvent = Event & { prompt:()=>Promise<void>; userChoice:Promise<{outcome:'accepted'|'dismissed'}> }
export type OfflineSaveProgress = { completed: number; total: number; label: string }
export const pwaInstall=reactive<{available:boolean;installed:boolean;prompt?:InstallPromptEvent}>({available:false,installed:window.matchMedia('(display-mode: standalone)').matches})
export const offlineSupport = reactive<{ available: boolean; message: string }>({
  available: window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window,
  message: !window.isSecureContext ? 'No celular, a leitura offline exige que o Litera seja aberto por HTTPS.' : 'Este navegador não oferece os recursos necessários para leitura offline.',
})
let activeUserId: number | undefined
let workerRegistration: Promise<ServiceWorkerRegistration> | undefined

function registerWorker(): Promise<ServiceWorkerRegistration> {
  if (!offlineSupport.available) return Promise.reject(new Error(offlineSupport.message))
  workerRegistration ??= navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).catch(error => {
    workerRegistration = undefined
    throw error
  })
  return workerRegistration
}

function tellWorker(message: object): void {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.controller?.postMessage(message)
  void navigator.serviceWorker.ready.then(registration => registration.active?.postMessage(message)).catch(() => undefined)
}

export function initializePwa():void{
  window.addEventListener('beforeinstallprompt',(event:any)=>{event.preventDefault();pwaInstall.prompt=event;pwaInstall.available=true})
  window.addEventListener('appinstalled',()=>{pwaInstall.available=false;pwaInstall.installed=true;pwaInstall.prompt=undefined})
  if (offlineSupport.available) {
    const start = () => { void registerWorker().catch(() => { offlineSupport.available = false; offlineSupport.message = 'O navegador não conseguiu ativar a leitura offline neste dispositivo.' }) }
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true })
  }
}

export async function installPwa():Promise<boolean>{if(!pwaInstall.prompt)return false;await pwaInstall.prompt.prompt();const choice=await pwaInstall.prompt.userChoice;if(choice.outcome==='accepted'){pwaInstall.available=false;pwaInstall.installed=true;pwaInstall.prompt=undefined;return true}return false}

export function setActiveOfflineUser(userId?: number): void {
  activeUserId = userId
  tellWorker({ type: 'LITERA_ACTIVE_USER', userId: userId ?? null })
}

export async function clearOfflineUser(userId: number): Promise<void> {
  clearOfflineProgressUser(localStorage, userId)
  if (!offlineSupport.available) return
  const prefix = `litera-books-u${userId}-`
  const names = await caches.keys()
  await Promise.all(names.filter(name => name.startsWith(prefix) || name === offlineDataCacheName(userId)).map(name => caches.delete(name)))
  tellWorker({ type: 'LITERA_CLEAR_USER', userId })
}

async function cacheResponse(cache: Cache, url: string): Promise<Response> {
  const request = new Request(url, { credentials: 'same-origin' })
  const response = await fetch(request)
  if (!response.ok) throw new Error('Não foi possível salvar todos os dados do livro. Verifique a conexão e tente novamente.')
  await cache.put(request, response.clone())
  return response
}

async function prepareReaderAssets(format: OfflineBookFormat): Promise<void> {
  await import('../pages/ReaderPage.vue')
  if (format === 'pdf') await import('pdfjs-dist')
  const cache = await caches.open('litera-shell-v2')
  const resources = performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(name => { const url = new URL(name); return ['http:', 'https:'].includes(url.protocol) && url.origin === location.origin && !url.pathname.startsWith('/api/') })
  if (format === 'pdf') resources.push(new URL(pdfWorkerUrl, location.origin).href)
  await Promise.allSettled([...new Set(resources)].map(url => cache.add(url)))
}

export async function isBookOffline(bookId: number): Promise<boolean> {
  if (!offlineSupport.available || !activeUserId) return false
  const cache = await caches.open(offlineBookCacheName(activeUserId, bookId))
  return Boolean(await cache.match(offlineBookMarker(bookId)))
}

export async function saveBookOffline(bookId: number, format: OfflineBookFormat, onProgress: (progress: OfflineSaveProgress) => void = () => undefined): Promise<void> {
  if (!offlineSupport.available || !activeUserId) throw new Error(offlineSupport.message)
  try { await registerWorker() } catch { throw new Error('Não foi possível ativar a leitura offline. Recarregue a página e tente novamente.') }
  const cacheName = offlineBookCacheName(activeUserId, bookId)
  await caches.delete(cacheName)
  const cache = await caches.open(cacheName)
  try {
    const dataCache = await caches.open(offlineDataCacheName(activeUserId))
    onProgress({ completed: 0, total: 1, label: 'Preparando o leitor…' })
    const settingsResponse = await cacheResponse(dataCache, '/api/v1/settings')
    const settings = (await settingsResponse.clone().json()).preferences
    await Promise.all([
      cacheResponse(cache, `/api/v1/books/${bookId}`),
      cacheResponse(cache, `/api/v1/books/${bookId}/progress`),
      cacheResponse(cache, `/api/v1/books/${bookId}/highlights`),
      prepareReaderAssets(format),
    ])
    if (format === 'pdf') {
      onProgress({ completed: 0, total: 1, label: 'Salvando o PDF… mantenha esta tela aberta.' })
      await cacheResponse(cache, `/api/v1/books/${bookId}/content`)
      onProgress({ completed: 1, total: 1, label: 'PDF salvo.' })
    } else {
      const manifestUrl = `/api/v1/books/${bookId}/epub/manifest`
      const manifestResponse = await cacheResponse(cache, manifestUrl)
      const manifest = await manifestResponse.clone().json() as { chapters?: Array<{ href: string }> }
      const chapters = manifest.chapters ?? []
      for (let index = 0; index < chapters.length; index++) {
        const chapter = chapters[index]!
        onProgress({ completed: index, total: chapters.length, label: `Salvando capítulo ${index + 1} de ${chapters.length}…` })
        const chapterUrl = offlineEpubChapterUrl(bookId, chapter.href, settings)
        const chapterResponse = await cacheResponse(cache, chapterUrl)
        const html = await chapterResponse.clone().text()
        const document = new DOMParser().parseFromString(html, 'text/html')
        const assets = [...document.querySelectorAll<HTMLImageElement>('img[src]')]
          .map(image => image.getAttribute('src'))
          .filter((source): source is string => Boolean(source?.startsWith(`/api/v1/books/${bookId}/epub/asset`)))
        for (const asset of new Set(assets)) await cacheResponse(cache, asset)
      }
      onProgress({ completed: chapters.length, total: chapters.length, label: 'Livro salvo.' })
    }
    await cache.put(offlineBookMarker(bookId), new Response(JSON.stringify({ bookId, format, savedAt: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } }))
    void navigator.storage?.persist?.().catch(() => false)
  } catch (error) {
    await caches.delete(cacheName)
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('Não há espaço suficiente neste dispositivo para salvar o livro.')
    throw error
  }
}

export async function removeBookOffline(bookId: number): Promise<void> {
  if (!offlineSupport.available || !activeUserId) return
  await caches.delete(offlineBookCacheName(activeUserId, bookId))
}

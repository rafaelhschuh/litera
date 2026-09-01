<script setup lang="ts">
/* eslint-disable no-undef */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import AppState from '../components/AppState.vue'
import ReaderTextContent from '../components/ReaderTextContent.vue'
import UiIcon from '../components/UiIcon.vue'
import { ApiError, api } from '../lib/api'
import { auth } from '../lib/auth'
import { clearOfflineProgress, readOfflineProgress, writeOfflineProgress } from '../lib/offline-progress'
import { attachReaderInput } from '../lib/reader-input'
import { QueuedProgressSaver } from '../lib/reader-progress'
import { applyTheme } from '../lib/theme'
import { fitPdfScale, movePdfSpread, pdfSpreadPages, RenderGeneration, resolvePdfReaderMode, usesTwoPageSpread, usesTwoPageSpreadAtZoom, type PdfReaderMode, type PdfZoomMode } from '../../shared/pdf-reader'
import { pdfTextSignature, type PdfReflowBlock, type PdfReflowFigure } from '../../shared/pdf-reflow'
import { readerCapabilities, readerTapZone } from '../../shared/reader'
import type { EpubLocator, PdfLocator, ReadingLocator } from '../../shared/progress'
import type { ReaderInteractionMode } from '../../shared/reader-interaction'
import { findTextHighlightRanges } from '../../shared/text-highlights'

type Book = { id: number; title: string; format: 'epub' | 'pdf' }
type Chapter = { id: string; href: string; label: string }
type Highlight = { id: number; quoteText: string; locator: ReadingLocator; chapter?: string; pageNumber?: number }
type Save = { format: 'epub' | 'pdf'; progressRatio: number; locator: ReadingLocator }
type Panel = 'toc' | 'settings' | 'search'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const shell = ref<HTMLElement>(), stage = ref<HTMLElement>(), frame = ref<HTMLIFrameElement>()
const pdfSpread = ref<HTMLElement>(), panelClose = ref<HTMLButtonElement>()
const book = ref<Book>(), state = ref<'loading' | 'ready' | 'error'>('loading'), message = ref(''), syncMessage = ref('')
const toc = ref<Chapter[]>([]), currentChapter = ref(0), epubRatio = ref(0), frameSources = ref(['', '']), activeFrame = ref(0), epubBusy = ref(false)
const epubAtStart = ref(true), epubAtEnd = ref(false)
const currentPage = ref(1), pageCount = ref(0), readerMode = ref<PdfReaderMode>('visual')
const reflowVisualReference = ref(false), reflowFigures = ref<PdfReflowFigure[]>([])
const reflowAtStart = ref(true), reflowAtEnd = ref(false)
let reflowLocator: PdfLocator | undefined
const reflowBlocks = ref<PdfReflowBlock[]>([]), reflowLoading = ref(false), zoom = ref(1), zoomMode = ref<PdfZoomMode>('fit-page')
const textScale = ref(100), readerTheme = ref<'light' | 'sepia' | 'dark'>('light')
const lineHeight = ref<'compact' | 'normal' | 'relaxed'>('normal'), margins = ref<'narrow' | 'normal' | 'wide'>('normal')
const appTheme = ref<'system' | 'light' | 'dark'>('system'), reducedMotion = ref(false), pdfInvert = ref(false)
const highlights = ref<Highlight[]>([]), selectedQuote = ref(''), selectedLocator = ref<ReadingLocator>(), savingHighlight = ref(false)
const panel = ref<Panel | null>(null), chrome = ref<'visible' | 'hidden' | 'locked'>('visible'), interactionMode = ref<ReaderInteractionMode>('idle')
const turnDirection = ref<'' | 'next' | 'prev'>(''), searchQuery = ref(''), searchResults = ref<any[]>([]), searching = ref(false)
const pinchScale = ref(1), pinchOrigin = ref({ x: 0, y: 0 })
const toolbarPosition = ref<'top' | 'bottom'>('top'), twoPage = ref(false)
const capabilities = computed(() => readerCapabilities(book.value?.format ?? 'epub'))
const activePdfPages = computed(() => pdfSpreadPages(currentPage.value, pageCount.value, twoPage.value && readerMode.value === 'visual'))
const pageRatio = computed(() => pageCount.value > 1 ? (currentPage.value - 1) / (pageCount.value - 1) : 0)
const readerRatio = computed(() => book.value?.format === 'pdf' ? pageRatio.value : epubRatio.value)
const canMovePrevious = computed(() => book.value?.format === 'pdf' ? (currentPage.value > 1 || (readerMode.value === 'reflow' && !reflowAtStart.value)) : (currentChapter.value > 0 || !epubAtStart.value))
const canMoveNext = computed(() => book.value?.format === 'pdf' ? (currentPage.value < pageCount.value || (readerMode.value === 'reflow' && !reflowAtEnd.value)) : (currentChapter.value < toc.value.length - 1 || !epubAtEnd.value))
const readerPosition = computed(() => {
  if (book.value?.format !== 'pdf') return toc.value[currentChapter.value]?.label || 'Posição salva automaticamente'
  const pages = activePdfPages.value
  return pages.length > 1 ? `Páginas ${pages[0]}–${pages[1]} de ${pageCount.value}` : `Página ${currentPage.value} de ${pageCount.value}`
})
const reflowStyle = computed(() => ({ fontSize: `${18 * textScale.value / 100}px`, lineHeight: ({ compact: 1.45, normal: 1.65, relaxed: 1.85 })[lineHeight.value], '--reader-measure': ({ narrow: '42rem', normal: '56rem', wide: '72rem' })[margins.value] }))
const reflowVisualSrc = computed(() => reflowVisualReference.value ? `/api/v1/books/${id}/pdf/page-image?page=${currentPage.value}` : undefined)
const debug = import.meta.env.DEV && route.query.readerDebug === 'true'

let revision: number | undefined, chromeTimer: number | undefined
const layoutChanging = ref(false)
let layoutTimer: number | undefined
let layoutSize = { width: 0, height: 0 }
let viewportFrame = 0, selectionFrame = 0, scrollFrame = 0, fallbackReady: (() => void) | undefined
let frameInputCleanup: (() => void) | undefined, frameEventCleanup: (() => void) | undefined, stageInputCleanup: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined, pdfjs: any, pdf: any, pdfTextLayers: any[] = []
let pdfBase = { width: 1, height: 1 }, pdfPageBase = { width: 1, height: 1 }, pendingLocator: EpubLocator | undefined, saveAfterFrameLoad = false, pendingAnchor = '', pendingChapterEnd = false
let presentation: HTMLElement | undefined
let loadedChapter = -1, reloadPending = false, queuedNavigation = 0
const frameGenerations = [0, 0]
let epubGeneration = 0, epubAbort: AbortController | undefined
let restoring = true, unmounting = false, reflowGeneration = 0, searchGeneration = 0
let bodyOverflow = '', bodyOverscroll = '', panelTrigger: HTMLElement | undefined
let zoomAnchor: { pageNumber: number; pageX: number; pageY: number; localX: number; localY: number } | undefined
const renders = new RenderGeneration()

function log(event: string, details: object = {}) { if (debug) console.debug('[reader]', { event, bookId: id, format: book.value?.format, ...details }) }
async function saveProgress(value: Save) {
  try {
    const result = await api<any>(`/api/v1/books/${id}/progress`, { method: 'PUT', keepalive: true, body: JSON.stringify({ ...value, revision }) })
    revision = result.progress.revision; if (auth.user) clearOfflineProgress(localStorage, auth.user.id, id); syncMessage.value = ''; log('progress-save', { revision, locator: value.locator })
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      revision = (await api<any>(`/api/v1/books/${id}/progress`)).progress?.revision
      if (auth.user) clearOfflineProgress(localStorage, auth.user.id, id)
      syncMessage.value = 'Uma posição mais recente de outra aba ou dispositivo foi preservada.'; return
    }
    if (auth.user) writeOfflineProgress(localStorage, auth.user.id, id, { ...value, revision })
    syncMessage.value = 'Posição guardada neste dispositivo. Ela será sincronizada quando a conexão voltar.'
  }
}
const saver = new QueuedProgressSaver<Save>(saveProgress)
function queue(value: Save) { if (!restoring && !unmounting) saver.schedule(value) }

function scheduleChrome() {
  clearTimeout(chromeTimer)
  if (panel.value || selectedQuote.value || interactionMode.value !== 'idle') { chrome.value = 'locked'; return }
  chrome.value = 'visible'; chromeTimer = window.setTimeout(() => { chrome.value = 'hidden' }, 2800)
}
function showChrome(lock = false) { chrome.value = lock ? 'locked' : 'visible'; if (!lock) scheduleChrome() }
function setMode(mode: ReaderInteractionMode) {
  interactionMode.value = mode; log('input', { mode })
  if (['selecting', 'pinching', 'ui-interaction'].includes(mode)) showChrome(true)
  else if (mode === 'idle' && chrome.value !== 'hidden') scheduleChrome()
}
function handleTap(x: number, width: number) {
  if (selectedQuote.value || panel.value) return
  const zone = readerTapZone(x, width); log('tap', { zone })
  if (zone === 'previous') void move(-1)
  else if (zone === 'next') void move(1)
  else if (chrome.value === 'hidden') showChrome(); else chrome.value = 'hidden'
}

function elements(document: Document) { return [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,blockquote,figure,img')] }
function epubPosition(document: Document) {
  const items = elements(document), view = document.defaultView, height = view?.innerHeight ?? 1
  let index = items.findIndex(item => item.getBoundingClientRect().bottom > Math.min(48, height * .1)); if (index < 0) index = Math.max(0, items.length - 1)
  const scrollY = view?.scrollY ?? 0, max = Math.max(1, document.documentElement.scrollHeight - height)
  epubAtStart.value = scrollY <= 2; epubAtEnd.value = scrollY >= max - 2
  const within = Math.min(1, Math.max(0, scrollY / max)), count = Math.max(1, toc.value.length), chapter = toc.value[currentChapter.value]
  const item = items[index]
  const locator: EpubLocator = { type: 'epub-cfi', cfi: `epubcfi(/6/${(currentChapter.value + 1) * 2}!/4/${(index + 1) * 2})`, chapterHref: chapter?.href, elementIndex: index, offset: item ? Math.round(-item.getBoundingClientRect().top) : 0 }
  return { locator, ratio: Math.min(1, (currentChapter.value + within) / count) }
}
function captureEpub(document = frame.value?.contentDocument ?? undefined, save = true) {
  if (!document || epubBusy.value || layoutChanging.value) return pendingLocator
  const position = epubPosition(document); pendingLocator = position.locator; epubRatio.value = position.ratio
  if (save) queue({ format: 'epub', progressRatio: position.ratio, locator: position.locator }); return position.locator
}
function restoreEpub(document: Document, locator?: EpubLocator) {
  if (locator) {
    log('progress-restore', { locator })
    const items = elements(document), cfiIndex = Number(locator.cfi.match(/!\/4\/(\d+)/)?.[1])
    const index = Number.isInteger(locator.elementIndex) ? locator.elementIndex! : Number.isFinite(cfiIndex) ? Math.max(0, Math.floor(cfiIndex / 2) - 1) : 0
    const target = items[Math.min(items.length - 1, Math.max(0, index))]
    if (index === 0 && !locator.offset) document.defaultView?.scrollTo(0, 0)
    else { target?.scrollIntoView({ block: 'start' }); document.defaultView?.scrollBy(0, locator.offset ?? 0) }
  }
  if (pendingChapterEnd) document.defaultView?.scrollTo(0, document.documentElement.scrollHeight)
  if (pendingAnchor) { document.getElementById(decodeURIComponent(pendingAnchor))?.scrollIntoView({ block: 'start' }); pendingAnchor = '' }
}
async function displayEpub(locator?: EpubLocator, saveAfter = true, atEnd = false) {
  const chapter = toc.value[currentChapter.value]; if (!chapter) return
  const generation = ++epubGeneration
  snapshotEpub(); epubAbort?.abort(); epubAbort = new AbortController(); epubBusy.value = true
  pendingLocator = locator ?? { type: 'epub-cfi', cfi: `epubcfi(/6/${(currentChapter.value + 1) * 2}!/4/2)`, chapterHref: chapter.href, elementIndex: 0, offset: 0 }
  saveAfterFrameLoad = saveAfter; pendingChapterEnd = atEnd
  const url = `/api/v1/books/${id}/epub/chapter?href=${encodeURIComponent(chapter.href)}&scale=${textScale.value}&theme=${readerTheme.value}&lineHeight=${lineHeight.value}&margins=${margins.value}`
  try {
    const response = await fetch(url, { signal: epubAbort.signal })
    if (!response.ok) throw new Error(`Não foi possível carregar o capítulo (${response.status}).`)
    const html = await response.text()
    if (!new DOMParser().parseFromString(html, 'text/html').querySelector('.reader-document')) throw new Error('O capítulo não retornou conteúdo legível.')
    if (generation !== epubGeneration || unmounting) return
    frameGenerations[1 - activeFrame.value] = generation
    frameSources.value[1 - activeFrame.value] = html
    log('epub-render-begin', { generation, chapter: currentChapter.value })
  } catch (error) {
    if (generation !== epubGeneration || unmounting) return
    epubBusy.value = false; presentation?.remove(); syncMessage.value = errorMessage(error); pendingAnchor = ''
    if (loadedChapter < 0) { message.value = syncMessage.value; state.value = 'error' }
    else { currentChapter.value = loadedChapter; pendingLocator = captureEpub(undefined, false) }
    fallbackReady?.(); fallbackReady = undefined
  }
}
async function prepareFrame(event: Event, slot: number) {
  const incoming = event.target as HTMLIFrameElement, doc = incoming.contentDocument
  if (!doc?.querySelector('.reader-document') || !epubBusy.value) return
  const generation = frameGenerations[slot]
  if (slot === activeFrame.value || generation !== epubGeneration) return
  await doc.fonts?.ready
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  if (generation !== epubGeneration || unmounting) return
  restoreEpub(doc, pendingLocator)
  // Retain the previous rendered document until the next iframe has finished layout.
  activeFrame.value = slot
  frame.value = incoming
  await attachFrame()
}

function resolveHref(current: string, target: string) {
  const [path, anchor = ''] = target.split('#'), base = new URL(current, 'https://reader.invalid/'), resolved = new URL(path || base.pathname, base)
  return { href: decodeURIComponent(resolved.pathname.replace(/^\//, '')), anchor }
}
function handleLink(event: MouseEvent, document: Document) {
  const link = (event.target as Element | null)?.closest('a') as HTMLAnchorElement | null
  const raw = link?.dataset.epubHref || link?.getAttribute('href'); if (!raw || /^(https?:|mailto:|tel:)/i.test(raw)) return
  event.preventDefault(); event.stopPropagation()
  if (epubBusy.value) return
  const current = toc.value[currentChapter.value]?.href ?? '', resolved = resolveHref(current, raw)
  if (raw.startsWith('#')) { document.getElementById(decodeURIComponent(raw.slice(1)))?.scrollIntoView(); captureEpub(document); return }
  const index = toc.value.findIndex(item => resolveHref('', item.href).href === resolved.href); if (index < 0) return
  captureEpub(document); pendingAnchor = resolved.anchor
  if (index === currentChapter.value) restoreEpub(document, pendingLocator)
  else { currentChapter.value = index; void displayEpub(undefined, true) }
}

function selectionInside(selection: Selection | null | undefined, root: Node | null | undefined) {
  return Boolean(selection?.rangeCount && root && root.contains(selection.anchorNode) && root.contains(selection.focusNode))
}
function updateSelection(document: Document, format: 'epub' | 'pdf', root: Node = document.body) {
  cancelAnimationFrame(selectionFrame); selectionFrame = requestAnimationFrame(() => {
    const selection = document.defaultView?.getSelection()
    if (!selection?.toString().trim()) { selectedQuote.value = ''; selectedLocator.value = undefined; setMode('idle'); return }
    if (epubBusy.value || reflowLoading.value || !selectionInside(selection, root)) return
    const quote = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!quote) { selectedQuote.value = ''; selectedLocator.value = undefined; setMode('idle'); return }
    selectedQuote.value = quote.slice(0, 10000)
    if (format === 'epub') {
      const items = elements(document), anchor = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode as Element : selection?.anchorNode?.parentElement
      const selected = anchor?.closest('h1,h2,h3,h4,h5,h6,p,li,blockquote,figure') as HTMLElement | null, index = Math.max(0, selected ? items.indexOf(selected) : 0), chapter = toc.value[currentChapter.value]
      selectedLocator.value = { type: 'epub-cfi', cfi: `epubcfi(/6/${(currentChapter.value + 1) * 2}!/4/${(index + 1) * 2})`, chapterHref: chapter?.href, elementIndex: index }
    } else {
      const anchor = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode as Element : selection?.anchorNode?.parentElement
      const selectedPage = Number(anchor?.closest<HTMLElement>('.pdf-page')?.dataset.page || currentPage.value)
      selectedLocator.value = { type: readerMode.value === 'reflow' ? 'pdf-reflow' : 'pdf-page', page: selectedPage }
    }
    setMode('selecting'); showChrome(true)
  })
}
async function attachFrame() {
  frameInputCleanup?.(); frameEventCleanup?.(); const document = frame.value?.contentDocument; if (!document?.querySelector('.reader-document')) return
  const generation = epubGeneration
  const selection = () => updateSelection(document, 'epub'), scroll = () => { cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(() => { captureEpub(document) }) }
  const click = (event: MouseEvent) => handleLink(event, document), key = (event: KeyboardEvent) => onKey(event)
  document.addEventListener('selectionchange', selection); document.addEventListener('scroll', scroll, { passive: true }); document.addEventListener('click', click); document.addEventListener('keydown', key)
  frameEventCleanup = () => { document.removeEventListener('selectionchange', selection); document.removeEventListener('scroll', scroll); document.removeEventListener('click', click); document.removeEventListener('keydown', key) }
  frameInputCleanup = attachReaderInput(document, { onEvent: debug ? event => log(event) : undefined, width: () => document.defaultView?.innerWidth ?? innerWidth, selectionText: () => document.defaultView?.getSelection()?.toString() ?? '', canPan: () => false, canSwipe: () => !epubBusy.value && !panel.value, onTap: handleTap, onSwipe: direction => { void move(direction === 'next' ? 1 : -1) }, onModeChange: setMode })
  await document.fonts?.ready; await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (generation !== epubGeneration || unmounting) return; restoreEpub(document, pendingLocator); epubBusy.value = false; frameSources.value[1 - activeFrame.value] = ''; applyEpubHighlights(document); captureEpub(document, saveAfterFrameLoad)
  loadedChapter = currentChapter.value; pendingChapterEnd = false; finishPresentation(); log('epub-render-end', { chapter: currentChapter.value }); fallbackReady?.(); fallbackReady = undefined
  if (reloadPending) { reloadPending = false; reloadEpub() }
}
async function initEpub(saved: any) {
  toc.value = (await api<{ chapters: Chapter[] }>(`/api/v1/books/${id}/epub/manifest`)).chapters ?? []; if (!toc.value.length) throw new Error('Este EPUB não contém capítulos legíveis.')
  const locator = saved?.locator as EpubLocator | undefined, index = toc.value.findIndex(chapter => chapter.href === locator?.chapterHref); currentChapter.value = index >= 0 ? index : 0
  if (locator?.chapterHref && index < 0) syncMessage.value = 'A edição mudou; a leitura foi retomada no início disponível mais próximo.'
  state.value = 'ready'; await nextTick(); const loaded = new Promise<void>(resolve => { fallbackReady = resolve }); displayEpub(index >= 0 ? locator : undefined, false); await loaded; restoring = false
}

function stageSize() {
  const element = stage.value; if (!element) return { width: innerWidth, height: innerHeight }; const style = getComputedStyle(element)
  return { width: Math.max(1, element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)), height: Math.max(1, element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) }
}
function fitZoom() {
  if (zoomMode.value === 'manual') return
  const size = stageSize(), available = twoPage.value ? { ...size, width: Math.max(1, size.width - 24) } : size
  zoom.value = Math.min(4, Math.max(.25, fitPdfScale(pdfBase, available, zoomMode.value)))
}
function twoPagesFitAtZoom(nextZoom = zoom.value) {
  const size = stageSize()
  return usesTwoPageSpreadAtZoom(size.width, size.height, pdfPageBase.width, nextZoom)
}
async function renderPdf() {
  if (!pdf || readerMode.value === 'reflow') return
  const requestedPages = activePdfPages.value, tasks: any[] = [], textLayers: any[] = []
  const generation = renders.begin(() => { for (const task of tasks) task?.cancel?.(); for (const layer of textLayers) layer?.cancel?.() })
  log('pdf-render-begin', { generation, pages: requestedPages })
  try {
    const pages = await Promise.all(requestedPages.map(pageNumber => pdf.getPage(pageNumber)))
    if (!renders.isCurrent(generation)) { for (const page of pages) page.cleanup?.(); return }
    const bases = pages.map(page => page.getViewport({ scale: 1 }))
    pdfPageBase = { width: bases[0]!.width, height: bases[0]!.height }
    pdfBase = { width: bases.reduce((total, viewport) => total + viewport.width, 0), height: Math.max(...bases.map(viewport => viewport.height)) }
    fitZoom()
    const fragment = document.createDocumentFragment(), prepared: Array<{ page: any; layer: HTMLElement; text: any; viewport: any }> = []
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]!, pageNumber = requestedPages[index]!, viewport = page.getViewport({ scale: zoom.value })
      const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1)), output = Math.min(dpr, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
      const visible = document.createElement('canvas'), context = visible.getContext('2d'); if (!context) throw new Error('Canvas indisponível para o PDF.')
      visible.className = 'pdf-canvas'; visible.setAttribute('aria-label', `Página ${pageNumber} do PDF`); visible.width = Math.max(1, Math.floor(viewport.width * output)); visible.height = Math.max(1, Math.floor(viewport.height * output)); visible.style.width = `${viewport.width}px`; visible.style.height = `${viewport.height}px`
      const task = page.render({ canvas: visible, canvasContext: context, viewport, transform: output === 1 ? undefined : [output, 0, 0, output, 0, 0] }); tasks.push(task); await task.promise
      const layer = document.createElement('div'); layer.className = 'textLayer'; layer.dataset.page = String(pageNumber); layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`; layer.style.setProperty('--total-scale-factor', String(viewport.scale))
      const wrapper = document.createElement('section'); wrapper.className = `pdf-page${pdfInvert.value ? ' pdf-page--inverted' : ''}`; wrapper.dataset.page = String(pageNumber); wrapper.setAttribute('aria-label', `Página ${pageNumber}`); wrapper.append(visible, layer); fragment.append(wrapper)
      prepared.push({ page, layer, text: await page.getTextContent(), viewport })
    }
    if (!renders.isCurrent(generation) || !pdfSpread.value) { for (const page of pages) page.cleanup?.(); return }
    for (const layer of pdfTextLayers) layer?.cancel?.()
    if (turnDirection.value) snapshotPdf()
    pdfSpread.value.replaceChildren(fragment)
    for (const item of prepared) { const textLayer = new pdfjs.TextLayer({ textContentSource: item.text, container: item.layer, viewport: item.viewport }); textLayers.push(textLayer); await textLayer.render(); if (!renders.isCurrent(generation)) return }
    pdfTextLayers = textLayers; applyPdfHighlights(); pinchScale.value = 1; await nextTick(); restoreZoomAnchor(); queue({ format: 'pdf', progressRatio: pageRatio.value, locator: { type: 'pdf-page', page: requestedPages[0]! } }); renders.finish(generation); finishPresentation(); for (const page of pages) page.cleanup?.(); log('pdf-render-end', { generation, pages: requestedPages, zoom: zoom.value })
  } catch (error: any) { if (error?.name !== 'RenderingCancelledException' && renders.isCurrent(generation)) throw error }
}
async function initPdf(saved: any) {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = workerUrl; pdf = await pdfjs.getDocument({ url: `/api/v1/books/${id}/content`, withCredentials: true }).promise
  pageCount.value = pdf.numPages; currentPage.value = Math.min(pageCount.value, Math.max(1, saved?.locator?.page ?? 1)); readerMode.value = resolvePdfReaderMode(route.query.mode, saved?.locator?.type); zoomMode.value = innerWidth < 640 ? 'fit-width' : 'fit-page'; twoPage.value = usesTwoPageSpread(innerWidth, innerHeight)
  state.value = 'ready'; await nextTick(); attachStage(); if (readerMode.value === 'reflow') await loadReflow(saved?.locator); else await renderPdf(); restoring = false
}
function textNodes(root: Node) {
  const document = root.ownerDocument ?? root as Document, walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []; let node: Node | null
  while ((node = walker.nextNode())) if (node.textContent) nodes.push(node as Text)
  return nodes
}
function clearHighlightMarks(root: ParentNode) {
  for (const mark of [...root.querySelectorAll<HTMLElement>('mark[data-litera-highlight]')]) mark.replaceWith(mark.textContent ?? '')
  // Do not normalize Vue-owned nodes: empty text nodes anchor keyed fragments.
}
function applyHighlightMarks(root: HTMLElement, visibleHighlights: Highlight[], preferredElement?: (highlight: Highlight) => Element | undefined) {
  clearHighlightMarks(root)
  const nodes = textNodes(root), chunks = nodes.map(node => node.data), ranges = new Map<number, Array<{ start: number; end: number; id: number }>>()
  for (const highlight of visibleHighlights) {
    const preferred = preferredElement?.(highlight), preferredChunk = preferred ? nodes.findIndex(node => preferred.contains(node)) : undefined
    for (const range of findTextHighlightRanges(chunks, highlight.quoteText, preferredChunk !== undefined && preferredChunk >= 0 ? preferredChunk : undefined)) {
      const entries = ranges.get(range.chunkIndex) ?? []; entries.push({ start: range.start, end: range.end, id: highlight.id }); ranges.set(range.chunkIndex, entries)
    }
  }
  for (const [chunkIndex, entries] of ranges) {
    const node = nodes[chunkIndex]; if (!node?.parentNode) continue
    const merged = entries.sort((left, right) => left.start - right.start).reduce<typeof entries>((result, entry) => {
      const previous = result[result.length - 1]
      if (previous && entry.start <= previous.end) previous.end = Math.max(previous.end, entry.end)
      else result.push({ ...entry })
      return result
    }, [])
    for (const range of merged.reverse()) {
      const selected = node.splitText(range.start), after = selected.splitText(range.end - range.start), mark = root.ownerDocument.createElement('mark')
      mark.className = 'saved-highlight'; mark.dataset.literaHighlight = String(range.id); mark.style.background = getComputedStyle(shell.value ?? document.documentElement).getPropertyValue('--reader-highlight'); mark.style.color = 'inherit'; selected.replaceWith(mark); mark.append(selected)
      if (!after.data) after.remove()
    }
  }
}
function applyEpubHighlights(document: Document) {
  const chapter = toc.value[currentChapter.value], items = elements(document)
  const visible = highlights.value.filter(item => item.locator.type === 'epub-cfi' && item.locator.chapterHref === chapter?.href)
  applyHighlightMarks(document.body, visible, highlight => items[(highlight.locator as EpubLocator).elementIndex ?? -1])
}
function applyPdfHighlights() {
  if (!pdfSpread.value) return
  for (const layer of pdfSpread.value.querySelectorAll<HTMLElement>('.textLayer[data-page]')) {
    const pageNumber = Number(layer.dataset.page)
    applyHighlightMarks(layer, highlights.value.filter(item => (item.pageNumber || (item.locator as any)?.page) === pageNumber))
  }
}
function applyReflowHighlights() {
  const content = stage.value?.querySelector<HTMLElement>('.reader-document'); if (!content) return
  applyHighlightMarks(content, highlights.value.filter(item => (item.pageNumber || (item.locator as any)?.page) === currentPage.value))
}
function needsPan() { return readerMode.value === 'visual' && zoomMode.value === 'manual' && zoom.value > fitPdfScale(pdfBase, stageSize(), 'fit-width') + .01 }
function captureZoomAnchor(center: { x: number; y: number }) {
  const container = stage.value, pages = [...(container?.querySelectorAll<HTMLElement>('.pdf-page') ?? [])]; if (!container || !pages.length) return
  const page = pages.find(item => { const rect = item.getBoundingClientRect(); return center.x >= rect.left && center.x <= rect.right }) ?? pages[0]!
  const stageRect = container.getBoundingClientRect(), pageRect = page.getBoundingClientRect()
  zoomAnchor = { pageNumber: Number(page.dataset.page || currentPage.value), pageX: Math.min(1, Math.max(0, (center.x - pageRect.left) / Math.max(1, pageRect.width))), pageY: Math.min(1, Math.max(0, (center.y - pageRect.top) / Math.max(1, pageRect.height))), localX: center.x - stageRect.left, localY: center.y - stageRect.top }
}
function startPinch(center: { x: number; y: number }) {
  if (book.value?.format !== 'pdf' || readerMode.value !== 'visual' || !pdfSpread.value) return; const rect = pdfSpread.value.getBoundingClientRect()
  captureZoomAnchor(center); pinchOrigin.value = { x: center.x - rect.left, y: center.y - rect.top }
}
function changePinch(scale: number) { if (book.value?.format === 'pdf' && readerMode.value === 'visual') pinchScale.value = Math.min(4 / zoom.value, Math.max(.25 / zoom.value, scale)) }
function endPinch(scale: number) { if (book.value?.format !== 'pdf' || readerMode.value !== 'visual') return; const nextZoom = Math.min(4, Math.max(.25, zoom.value * scale)); if (Math.abs(nextZoom - zoom.value) < .015) { pinchScale.value = 1; zoomAnchor = undefined; return } zoomMode.value = 'manual'; zoom.value = nextZoom; twoPage.value = twoPagesFitAtZoom(nextZoom); void safely(renderPdf) }
function restoreZoomAnchor() {
  const anchor = zoomAnchor, container = stage.value, page = container?.querySelector<HTMLElement>(`.pdf-page[data-page="${anchor?.pageNumber}"]`); if (!anchor || !container || !page) return
  const stageRect = container.getBoundingClientRect(), pageRect = page.getBoundingClientRect()
  container.scrollLeft += pageRect.left + anchor.pageX * pageRect.width - (stageRect.left + anchor.localX)
  container.scrollTop += pageRect.top + anchor.pageY * pageRect.height - (stageRect.top + anchor.localY)
  zoomAnchor = undefined
}
function resetStageScroll() { if (stage.value) { stage.value.scrollLeft = 0; stage.value.scrollTop = 0 } }
function attachStage() {
  stageInputCleanup?.(); if (!stage.value) return
  stageInputCleanup = attachReaderInput(stage.value, { onEvent: debug ? event => log(event) : undefined, width: () => stage.value?.clientWidth ?? innerWidth, selectionText: () => getSelection()?.toString() ?? '', canPan: needsPan, canSwipe: () => readerMode.value === 'visual' && zoomMode.value !== 'manual' && !panel.value, onTap: handleTap, onSwipe: direction => { void move(direction === 'next' ? 1 : -1) }, onPinchStart: startPinch, onPinchChange: changePinch, onPinchEnd: endPinch, onMousePan: (x, y) => { if (stage.value) { stage.value.scrollLeft += x; stage.value.scrollTop += y } }, onModeChange: setMode })
}

async function safely(action: () => Promise<void>) { try { await action() } catch (error) { syncMessage.value = errorMessage(error); log('error', { operation: action.name, message: syncMessage.value }) } }
function snapshotEpub() {
  presentation?.remove()
  const doc = frame.value?.contentDocument
  if (!doc?.body || !stage.value) return
  const snapshot = document.createElement('div'); snapshot.className = 'reader-presentation'; snapshot.setAttribute('aria-hidden', 'true')
  const shadow = snapshot.attachShadow({ mode: 'open' })
  for (const style of doc.querySelectorAll('style')) shadow.append(style.cloneNode(true))
  const body = document.createElement('div'); body.style.cssText = `background:${getComputedStyle(doc.body).backgroundColor};color:${getComputedStyle(doc.body).color};position:relative;top:-${doc.defaultView?.scrollY ?? 0}px;min-height:100%`
  for (const child of doc.body.childNodes) body.append(child.cloneNode(true))
  shadow.append(body); stage.value.append(snapshot); presentation = snapshot
}
function snapshotPdf() {
  const container = stage.value
  if (!container || !pdfSpread.value?.children.length) return
  presentation?.remove()
  const snapshot = document.createElement('div'); snapshot.className = 'reader-presentation'; snapshot.setAttribute('aria-hidden', 'true')
  snapshot.style.top = `${container.scrollTop}px`; snapshot.style.left = `${container.scrollLeft}px`; snapshot.style.height = `${container.clientHeight}px`; snapshot.style.width = `${container.clientWidth}px`
  const canvas = document.createElement('canvas'); canvas.width = container.clientWidth; canvas.height = container.clientHeight
  const context = canvas.getContext('2d'); if (!context) return
  context.fillStyle = getComputedStyle(container).backgroundColor; context.fillRect(0, 0, canvas.width, canvas.height)
  const bounds = container.getBoundingClientRect()
  for (const source of pdfSpread.value.querySelectorAll('canvas')) {
    const rect = source.getBoundingClientRect()
    context.drawImage(source, rect.left - bounds.left, rect.top - bounds.top, rect.width, rect.height)
  }
  snapshot.append(canvas); container.append(snapshot); presentation = snapshot
}
function finishPresentation() {
  const outgoing = presentation, direction = turnDirection.value; turnDirection.value = ''
  if (!outgoing) return
  if (reducedMotion.value || matchMedia('(prefers-reduced-motion: reduce)').matches || !outgoing.animate) { outgoing.remove(); return }
  const animation = outgoing.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${direction === 'prev' ? 18 : -18}px)` }], { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' })
  const cleanup = () => { outgoing.remove(); if (presentation === outgoing) presentation = undefined }
  animation.finished.then(cleanup, cleanup)
}
async function move(delta: number) {
  if (layoutChanging.value) { queuedNavigation = delta; return }
  if (frame.value?.contentWindow?.getSelection()?.toString().trim() || getSelection()?.toString().trim()) return
  if (restoring || epubBusy.value || reflowLoading.value || !book.value || selectedQuote.value || panel.value || ['pinching', 'panning'].includes(interactionMode.value)) return
  turnDirection.value = delta > 0 ? 'next' : 'prev'
  if (book.value.format === 'epub') {
    const doc = frame.value?.contentDocument, view = doc?.defaultView
    if (doc && view) {
      const maximum = Math.max(0, doc.documentElement.scrollHeight - view.innerHeight)
      if ((delta > 0 && view.scrollY < maximum - 2) || (delta < 0 && view.scrollY > 2)) {
        snapshotEpub(); view.scrollBy(0, delta * Math.max(1, view.innerHeight - 48)); captureEpub(); finishPresentation(); return
      }
    }
    const next = Math.min(toc.value.length - 1, Math.max(0, currentChapter.value + delta)); if (next === currentChapter.value) return; captureEpub(); currentChapter.value = next; displayEpub(undefined, true, delta < 0) }
  else if (readerMode.value === 'reflow' && stage.value) {
    const container = stage.value, maximum = Math.max(0, container.scrollHeight - container.clientHeight)
    if ((delta > 0 && container.scrollTop < maximum - 2) || (delta < 0 && container.scrollTop > 2)) {
      container.scrollTop = Math.max(0, Math.min(maximum, container.scrollTop + delta * Math.max(1, container.clientHeight - 48)))
      captureReflow(); turnDirection.value = ''; return
    }
    const next = Math.min(pageCount.value, Math.max(1, currentPage.value + delta))
    if (next === currentPage.value) { turnDirection.value = ''; return }
    currentPage.value = next
    await safely(() => loadReflow(undefined, delta < 0))
  }
  else { const next = readerMode.value === 'visual' ? movePdfSpread(currentPage.value, pageCount.value, delta, twoPage.value) : Math.min(pageCount.value, Math.max(1, currentPage.value + delta)); if (next === currentPage.value) return; currentPage.value = next; resetStageScroll(); if (readerMode.value === 'reflow') await safely(loadReflow); else await safely(renderPdf) }
}
async function goToc(item: Chapter) { if (epubBusy.value) return; captureEpub(); const index = toc.value.findIndex(chapter => chapter.href === item.href); if (index >= 0) { currentChapter.value = index; displayEpub(undefined, true) } closePanel() }
function captureReflow() {
  const container = stage.value
  if (!container || readerMode.value !== 'reflow' || reflowLoading.value || layoutChanging.value) return
  const maximum = Math.max(0, container.scrollHeight - container.clientHeight)
  reflowAtStart.value = container.scrollTop <= 2; reflowAtEnd.value = container.scrollTop >= maximum - 2
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-reflow-block], .reader-document__visual')]
  const top = container.getBoundingClientRect().top
  const target = blocks.find(block => block.getBoundingClientRect().bottom > top) ?? blocks[blocks.length - 1]
  const offset = target ? Math.max(0, (top - target.getBoundingClientRect().top) / Math.max(1, target.offsetHeight)) : 0
  reflowLocator = { type: 'pdf-reflow', page: currentPage.value, blockIndex: target ? blocks.indexOf(target) : 0, offset }
  queue({ format: 'pdf', progressRatio: pageRatio.value, locator: reflowLocator })
}
function restoreReflow(locator?: PdfLocator) {
  const container = stage.value
  if (!container || readerMode.value !== 'reflow') return
  const target = container.querySelectorAll<HTMLElement>('[data-reflow-block], .reader-document__visual')[locator?.blockIndex ?? 0]
  if (!locator || (!locator.blockIndex && !locator.offset)) container.scrollTop = 0
  else if (target) container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top + Math.min(1, Math.max(0, locator.offset ?? 0)) * target.offsetHeight
}
async function loadReflow(locator?: PdfLocator, atEnd = false) {
  const generation = ++reflowGeneration, requestedPage = currentPage.value
  const previous = { locator: reflowLocator, blocks: reflowBlocks.value, figures: reflowFigures.value, visual: reflowVisualReference.value }
  let committed = false
  reflowLoading.value = true
  try {
    const result = await api<any>(`/api/v1/books/${id}/pdf/reflow?page=${requestedPage}`)
    if (generation !== reflowGeneration) return
    reflowBlocks.value = result.blocks; reflowFigures.value = result.figures ?? []; reflowVisualReference.value = !result.blocks.length; pageCount.value = result.pageCount
    await nextTick()
    if (generation !== reflowGeneration) return
    const rendered = [...(stage.value?.querySelectorAll('.reader-document h1,.reader-document h2,.reader-document p:not(.reader-text-status)') ?? [])].map(node => node.textContent).join('')
    const expected = result.blocks.flatMap((block: PdfReflowBlock) => block.spans.map(span => span.text)).join('')
    if (pdfTextSignature(rendered) !== pdfTextSignature(expected)) throw new Error('Não foi possível exibir o texto completo. Tente abrir a página novamente.')
    applyReflowHighlights()
    if (generation !== reflowGeneration) return
    await Promise.all([...(stage.value?.querySelectorAll<HTMLImageElement>('.reader-document img') ?? [])].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve() })))
    if (generation !== reflowGeneration) return
    restoreReflow(locator)
    if (atEnd && stage.value) stage.value.scrollTop = stage.value.scrollHeight
    committed = true
    finishPresentation()
    log('adaptation', { page: requestedPage, ...result.adaptation, visualReference: reflowVisualReference.value })
  } catch (error) {
    if (generation === reflowGeneration && previous.locator) {
      currentPage.value = previous.locator.page; reflowBlocks.value = previous.blocks; reflowFigures.value = previous.figures; reflowVisualReference.value = previous.visual
      await nextTick(); restoreReflow(previous.locator)
    }
    throw error
  } finally { if (generation === reflowGeneration) { reflowLoading.value = false; if (committed) captureReflow() } }
}
async function togglePdfMode() { readerMode.value = readerMode.value === 'visual' ? 'reflow' : 'visual'; void router.replace({ query: { ...route.query, mode: readerMode.value === 'reflow' ? 'epub' : 'pdf' } }); closePanel(false); renders.cancel(); reflowGeneration++; resetStageScroll(); await nextTick(); attachStage(); if (readerMode.value === 'reflow') await safely(loadReflow); else await safely(renderPdf) }
async function adjustZoom(delta: number) { const container = stage.value; if (container) { const rect = container.getBoundingClientRect(); captureZoomAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) } zoomMode.value = 'manual'; zoom.value = Math.min(4, Math.max(.25, zoom.value + delta)); twoPage.value = twoPagesFitAtZoom(); await safely(renderPdf) }
async function setZoomMode(mode: 'fit-width' | 'fit-page') { zoomMode.value = mode; twoPage.value = usesTwoPageSpread(innerWidth, innerHeight); zoomAnchor = undefined; resetStageScroll(); await safely(renderPdf) }
function reloadEpub() { if (epubBusy.value) { reloadPending = true; return }; displayEpub(captureEpub(undefined, true), true) }
async function adjustText(delta: number) { captureReflow(); textScale.value = Math.min(140, Math.max(80, textScale.value + delta)); if (book.value?.format === 'epub') reloadEpub(); else if (readerMode.value === 'reflow') { await nextTick(); restoreReflow(reflowLocator); captureReflow() } await persistSettings() }
async function changeSetting() { if (book.value?.format === 'epub') reloadEpub(); else if (readerMode.value === 'reflow') { await nextTick(); restoreReflow(reflowLocator); captureReflow() } await persistSettings() }
function setTheme(theme: 'light' | 'sepia' | 'dark') { readerTheme.value = theme; if (book.value?.format === 'epub') reloadEpub(); void persistSettings() }
function setToolbarPosition(position: 'top' | 'bottom') { toolbarPosition.value = position; localStorage.setItem('litera-reader-toolbar-position', position); showChrome() }
async function persistSettings() { await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify({ theme: readerTheme.value, fontScale: textScale.value, lineHeight: lineHeight.value, margins: margins.value, appTheme: appTheme.value, reducedMotion: reducedMotion.value, pdfInvert: pdfInvert.value }) }) }
function clearSelection() { selectedQuote.value = ''; selectedLocator.value = undefined; getSelection()?.removeAllRanges(); frame.value?.contentWindow?.getSelection()?.removeAllRanges(); setMode('idle'); showChrome() }
async function saveHighlight() {
  if (!selectedQuote.value || !selectedLocator.value || !book.value) return; savingHighlight.value = true
  try { const chapterHref = selectedLocator.value.type === 'epub-cfi' ? selectedLocator.value.chapterHref : undefined, chapter = toc.value.find(item => item.href === chapterHref)?.label, selectedPage = selectedLocator.value.type === 'pdf-page' || selectedLocator.value.type === 'pdf-reflow' ? selectedLocator.value.page : currentPage.value; const result = await api<any>(`/api/v1/books/${id}/highlights`, { method: 'POST', body: JSON.stringify({ quoteText: selectedQuote.value, locator: selectedLocator.value, chapter, ...(book.value.format === 'pdf' ? { pageNumber: selectedPage } : {}) }) }); highlights.value.unshift(result.highlight); clearSelection(); if (book.value.format === 'pdf') { if (readerMode.value === 'reflow') applyReflowHighlights(); else applyPdfHighlights() } else if (frame.value?.contentDocument) applyEpubHighlights(frame.value.contentDocument) } finally { savingHighlight.value = false }
}
async function searchBook() {
  const query = searchQuery.value.trim(); if (query.length < 2 || !book.value) return; const generation = ++searchGeneration; searching.value = true
  try { if (book.value.format === 'epub') { const result = await api<any>(`/api/v1/books/${id}/epub/search?q=${encodeURIComponent(query)}`); if (generation === searchGeneration) searchResults.value = result.results } else { const found = []; for (let number = 1; number <= pageCount.value && found.length < 20 && generation === searchGeneration; number++) { const page = await pdf.getPage(number), content = await page.getTextContent(), text = content.items.map((item: any) => item.str || '').join(' '); if (text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push({ page: number, label: `Página ${number}`, excerpt: text.slice(0, 160) }); page.cleanup?.() } if (generation === searchGeneration) searchResults.value = found } } finally { if (generation === searchGeneration) searching.value = false }
}
async function openResult(result: any) { if (book.value?.format === 'epub') await goToc({ id: result.href, href: result.href, label: result.label }); else { currentPage.value = result.page; if (readerMode.value === 'reflow') await safely(loadReflow); else await safely(renderPdf); closePanel() } }

function togglePanel(next: Panel, event?: MouseEvent) { const value = panel.value === next ? null : next; if (value) panelTrigger = event?.currentTarget as HTMLElement; panel.value = value; if (value) { showChrome(true); void nextTick(() => panelClose.value?.focus()) } else closePanel() }
function closePanel(focus = true) { searchGeneration++; searching.value = false; panel.value = null; if (focus) panelTrigger?.focus(); panelTrigger = undefined; showChrome() }
async function toggleFullscreen() { try { if (!document.fullscreenElement) { if (!shell.value?.requestFullscreen) { syncMessage.value = 'Tela cheia não é suportada neste navegador.'; return } await shell.value.requestFullscreen() } else await document.exitFullscreen() } catch { syncMessage.value = 'Não foi possível alternar a tela cheia neste dispositivo.' } }
function onKey(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.matches?.('input,textarea,select,[contenteditable="true"]')) return
  if (event.key === 'Escape' && panel.value) { event.preventDefault(); closePanel(); return }
  if (event.key === ' ' && (event.target as Element)?.closest?.('button,a,[role="button"]')) return
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); void move(-1) }
  else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); void move(1) }
  else if (book.value?.format === 'pdf' && ['+', '='].includes(event.key)) { event.preventDefault(); void adjustZoom(.2) }
  else if (book.value?.format === 'pdf' && event.key === '-') { event.preventDefault(); void adjustZoom(-.2) }
  else if (event.key.toLocaleLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen() }
}
function updateViewport() { shell.value?.style.setProperty('--reader-viewport-height', `${Math.round(visualViewport?.height ?? innerHeight)}px`); shell.value?.style.setProperty('--reader-viewport-top', `${Math.round(visualViewport?.offsetTop ?? 0)}px`) }
function scheduleLayout() {
  if (visualViewport && visualViewport.scale !== 1) return
  const width = innerWidth, height = Math.round(visualViewport?.height ?? innerHeight)
  if (layoutSize.width === width && layoutSize.height === height) return
  layoutChanging.value = true; clearTimeout(layoutTimer)
  // Debounce browser chrome/orientation resize bursts; retain the last semantic locator.
  layoutTimer = window.setTimeout(() => {
    layoutSize = { width, height }; updateViewport()
    cancelAnimationFrame(viewportFrame)
    viewportFrame = requestAnimationFrame(() => {
      layoutChanging.value = false
      if (book.value?.format === 'epub') {
        const doc = frame.value?.contentDocument
        if (doc && !epubBusy.value && !doc.defaultView?.getSelection()?.toString().trim()) { restoreEpub(doc, pendingLocator); captureEpub(doc, false) }
      } else if (state.value === 'ready' && readerMode.value === 'visual') {
        twoPage.value = zoomMode.value === 'manual' ? twoPagesFitAtZoom() : usesTwoPageSpread(width, height)
        void safely(renderPdf)
      }
      if (readerMode.value === 'reflow') { restoreReflow(reflowLocator); captureReflow() }
      log('viewport', { width, height }); if (queuedNavigation) { const delta = queuedNavigation; queuedNavigation = 0; void move(delta) }
    })
  }, 120)
}
function visibility() { if (document.visibilityState === 'hidden') { if (book.value?.format === 'epub') captureEpub(); void saver.flush().catch(() => undefined) } else scheduleLayout() }
function syncOfflineProgress() { if (!auth.user || restoring) return; const draft = readOfflineProgress(localStorage, auth.user.id, id); if (!draft || draft.format !== book.value?.format) return; revision = draft.revision ?? revision; saver.schedule({ format: draft.format, progressRatio: draft.progressRatio, locator: draft.locator }); void saver.flush().catch(() => undefined) }
function documentSelection() {
  if (book.value?.format !== 'pdf') return
  const root = readerMode.value === 'reflow' ? stage.value?.querySelector('.reader-document') : pdfSpread.value
  updateSelection(document, 'pdf', root ?? undefined)
}
function errorMessage(error: unknown) { const name = (error as any)?.name; if (name === 'PasswordException') return 'Este PDF é protegido por senha.'; if (name === 'InvalidPDFException') return 'O PDF está corrompido ou não é suportado.'; return error instanceof Error ? error.message : 'O leitor não pôde abrir o livro.' }
function retry() { window.location.reload() }

onMounted(async () => {
  toolbarPosition.value = localStorage.getItem('litera-reader-toolbar-position') === 'bottom' ? 'bottom' : 'top'
  bodyOverflow = document.body.style.overflow; bodyOverscroll = document.body.style.overscrollBehavior; document.body.style.overflow = 'hidden'; document.body.style.overscrollBehavior = 'none'
  addEventListener('keydown', onKey); addEventListener('resize', scheduleLayout, { passive: true }); addEventListener('orientationchange', scheduleLayout, { passive: true }); addEventListener('online', syncOfflineProgress); visualViewport?.addEventListener('resize', scheduleLayout, { passive: true }); document.addEventListener('fullscreenchange', scheduleLayout); document.addEventListener('visibilitychange', visibility); document.addEventListener('selectionchange', documentSelection); addEventListener('pagehide', visibility); updateViewport(); showChrome()
  try {
    book.value = (await api<any>(`/api/v1/books/${id}`)).book; const [saved, settings, highlightResult] = await Promise.all([api<any>(`/api/v1/books/${id}/progress`), api<any>('/api/v1/settings'), api<any>(`/api/v1/books/${id}/highlights`)])
    const draft = auth.user ? readOfflineProgress(localStorage, auth.user.id, id) : undefined
    highlights.value = highlightResult.highlights; const target = highlights.value.find(item => item.id === Number(route.query.highlight)), restore = target ? { locator: target.locator } : draft?.format === book.value!.format ? draft : saved.progress; revision = draft?.revision ?? saved.progress?.revision
    readerTheme.value = settings.preferences.theme; textScale.value = settings.preferences.fontScale; lineHeight.value = settings.preferences.lineHeight; margins.value = settings.preferences.margins; appTheme.value = settings.preferences.appTheme; reducedMotion.value = settings.preferences.reducedMotion; pdfInvert.value = settings.preferences.pdfInvert; applyTheme(appTheme.value); document.documentElement.dataset.reducedMotion = String(reducedMotion.value)
    if (book.value!.format === 'epub') await initEpub(restore); else await initPdf(restore); await nextTick(); attachStage(); if (window.ResizeObserver && stage.value) { resizeObserver = new ResizeObserver(scheduleLayout); resizeObserver.observe(stage.value) }; if (draft) syncOfflineProgress()
  } catch (error) { message.value = errorMessage(error); state.value = 'error'; restoring = false }
})
onBeforeUnmount(() => {
  if (book.value?.format === 'epub') captureEpub(); unmounting = true; removeEventListener('keydown', onKey); removeEventListener('resize', scheduleLayout); removeEventListener('orientationchange', scheduleLayout); removeEventListener('online', syncOfflineProgress); visualViewport?.removeEventListener('resize', scheduleLayout); document.removeEventListener('fullscreenchange', scheduleLayout); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('selectionchange', documentSelection); removeEventListener('pagehide', visibility)
  epubAbort?.abort(); epubGeneration++; presentation?.remove(); resizeObserver?.disconnect(); stageInputCleanup?.(); frameInputCleanup?.(); frameEventCleanup?.(); renders.cancel(); for (const layer of pdfTextLayers) layer?.cancel?.(); reflowGeneration++; searchGeneration++; clearTimeout(chromeTimer); clearTimeout(layoutTimer); cancelAnimationFrame(viewportFrame); cancelAnimationFrame(selectionFrame); cancelAnimationFrame(scrollFrame); void saver.dispose().catch(() => undefined); try { void pdf?.destroy?.() } catch { /* deterministic cleanup */ }
  document.body.style.overflow = bodyOverflow; document.body.style.overscrollBehavior = bodyOverscroll
})
</script>

<template>
  <div ref="shell" class="reader-shell" :class="{ 'reader-shell--focus': chrome === 'hidden', 'reader-shell--toolbar-bottom': toolbarPosition === 'bottom' }">
    <header class="reader-toolbar" data-reader-interactive>
      <div class="reader-toolbar__edge reader-toolbar__edge--start"><RouterLink class="icon-button" :to="`/books/${id}`" aria-label="Voltar ao livro"><UiIcon name="arrow-left" /></RouterLink></div>
      <nav class="reader-page-controls" aria-label="Navegação da leitura">
        <button class="icon-button" aria-label="Voltar na leitura" :disabled="!canMovePrevious" @click="move(-1)"><UiIcon name="chevron-left" /></button>
        <div class="reader-progress"><span>{{ readerPosition }}</span><i><b :style="{ width: `${Math.round(readerRatio * 100)}%` }" /></i></div>
        <button class="icon-button" aria-label="Avançar na leitura" :disabled="!canMoveNext" @click="move(1)"><UiIcon name="chevron-right" /></button>
      </nav>
      <div class="reader-toolbar__edge reader-toolbar__edge--end reader-actions">
        <button v-if="capabilities.toc" class="icon-button" aria-label="Abrir sumário" @click="togglePanel('toc', $event)"><UiIcon name="library" /></button>
        <button v-if="capabilities.search" class="icon-button reader-search-action" aria-label="Buscar dentro do livro" @click="togglePanel('search', $event)"><UiIcon name="search" /></button>
        <button class="icon-button" aria-label="Configurações de leitura" @click="togglePanel('settings', $event)"><UiIcon name="settings" /></button>
      </div>
    </header>
    <AppState v-if="state === 'loading'" kind="loading" />
    <AppState v-else-if="state === 'error'" kind="error" title="Não foi possível abrir este livro" :message="message"><button class="button button--primary" @click="retry">Tentar novamente</button> <RouterLink class="button button--secondary" :to="`/books/${id}`">Voltar ao livro</RouterLink></AppState>
    <template v-else>
      <p v-if="syncMessage" class="reader-sync" role="status">{{ syncMessage }}</p><output v-if="debug" class="reader-debug">{{ interactionMode }} · {{ readerPosition }} · {{ zoomMode }} {{ Math.round(zoom * 100) }}%</output>
      <div v-if="selectedQuote" class="selection-toolbar" role="toolbar" aria-label="Ações do trecho selecionado" data-reader-interactive><span>“{{ selectedQuote.slice(0, 70) }}<template v-if="selectedQuote.length > 70">…</template>”</span><button class="button button--tonal" :disabled="savingHighlight" @click="saveHighlight"><UiIcon name="sparkles" />{{ savingHighlight ? 'Salvando…' : 'Destacar' }}</button><button class="icon-button" aria-label="Fechar ações do trecho" @click="clearSelection"><UiIcon name="x" :size="16" /></button></div>
      <button v-if="panel" class="reader-panel-backdrop" aria-label="Fechar painel" @click="closePanel()" />
      <aside v-if="panel" class="reader-toc" role="dialog" aria-modal="true" data-reader-interactive>
        <header><h2>{{ panel === 'toc' ? 'Sumário' : panel === 'settings' ? 'Leitura' : 'Buscar no livro' }}</h2><button ref="panelClose" class="icon-button" aria-label="Fechar painel" @click="closePanel()"><UiIcon name="x" /></button></header>
        <template v-if="panel === 'toc'"><button v-for="item in toc" :key="item.href" @click="goToc(item)">{{ item.label }}</button></template>
        <template v-else-if="panel === 'settings'">
          <p>Posição dos controles</p><div class="reader-fit-row"><button :aria-pressed="toolbarPosition === 'top'" @click="setToolbarPosition('top')">Topo</button><button :aria-pressed="toolbarPosition === 'bottom'" @click="setToolbarPosition('bottom')">Base</button></div>
          <template v-if="book?.format === 'pdf'"><p>Modo de leitura</p><div class="reader-fit-row"><button :aria-pressed="readerMode === 'visual'" @click="readerMode !== 'visual' && togglePdfMode()">Documento original</button><button :aria-pressed="readerMode === 'reflow'" @click="readerMode !== 'reflow' && togglePdfMode()">Texto adaptado</button></div></template>
          <template v-if="book?.format === 'epub' || readerMode === 'reflow'"><p>Tamanho do texto</p><div class="reader-settings-row"><button @click="adjustText(-10)">−</button><span>{{ textScale }}%</span><button @click="adjustText(10)">+</button></div><label for="lines">Entrelinhas</label><select id="lines" v-model="lineHeight" @change="changeSetting"><option value="compact">Compacta</option><option value="normal">Normal</option><option value="relaxed">Relaxada</option></select><label for="margins">Largura do texto</label><select id="margins" v-model="margins" @change="changeSetting"><option value="narrow">Estreita</option><option value="normal">Normal</option><option value="wide">Ampla</option></select><p>Tema</p><div class="reader-settings-row"><button :aria-pressed="readerTheme === 'light'" @click="setTheme('light')">Claro</button><button :aria-pressed="readerTheme === 'sepia'" @click="setTheme('sepia')">Sépia</button><button :aria-pressed="readerTheme === 'dark'" @click="setTheme('dark')">Escuro</button></div></template>
          <template v-else><p>Enquadramento</p><div class="reader-fit-row"><button :aria-pressed="zoomMode === 'fit-width'" @click="setZoomMode('fit-width')">Ajustar largura</button><button :aria-pressed="zoomMode === 'fit-page'" @click="setZoomMode('fit-page')">Página inteira</button></div><p>Zoom manual</p><div class="reader-settings-row"><button @click="adjustZoom(-.2)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button @click="adjustZoom(.2)">+</button></div><label class="reader-invert"><span><strong>Inverter cores</strong><small>Sem alterar o arquivo.</small></span><input v-model="pdfInvert" type="checkbox" @change="persistSettings" /></label></template>
          <div class="reader-settings-actions"><button @click="toggleFullscreen">Alternar tela cheia</button></div>
        </template>
        <template v-else><form class="reader-search" @submit.prevent="searchBook"><label for="reader-query">Texto</label><input id="reader-query" v-model="searchQuery" type="search" minlength="2" required /><button class="button button--primary" :disabled="searching">{{ searching ? 'Buscando…' : 'Buscar' }}</button></form><button v-for="result in searchResults" :key="result.href || result.page" @click="openResult(result)"><strong>{{ result.label }}</strong><small>{{ result.excerpt }}</small></button><p v-if="!searchResults.length && !searching && searchQuery">Nenhuma ocorrência encontrada.</p></template>
      </aside>
      <main ref="stage" :aria-busy="epubBusy || reflowLoading || layoutChanging" class="reader-stage" :class="[turnDirection && `reader-stage--${turnDirection}`, readerMode === 'reflow' && `reader-stage--theme-${readerTheme}`, { 'reader-stage--pdf': book?.format === 'pdf' && readerMode === 'visual', 'reader-stage--reflow': readerMode === 'reflow', 'reader-stage--text': book?.format === 'epub' || readerMode === 'reflow' }]" @scroll.passive="captureReflow"><template v-if="book?.format === 'epub'"><AppState v-if="!frame" class="reader-initial-loading" kind="loading" title="Abrindo capítulo…" /><iframe v-for="(source, slot) in frameSources" :key="slot" class="epub-stage" :class="{ 'epub-stage--preparing': slot !== activeFrame }" :srcdoc="source" :aria-hidden="slot !== activeFrame" :tabindex="slot === activeFrame ? 0 : -1" title="Conteúdo do EPUB" sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox" @load="prepareFrame($event, slot)" /></template><ReaderTextContent v-else-if="readerMode === 'reflow'" :blocks="reflowBlocks" :loading="reflowLoading" :theme="readerTheme" :content-style="reflowStyle" :visual-src="reflowVisualSrc" :figures="reflowFigures" :image-url="`/api/v1/books/${id}/pdf/page-image?page=${currentPage}`" /><div v-else ref="pdfSpread" class="pdf-spread" :class="{ 'pdf-spread--pinching': pinchScale !== 1 }" :style="pinchScale !== 1 ? { transform: `scale(${pinchScale})`, transformOrigin: `${pinchOrigin.x}px ${pinchOrigin.y}px` } : undefined" role="group" :aria-label="readerPosition" /></main>
    </template>
  </div>
</template>

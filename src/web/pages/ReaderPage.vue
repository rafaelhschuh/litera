<script setup lang="ts">
/* eslint-disable no-undef */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import AppState from '../components/AppState.vue'
import ReaderTextContent from '../components/ReaderTextContent.vue'
import ReaderSettings from '../components/ReaderSettings.vue'
import UiDialog from '../components/UiDialog.vue'
import UiIcon from '../components/UiIcon.vue'
import { api } from '../lib/api'
import { resolveProgressConflict, syncState } from '../lib/offline-sync'
import { openBookSource, type BookSource, type SourceView } from '../lib/book-source'
import { attachReaderInput } from '../lib/reader-input'
import { ReaderPreparation } from '../lib/reader-preparation'
import type { EpubAppearance } from '../../shared/epub-document'
import { applyReaderTheme, applyTheme } from '../lib/theme'
import { fitPdfScale, movePdfSpread, pdfSpreadPages, RenderGeneration, resolvePdfReaderMode, usesTwoPageSpread, usesTwoPageSpreadAtZoom, type PdfReaderMode, type PdfZoomMode } from '../../shared/pdf-reader'
import { pdfTextSignature, type PdfReflowBlock, type PdfReflowFigure } from '../../shared/pdf-reflow'
import { readerCapabilities, readerTapZone } from '../../shared/reader'
import type { EpubLocator, PdfLocator, ReadingLocator } from '../../shared/progress'
import type { ReaderInteractionMode } from '../../shared/reader-interaction'
import { readerTextNodes, selectionAnchor, rangeAtTextOffset, visibleTextOffset } from '../lib/reader-text'
import { anchoredHighlightRanges, findTextHighlightRanges } from '../../shared/text-highlights'

type Book = { id: number; title: string; format: 'epub' | 'pdf' }
type Chapter = { id: string; href: string; label: string }
type Highlight = { id: number; quoteText: string; locator: ReadingLocator; chapter?: string; pageNumber?: number }
type Save = { format: 'epub' | 'pdf'; progressRatio: number; locator: ReadingLocator }
type Panel = 'toc' | 'settings' | 'search'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const shell = ref<HTMLElement>(), stage = ref<HTMLElement>(), frame = ref<HTMLIFrameElement>()
const pdfSpread = ref<HTMLElement>()
const book = ref<Book>(), state = ref<'loading' | 'ready' | 'error'>('loading'), message = ref(''), syncMessage = ref('')
const readerNotice = computed(() => syncMessage.value || (syncState.online ? syncState.message : ''))
const hasProgressConflict = computed(() => syncState.conflicts.some(conflict => conflict.bookId === id && conflict.kind === 'progress'))
const resolvingConflict = ref(false)
const toc = ref<Chapter[]>([]), currentChapter = ref(0), epubRatio = ref(0), frameSources = ref(['', '']), activeFrame = ref(0), epubBusy = ref(false)
const epubFlow = ref<'scroll' | 'paginated'>('scroll'), epubScreen = ref(1), epubScreens = ref(1)
const epubAtStart = ref(true), epubAtEnd = ref(false)
const currentPage = ref(1), pageCount = ref(0), readerMode = ref<PdfReaderMode>('visual')
const reflowFigures = ref<PdfReflowFigure[]>([])
const reflowAssetResolver = ref<((url: string) => string)>()
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
watch([book, readerMode, readerTheme], () => {
  applyReaderTheme(book.value ? (book.value.format === 'pdf' && readerMode.value === 'visual' ? 'original' : readerTheme.value) : undefined)
})
const activePdfPages = computed(() => pdfSpreadPages(currentPage.value, pageCount.value, twoPage.value && readerMode.value === 'visual'))
const pageRatio = computed(() => pageCount.value > 1 ? (currentPage.value - 1) / (pageCount.value - 1) : 0)
const readerRatio = computed(() => book.value?.format === 'pdf' ? pageRatio.value : epubRatio.value)
const canMovePrevious = computed(() => book.value?.format === 'pdf' ? (currentPage.value > 1 || (readerMode.value === 'reflow' && !reflowAtStart.value)) : (currentChapter.value > 0 || !epubAtStart.value))
const canMoveNext = computed(() => book.value?.format === 'pdf' ? (currentPage.value < pageCount.value || (readerMode.value === 'reflow' && !reflowAtEnd.value)) : (currentChapter.value < toc.value.length - 1 || !epubAtEnd.value))
const readerPosition = computed(() => {
  if (book.value?.format !== 'pdf') { const chapter = `Capítulo ${currentChapter.value + 1} de ${toc.value.length}`; return epubFlow.value === 'paginated' ? `${chapter} · Página ${epubScreen.value} de ${epubScreens.value}` : chapter }
  const pages = activePdfPages.value
  return pages.length > 1 ? `Páginas ${pages[0]}–${pages[1]} de ${pageCount.value}` : `Página ${currentPage.value} de ${pageCount.value}`
})
const reflowStyle = computed(() => ({ fontSize: `${18 * textScale.value / 100}px`, lineHeight: ({ compact: 1.45, normal: 1.65, relaxed: 1.85 })[lineHeight.value], '--reader-measure': ({ narrow: '42rem', normal: '56rem', wide: '72rem' })[margins.value] }))
const debug = import.meta.env.DEV && route.query.readerDebug === 'true'

let revision: number | undefined, chromeTimer: number | undefined
const layoutChanging = ref(false)
let layoutGeneration = 0
let layoutTimer: number | undefined
let layoutSize = { width: 0, height: 0 }
let viewportFrame = 0, selectionFrame = 0, fallbackReady: (() => void) | undefined
let frameInputCleanup: (() => void) | undefined, frameEventCleanup: (() => void) | undefined, stageInputCleanup: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined, pdfjs: any, pdf: any, pdfTextLayers: any[] = []
let bookSource: BookSource | undefined
const epubViews: Array<SourceView<string> | undefined> = [undefined, undefined]
let reflowView: SourceView<unknown> | undefined
type PreparedPdf = { value: { canvas: HTMLCanvasElement; viewport: any; text: any; page: any }; release: () => void }
const preparedEpub = new ReaderPreparation<SourceView<string>>()
const preparedReflow = new ReaderPreparation<Awaited<ReturnType<BookSource['reflow']>>>()
const preparedPdf = new ReaderPreparation<PreparedPdf>()
let visiblePdf: PreparedPdf[] = [], preparationTimer: number | undefined
let presentationAnimations: Animation[] = []
let incomingPresentation: HTMLElement | undefined
let presentationViewport: HTMLElement | undefined
let presentationCss: string | undefined
let pdfLoading: Promise<void> | undefined, pdfLoadingTask: any
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
    revision = result.progress.revision; log('progress-save', { revision, locator: value.locator })
  } catch (error) {
    syncMessage.value = errorMessage(error)
  }
}
// api persists locally immediately; the global sync coordinator owns batching,
// retries and conflicts. Do not debounce the durable write in the reader.
function queue(value: Save) {
  if (restoring || unmounting) return
  try { bookSource?.assertCurrent(); void saveProgress(value) }
  catch (error) { syncMessage.value = errorMessage(error) }
}
async function useServerPosition() {
  if (resolvingConflict.value) return
  const wasRestoring = restoring
  // pagehide/scroll must not enqueue the old locator after accepting the server.
  restoring = true
  resolvingConflict.value = true
  try {
    await resolveProgressConflict(id, 'server')
    const query = { ...route.query }; delete query.highlight; delete query.mode
    window.location.replace(router.resolve({ query }).href)
  } catch (error) { restoring = wasRestoring; syncMessage.value = errorMessage(error) }
  finally { resolvingConflict.value = false }
}

function scheduleChrome() {
  clearTimeout(chromeTimer)
  if (panel.value || selectedQuote.value || interactionMode.value !== 'idle') { chrome.value = 'locked'; return }
  chrome.value = 'visible'; chromeTimer = window.setTimeout(() => { chrome.value = 'hidden' }, 2800)
}
function showChrome(lock = false) { clearTimeout(chromeTimer); chrome.value = lock ? 'locked' : 'visible'; if (!lock) scheduleChrome() }
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
function epubPages(document: Document) { return document.querySelector<HTMLElement>('.reader-pages') }
function epubPosition(document: Document) {
  const items = elements(document), view = document.defaultView, height = view?.innerHeight ?? 1
  let index = items.findIndex(item => item.getBoundingClientRect().bottom > Math.min(48, height * .1)); if (index < 0) index = Math.max(0, items.length - 1)
  const pages = epubPages(document), scrollY = pages ? pages.scrollLeft : view?.scrollY ?? 0
  const max = pages ? Math.max(0, pages.scrollWidth - pages.clientWidth) : Math.max(0, document.documentElement.scrollHeight - height)
  if (pages) {
    epubScreens.value = Math.max(1, Math.ceil((pages.scrollWidth - 1) / pages.clientWidth))
    epubScreen.value = Math.min(epubScreens.value, Math.round(pages.scrollLeft / pages.clientWidth) + 1)
  }
  epubAtStart.value = scrollY <= 2; epubAtEnd.value = scrollY >= max - 2
  const within = Math.min(1, Math.max(0, scrollY / Math.max(1, max))), count = Math.max(1, toc.value.length), chapter = toc.value[currentChapter.value]
  const item = items[index]
  const locator: EpubLocator = { type: 'epub-cfi', cfi: `epubcfi(/6/${(currentChapter.value + 1) * 2}!/4/${(index + 1) * 2})`, chapterHref: chapter?.href, elementIndex: index, offset: item ? Math.round(-item.getBoundingClientRect().top) : 0, ...(pages ? { textOffset: visibleTextOffset(document.querySelector<HTMLElement>('.reader-document')!) } : {}) }
  return { locator, ratio: Math.min(1, (currentChapter.value + within) / count) }
}
function captureEpub(document = frame.value?.contentDocument ?? undefined, save = true) {
  if (!document || epubBusy.value || layoutChanging.value) return pendingLocator
  const position = epubPosition(document); pendingLocator = position.locator; epubRatio.value = position.ratio
  if (save) queue({ format: 'epub', progressRatio: position.ratio, locator: position.locator }); return position.locator
}
function restoreEpub(document: Document, locator?: EpubLocator) {
  const view = document.defaultView!, pages = epubPages(document), root = document.querySelector<HTMLElement>('.reader-document')!
  const items = elements(document), cfiIndex = Number(locator?.cfi.match(/!\/4\/(\d+)/)?.[1])
  const index = Number.isInteger(locator?.elementIndex) ? locator!.elementIndex! : Number.isFinite(cfiIndex) ? Math.max(0, Math.floor(cfiIndex / 2) - 1) : 0
  const target = items[Math.min(items.length - 1, Math.max(0, index))]
  const anchorOffset = locator?.textAnchor?.scope === 'epub' ? locator.textAnchor.start : locator?.textOffset
  const textRange = anchorOffset !== undefined ? rangeAtTextOffset(root, anchorOffset) : undefined
  const rect = textRange?.getBoundingClientRect() ?? target?.getBoundingClientRect()
  if (pages) {
    const left = rect ? rect.left + pages.scrollLeft : 0
    pages.scrollLeft = Math.floor(Math.max(0, left) / pages.clientWidth) * pages.clientWidth
    if (pendingChapterEnd) pages.scrollLeft = pages.scrollWidth
  } else if (locator) {
    // Scroll only the document; scrollIntoView also scrolls the iframe's ancestors.
    if (anchorOffset !== undefined && rect) view.scrollTo(0, rect.top + view.scrollY - 80)
    else if (index === 0 && !locator.offset) view.scrollTo(0, 0)
    else if (rect) view.scrollTo(0, rect.top + view.scrollY + (locator.offset ?? 0))
  }
  if (!pages && pendingChapterEnd) view.scrollTo(0, document.documentElement.scrollHeight)
  if (pendingAnchor) {
    const target = document.getElementById(decodeURIComponent(pendingAnchor))
    if (target) {
      const rect = target.getBoundingClientRect()
      if (pages) pages.scrollLeft = Math.floor(Math.max(0, rect.left + pages.scrollLeft) / pages.clientWidth) * pages.clientWidth
      else view.scrollTo(0, rect.top + view.scrollY)
    }
    pendingAnchor = ''
  }
  resetStageScroll()
}

function epubAppearance(): EpubAppearance { return { flow: epubFlow.value, fontScale: textScale.value, theme: readerTheme.value, lineHeight: lineHeight.value, margins: margins.value } }
function chapterUrl(index: number) { return `/api/v1/books/${id}/epub/chapter?href=${encodeURIComponent(toc.value[index]!.href)}` }
function chapterKey(index: number) { return chapterUrl(index) + JSON.stringify(epubAppearance()) }
function pdfKey(page: number, scale = zoom.value) { return `${page}:${scale.toFixed(6)}:${devicePixelRatio || 1}` }
function releasePreparation() {
  clearTimeout(preparationTimer); preparedEpub.clear(); preparedReflow.clear(); preparedPdf.clear()
}
function warmView<T>(view: SourceView<T>, html: string, signal: AbortSignal): SourceView<T> {
  const controller = new AbortController(), cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const timeout = window.setTimeout(cancel, 5000)
  void bookSource!.warmResources(html, controller.signal).catch(() => undefined).finally(() => clearTimeout(timeout))
  return { ...view, release: () => { cancel(); signal.removeEventListener('abort', cancel); clearTimeout(timeout); view.release() } }
}
function prepareNeighbors() {
  clearTimeout(preparationTimer)
  // Let visible content settle before spending CPU/IO on optional neighbors.
  preparationTimer = window.setTimeout(() => {
    if (unmounting || epubBusy.value || reflowLoading.value || layoutChanging.value) return
    if (book.value?.format === 'epub') {
      const neighbors = [currentChapter.value + 1, currentChapter.value - 1].filter(index => index >= 0 && index < toc.value.length)
      preparedEpub.retain(neighbors.map(chapterKey))
      for (const index of neighbors) {
        const preferences = epubAppearance(), key = chapterKey(index), url = chapterUrl(index)
        preparedEpub.warm(key, async signal => { const view = await bookSource!.chapterHtml(url, preferences, signal); return warmView(view, view.value, signal) })
      }
    } else if (readerMode.value === 'reflow') {
      const neighbors = [currentPage.value + 1, currentPage.value - 1].filter(page => page > 0 && page <= pageCount.value)
      preparedReflow.retain(neighbors.map(String))
      for (const page of neighbors) preparedReflow.warm(String(page), async signal => {
        const view = await bookSource!.reflow(page, signal)
        const assets = new Set([...(view.value.figures ?? []).map(item => item.asset), ...view.value.blocks.flatMap(block => block.spans.map(span => span.fontAsset))])
        const html = [...assets].filter(Boolean).map(asset => `<img src="/api/v1/books/${id}/pdf/figure?asset=${encodeURIComponent(asset!)}">`).join('')
        return warmView(view, html, signal)
      })
    } else if (pdf) {
      const pages = activePdfPages.value, scale = zoom.value
      const neighbors = [pages[pages.length - 1]! + 1, pages[0]! - 1].filter(page => page > 0 && page <= pageCount.value)
      preparedPdf.retain(neighbors.map(page => pdfKey(page, scale)))
      for (const page of neighbors) preparedPdf.warm(pdfKey(page, scale), signal => preparePdfPage(page, scale, signal, true))
    }
  }, 180)
}

async function displayEpub(locator?: EpubLocator, saveAfter = true, atEnd = false) {
  const chapter = toc.value[currentChapter.value]; if (!chapter) return
  const generation = ++epubGeneration
  snapshotEpub(); epubAbort?.abort(); epubAbort = new AbortController(); epubBusy.value = true
  pendingLocator = locator ?? { type: 'epub-cfi', cfi: `epubcfi(/6/${(currentChapter.value + 1) * 2}!/4/2)`, chapterHref: chapter.href, elementIndex: 0, offset: 0 }
  saveAfterFrameLoad = saveAfter; pendingChapterEnd = atEnd
  const url = chapterUrl(currentChapter.value), key = chapterKey(currentChapter.value)
  try {
    bookSource!.assertCurrent()
    const cached = preparedEpub.take(key)
    const load = () => bookSource!.chapterHtml(url, epubAppearance(), epubAbort!.signal)
    const view = await (cached ? cached.catch(load) : load())
    bookSource!.assertCurrent()
    if (generation !== epubGeneration || unmounting) { view.release(); return }
    const slot = 1 - activeFrame.value
    epubViews[slot]?.release(); epubViews[slot] = view
    frameGenerations[slot] = generation
    frameSources.value[slot] = view.value
    log('epub-render-begin', { generation, chapter: currentChapter.value })
  } catch (error) {
    if (generation !== epubGeneration || unmounting) return
    epubBusy.value = false; clearPresentation(); turnDirection.value = ''; syncMessage.value = errorMessage(error); pendingAnchor = ''
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
  await Promise.all([...doc.images].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve() })))
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
  if (raw.startsWith('#')) { pendingAnchor = raw.slice(1); restoreEpub(document, pendingLocator); captureEpub(document); return }
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
    const range = selection.getRangeAt(0)
    const anchorElement = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement
    const textRoot = (format === 'epub' ? root : readerMode.value === 'visual' ? anchorElement?.closest('.textLayer') : root) as HTMLElement | undefined
    const textAnchor = textRoot ? selectionAnchor(textRoot, range, format === 'epub' ? 'epub' : readerMode.value === 'reflow' ? 'pdf-reflow' : 'pdf-page') : undefined
    if (!textAnchor) { selectedQuote.value = ''; selectedLocator.value = undefined; return }
    selectedQuote.value = quote.slice(0, 10000)
    if (format === 'epub') {
      const items = elements(document), anchor = anchorElement
      const selected = anchor?.closest('h1,h2,h3,h4,h5,h6,p,li,blockquote,figure') as HTMLElement | null, index = Math.max(0, selected ? items.indexOf(selected) : 0), chapter = toc.value[currentChapter.value]
      selectedLocator.value = { type: 'epub-cfi', cfi: `epubcfi(/6/${(currentChapter.value + 1) * 2}!/4/${(index + 1) * 2})`, chapterHref: chapter?.href, elementIndex: index, textAnchor }
    } else {
      const anchor = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode as Element : selection?.anchorNode?.parentElement
      const selectedPage = Number(anchor?.closest<HTMLElement>('.pdf-page')?.dataset.page || currentPage.value)
      selectedLocator.value = { type: readerMode.value === 'reflow' ? 'pdf-reflow' : 'pdf-page', page: selectedPage, textAnchor }
    }
    setMode('selecting'); showChrome(true)
  })
}
async function attachFrame() {
  frameInputCleanup?.(); frameEventCleanup?.(); const document = frame.value?.contentDocument; if (!document?.querySelector('.reader-document')) return
  const generation = epubGeneration
  const selection = () => updateSelection(document, 'epub', document.querySelector<HTMLElement>('.reader-document')!), scroll = () => { captureEpub(document) }
  const click = (event: MouseEvent) => handleLink(event, document), key = (event: KeyboardEvent) => onKey(event)
  document.addEventListener('selectionchange', selection); document.addEventListener('scroll', scroll, { passive: true, capture: true }); document.addEventListener('click', click); document.addEventListener('keydown', key)
  frameEventCleanup = () => { document.removeEventListener('selectionchange', selection); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click); document.removeEventListener('keydown', key) }
  frameInputCleanup = attachReaderInput(document, { onEvent: debug ? event => log(event) : undefined, width: () => document.defaultView?.innerWidth ?? innerWidth, selectionText: () => document.defaultView?.getSelection()?.toString() ?? '', canPan: () => false, canSwipe: () => !epubBusy.value && !panel.value, onTap: handleTap, onSwipe: direction => { void move(direction === 'next' ? 1 : -1) }, onModeChange: setMode })
  await document.fonts?.ready; await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (generation !== epubGeneration || unmounting) return; restoreEpub(document, pendingLocator); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (generation !== epubGeneration || unmounting) return; epubBusy.value = false; frameSources.value[1 - activeFrame.value] = ''; applyEpubHighlights(document); captureEpub(document, saveAfterFrameLoad)
  loadedChapter = currentChapter.value; pendingChapterEnd = false; finishPresentation(); prepareNeighbors(); log('epub-render-end', { chapter: currentChapter.value }); fallbackReady?.(); fallbackReady = undefined
  if (reloadPending) { reloadPending = false; reloadEpub() }
}
async function initEpub(saved: any) {
  toc.value = (await bookSource!.manifest()).chapters ?? []; if (!toc.value.length) throw new Error('Este EPUB não contém capítulos legíveis.')
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
async function preparePdfPage(pageNumber: number, scale: number, signal: AbortSignal, neighbor = false): Promise<PreparedPdf> {
  const page = await pdf.getPage(pageNumber)
  if (signal.aborted || unmounting) throw new DOMException('Preparação cancelada.', 'AbortError')
  const viewport = page.getViewport({ scale }), dpr = Math.max(1, Math.min(3, devicePixelRatio || 1))
  const output = Math.min(dpr, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
  // Preserve visible render quality. Oversized neighbors use the ordinary path
  // instead of retaining lower-resolution pixels or an excessive canvas cache.
  if (neighbor && viewport.width * viewport.height * output * output > 4_000_000) throw new RangeError('Página excede o orçamento de preparação.')
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível para o PDF.')
  canvas.className = 'pdf-canvas'; canvas.setAttribute('aria-label', `Página ${pageNumber} do PDF`)
  canvas.width = Math.max(1, Math.floor(viewport.width * output)); canvas.height = Math.max(1, Math.floor(viewport.height * output)); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
  const task = page.render({ canvas, canvasContext: context, viewport, transform: output === 1 ? undefined : [output, 0, 0, output, 0, 0] })
  const cancel = () => task.cancel(), release = () => { canvas.width = 0; canvas.height = 0; page.cleanup?.() }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
    const text = await page.getTextContent()
    bookSource!.assertCurrent()
    if (signal.aborted || unmounting) throw new DOMException('Preparação cancelada.', 'AbortError')
    return { value: { canvas, viewport, text, page }, release }
  } catch (error) { release(); throw error }
  finally { signal.removeEventListener('abort', cancel) }
}
async function renderPdf() {
  if (readerMode.value === 'reflow') return
  await ensurePdf()
  if (!pdf || unmounting || (readerMode.value as PdfReaderMode) === 'reflow') return
  clearTimeout(preparationTimer)
  const requestedPages = activePdfPages.value, controller = new AbortController(), textLayers: any[] = [], prepared: PreparedPdf[] = []
  const generation = renders.begin(() => { controller.abort(); for (const layer of textLayers) layer?.cancel?.() })
  let committed = false
  log('pdf-render-begin', { generation, pages: requestedPages })
  try {
    const pages = await Promise.all(requestedPages.map(pageNumber => pdf.getPage(pageNumber)))
    if (!renders.isCurrent(generation)) return
    const bases = pages.map(page => page.getViewport({ scale: 1 }))
    pdfPageBase = { width: bases[0]!.width, height: bases[0]!.height }
    pdfBase = { width: bases.reduce((total, viewport) => total + viewport.width, 0), height: Math.max(...bases.map(viewport => viewport.height)) }
    fitZoom()
    const scale = zoom.value, fragment = document.createDocumentFragment()
    for (const pageNumber of requestedPages) {
      const cached = preparedPdf.take(pdfKey(pageNumber, scale))
      const load = () => preparePdfPage(pageNumber, scale, controller.signal)
      const view = await (cached ? cached.catch(load) : load()); prepared.push(view)
      if (!renders.isCurrent(generation)) return
      const { canvas, viewport, text } = view.value
      const layer = document.createElement('div'); layer.className = 'textLayer'; layer.dataset.page = String(pageNumber); layer.style.width = `${viewport.width}px`; layer.style.height = `${viewport.height}px`; layer.style.setProperty('--total-scale-factor', String(viewport.scale))
      const wrapper = document.createElement('section'); wrapper.className = `pdf-page${pdfInvert.value ? ' pdf-page--inverted' : ''}`; wrapper.dataset.page = String(pageNumber); wrapper.setAttribute('aria-label', `Página ${pageNumber}`); wrapper.append(canvas, layer); fragment.append(wrapper)
      const textLayer = new pdfjs.TextLayer({ textContentSource: text, container: layer, viewport }); textLayers.push(textLayer)
    }
    if (!renders.isCurrent(generation) || !pdfSpread.value) return
    for (const layer of pdfTextLayers) layer?.cancel?.()
    if (turnDirection.value && !presentation) snapshotPdf()
    pdfSpread.value.replaceChildren(fragment)
    // Text-layer metrics require connected DOM.
    for (const layer of textLayers) { await layer.render(); if (!renders.isCurrent(generation)) return }
    for (const view of visiblePdf) view.release()
    visiblePdf = prepared; committed = true
    pdfTextLayers = textLayers; applyPdfHighlights(); pinchScale.value = 1; await nextTick(); if (!renders.isCurrent(generation) || unmounting) return; restoreZoomAnchor()
    queue({ format: 'pdf', progressRatio: pageRatio.value, locator: { type: 'pdf-page', page: requestedPages[0]! } })
    renders.finish(generation); finishPresentation(); prepareNeighbors(); log('pdf-render-end', { generation, pages: requestedPages, zoom: scale })
  } catch (error: any) {
    if (!['RenderingCancelledException', 'AbortError'].includes(error?.name) && renders.isCurrent(generation)) { clearPresentation(); throw error }
  } finally { if (!committed) for (const view of prepared) view.release() }
}
async function ensurePdf() {
  if (pdf) return
  if (!pdfLoading) {
    pdfLoading = (async () => {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (unmounting) return
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      const input = await bookSource!.pdfInput()
      if (unmounting) return
      const task = pdfjs.getDocument({ ...input, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
      pdfLoadingTask = task
      try {
        const document = await task.promise
        bookSource!.assertCurrent()
        if (unmounting) { await document.destroy(); return }
        pdf = document
      } catch (error) {
        await task.destroy().catch(() => undefined)
        if (pdfLoadingTask === task) pdfLoadingTask = undefined
        throw error
      }
      pageCount.value = pdf.numPages
      currentPage.value = Math.min(pageCount.value, currentPage.value)
    })().finally(() => { pdfLoading = undefined })
  }
  await pdfLoading
}
async function initPdf(saved: any) {
  currentPage.value = Math.max(1, saved?.locator?.page ?? 1); readerMode.value = resolvePdfReaderMode(route.query.mode, saved?.locator?.type); zoomMode.value = innerWidth < 640 ? 'fit-width' : 'fit-page'; twoPage.value = usesTwoPageSpread(innerWidth, innerHeight)
  state.value = 'ready'; await nextTick(); attachStage()
  if (readerMode.value === 'reflow') await loadReflow(saved?.locator)
  else {
    try { await renderPdf() }
    catch (error) {
      log('pdf-visual-fallback', { message: errorMessage(error) })
      readerMode.value = 'reflow'; renders.cancel(); await nextTick(); attachStage(); await loadReflow(saved?.locator)
    }
  }
  restoring = false
}

function clearHighlightMarks(root: ParentNode) {
  for (const mark of [...root.querySelectorAll<HTMLElement>('mark[data-litera-highlight]')]) mark.replaceWith(mark.textContent ?? '')
  // Do not normalize Vue-owned nodes: empty text nodes anchor keyed fragments.
}
function applyHighlightMarks(root: HTMLElement, visibleHighlights: Highlight[], preferredElement?: (highlight: Highlight) => Element | undefined) {
  clearHighlightMarks(root)
  const nodes = readerTextNodes(root), chunks = nodes.map(node => node.data), ranges = new Map<number, Array<{ start: number; end: number; id: number }>>()
  for (const highlight of visibleHighlights) {
    const preferred = preferredElement?.(highlight), preferredChunk = preferred ? nodes.findIndex(node => preferred.contains(node)) : undefined
    const anchor = highlight.locator.textAnchor
    const scope = book.value?.format === 'epub' ? 'epub' : readerMode.value === 'reflow' ? 'pdf-reflow' : 'pdf-page'
    // Old highlights may use quote matching; a precise anchor never falls back to guessing.
    const matches = anchor ? (anchor.scope === scope ? anchoredHighlightRanges(chunks, anchor) : []) : findTextHighlightRanges(chunks, highlight.quoteText, preferredChunk !== undefined && preferredChunk >= 0 ? preferredChunk : undefined)
    for (const range of matches) {
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
  applyHighlightMarks(document.querySelector<HTMLElement>('.reader-document')!, visible, highlight => items[(highlight.locator as EpubLocator).elementIndex ?? -1])
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
function resetStageScroll() { if (stage.value) { stage.value.scrollLeft = 0; stage.value.scrollTop = 0; if (presentation && book.value?.format === 'pdf') { presentation.style.top = '0'; presentation.style.left = '0' } } }
function attachStage() {
  stageInputCleanup?.(); if (!stage.value) return
  stageInputCleanup = attachReaderInput(stage.value, { onEvent: debug ? event => log(event) : undefined, width: () => stage.value?.clientWidth ?? innerWidth, selectionText: () => getSelection()?.toString() ?? '', canPan: needsPan, canSwipe: () => !reflowLoading.value && !panel.value && (readerMode.value === 'reflow' || zoomMode.value !== 'manual'), onTap: handleTap, onSwipe: direction => { void move(direction === 'next' ? 1 : -1) }, onPinchStart: startPinch, onPinchChange: changePinch, onPinchEnd: endPinch, onMousePan: (x, y) => { if (stage.value) { stage.value.scrollLeft += x; stage.value.scrollTop += y } }, onModeChange: setMode })
}

async function safely(action: () => Promise<void>) { try { await action() } catch (error) { syncMessage.value = errorMessage(error); log('error', { operation: action.name, message: syncMessage.value }) } }
function snapshotEpub(replace = true) {
  if (replace) { clearPresentation(); if (!turnDirection.value || skipPresentation()) return }
  const doc = frame.value?.contentDocument
  if (!doc?.body || !stage.value) return
  const snapshot = document.createElement('div'); snapshot.className = 'reader-presentation'; snapshot.setAttribute('aria-hidden', 'true')
  const shadow = snapshot.attachShadow({ mode: 'open' })
  for (const style of doc.head.querySelectorAll('style,link[rel="stylesheet"]')) shadow.append(style.cloneNode(true))
  const body = document.createElement('div'); body.style.cssText = `background:${getComputedStyle(doc.body).backgroundColor};color:${getComputedStyle(doc.body).color};position:relative;top:-${doc.defaultView?.scrollY ?? 0}px;min-height:100%`
  for (const child of doc.body.childNodes) body.append(child.cloneNode(true))
  shadow.append(body); stage.value.append(snapshot); if (replace) presentation = snapshot
  const pages = shadow.querySelector<HTMLElement>('.reader-pages'); if (pages) pages.scrollLeft = epubPages(doc)?.scrollLeft ?? 0
  return snapshot
}
function snapshotPdf(replace = true) {
  const container = stage.value
  if (!container || !pdfSpread.value?.children.length) return
  if (replace) { clearPresentation(); if (!turnDirection.value || skipPresentation()) return }
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
  snapshot.append(canvas); container.append(snapshot); if (replace) presentation = snapshot
  return snapshot
}
function snapshotReflow(replace = true) {
  const container = stage.value, content = container?.querySelector('.reader-text-surface')
  if (!container || !content) return
  if (replace) { clearPresentation(); if (!turnDirection.value || skipPresentation()) return }
  const snapshot = document.createElement('div'); snapshot.className = 'reader-presentation reader-presentation--reflow'; snapshot.setAttribute('aria-hidden', 'true')
  snapshot.style.top = `${container.scrollTop}px`; snapshot.style.height = `${container.clientHeight}px`
  const shadow = snapshot.attachShadow({ mode: 'open' }), styles = document.createElement('style')
  if (presentationCss === undefined) {
    presentationCss = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText) } catch { return [] } }).join('\n').replaceAll('.reader-document', '.presentation-document')
  }
  styles.textContent = presentationCss + '\n.presentation-document{column-count:1!important;column-width:auto!important}'; shadow.append(styles)
  const clone = content.cloneNode(true) as HTMLElement
  // Presentation has no reader identity: only the live DOM participates in
  // coverage checks, selection, locators and highlighting.
  for (const element of clone.querySelectorAll('[class]')) for (const name of [...element.classList]) if (name.startsWith('reader-document')) element.classList.replace(name, name.replace('reader-document', 'presentation-document'))
  for (const block of clone.querySelectorAll('[data-reflow-block]')) block.removeAttribute('data-reflow-block')
  for (const image of clone.querySelectorAll('img')) image.removeAttribute('alt')
  for (const mark of clone.querySelectorAll<HTMLElement>('mark')) { mark.style.backgroundColor = 'var(--reader-highlight)'; mark.removeAttribute('data-litera-highlight'); mark.removeAttribute('data-highlight-id') }
  clone.style.position = 'relative'; clone.style.top = `-${container.scrollTop}px`
  shadow.append(clone); container.append(snapshot); if (replace) presentation = snapshot
  return snapshot
}
function skipPresentation() { return reducedMotion.value || matchMedia('(prefers-reduced-motion: reduce)').matches || !stage.value?.animate || typeof stage.value.attachShadow !== 'function' }
function clearPresentation() {
  for (const animation of presentationAnimations) animation.cancel()
  presentationAnimations = []; presentation?.remove(); incomingPresentation?.remove(); presentationViewport?.remove(); presentation = undefined; incomingPresentation = undefined; presentationViewport = undefined
}
function finishPresentation() {
  const outgoing = presentation, direction = turnDirection.value; turnDirection.value = ''
  if (!outgoing) return
  if (!direction || skipPresentation() || !outgoing.animate) { clearPresentation(); return }
  // Slide two disposable surfaces. The live iframe and its locators never move.
  const incoming = book.value?.format === 'epub' ? snapshotEpub(false) : readerMode.value === 'reflow' ? snapshotReflow(false) : snapshotPdf(false)
  if (!incoming) { clearPresentation(); return }
  incomingPresentation = incoming
  if (book.value?.format === 'pdf' && stage.value) { outgoing.style.top = `${stage.value.scrollTop}px`; outgoing.style.left = `${stage.value.scrollLeft}px` }
  const bounds = outgoing.getBoundingClientRect(), width = bounds.width, sign = direction === 'prev' ? -1 : 1
  // Clip moving snapshots together so animation cannot create horizontal scroll.
  const viewport = document.createElement('div'); viewport.className = 'reader-transition'; viewport.setAttribute('aria-hidden', 'true')
  viewport.style.cssText = `top:${outgoing.offsetTop}px;left:${outgoing.offsetLeft}px;width:${width}px;height:${bounds.height}px`
  for (const surface of [outgoing, incoming]) { surface.style.inset = '0'; surface.style.width = '100%'; surface.style.height = '100%'; viewport.append(surface) }
  stage.value!.append(viewport); presentationViewport = viewport
  const tokens = getComputedStyle(document.documentElement), motion = tokens.getPropertyValue('--motion-slow').trim()
  const duration = parseFloat(motion) * (motion.endsWith('ms') ? 1 : 1000) || 240
  const options = { duration, easing: tokens.getPropertyValue('--ease-standard').trim() || 'ease-out', fill: 'both' as FillMode }
  const animations = [
    outgoing.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-sign * width}px)` }], options),
    incoming.animate([{ transform: `translateX(${sign * width}px)` }, { transform: 'translateX(0)' }], options),
  ]
  presentationAnimations = animations
  const cleanup = () => { viewport.remove(); if (presentation === outgoing) { presentation = undefined; incomingPresentation = undefined; presentationViewport = undefined; presentationAnimations = [] } }
  void Promise.all(animations.map(animation => animation.finished)).then(cleanup, cleanup)
}
async function move(delta: number) {
  if (layoutChanging.value) { queuedNavigation = delta; return }
  if (frame.value?.contentWindow?.getSelection()?.toString().trim() || getSelection()?.toString().trim()) return
  if (restoring || epubBusy.value || reflowLoading.value || !book.value || selectedQuote.value || panel.value || ['pinching', 'panning'].includes(interactionMode.value)) return
  turnDirection.value = delta > 0 ? 'next' : 'prev'
  if (book.value.format === 'epub') {
    const doc = frame.value?.contentDocument, view = doc?.defaultView
    if (doc && view) {
      const pages = epubPages(doc)
      if (pages) {
        const maximum = Math.max(0, pages.scrollWidth - pages.clientWidth)
        if ((delta > 0 && pages.scrollLeft < maximum - 2) || (delta < 0 && pages.scrollLeft > 2)) {
          snapshotEpub()
          pages.scrollLeft = Math.min(maximum, Math.max(0, (Math.round(pages.scrollLeft / pages.clientWidth) + delta) * pages.clientWidth))
          captureEpub(); finishPresentation(); return
        }
      }
      const maximum = pages ? 0 : Math.max(0, doc.documentElement.scrollHeight - view.innerHeight)
      if (!pages && ((delta > 0 && view.scrollY < maximum - 2) || (delta < 0 && view.scrollY > 2))) {
        snapshotEpub(); view.scrollBy(0, delta * Math.max(1, view.innerHeight - 48)); captureEpub(); finishPresentation(); return
      }
    }
    const next = Math.min(toc.value.length - 1, Math.max(0, currentChapter.value + delta)); if (next === currentChapter.value) { turnDirection.value = ''; return }; captureEpub(); currentChapter.value = next; displayEpub(undefined, true, delta < 0) }
  else if (readerMode.value === 'reflow' && stage.value) {
    const container = stage.value, maximum = Math.max(0, container.scrollHeight - container.clientHeight)
    if ((delta > 0 && container.scrollTop < maximum - 2) || (delta < 0 && container.scrollTop > 2)) {
      snapshotReflow()
      container.scrollTop = Math.max(0, Math.min(maximum, container.scrollTop + delta * Math.max(1, container.clientHeight - 48)))
      captureReflow(); finishPresentation(); return
    }
    const next = Math.min(pageCount.value, Math.max(1, currentPage.value + delta))
    if (next === currentPage.value) { turnDirection.value = ''; return }
    currentPage.value = next
    await safely(() => loadReflow(undefined, delta < 0))
  }
  else { const next = readerMode.value === 'visual' ? movePdfSpread(currentPage.value, pageCount.value, delta, twoPage.value) : Math.min(pageCount.value, Math.max(1, currentPage.value + delta)); if (next === currentPage.value) { turnDirection.value = ''; return }; snapshotPdf(); currentPage.value = next; resetStageScroll(); if (readerMode.value === 'reflow') await safely(loadReflow); else await safely(renderPdf) }
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
  const previous = { locator: reflowLocator, blocks: reflowBlocks.value, figures: reflowFigures.value, view: reflowView, resolver: reflowAssetResolver.value }
  let incoming: SourceView<unknown> | undefined
  let committed = false
  if (turnDirection.value) snapshotReflow()
  reflowLoading.value = true
  try {
    bookSource!.assertCurrent()
    const cached = preparedReflow.take(String(requestedPage))
    const view = await (cached ? cached.catch(() => bookSource!.reflow(requestedPage)) : bookSource!.reflow(requestedPage))
    bookSource!.assertCurrent()
    incoming = view
    const result = view.value
    if (generation !== reflowGeneration || unmounting) return
    reflowAssetResolver.value = view.resolve
    reflowBlocks.value = result.blocks; reflowFigures.value = result.figures ?? []; pageCount.value = result.pageCount; currentPage.value = result.page
    await nextTick()
    if (generation !== reflowGeneration) return
    const rendered = [...(stage.value?.querySelectorAll('.reader-document h1,.reader-document h2,.reader-document p:not(.reader-text-status)') ?? [])].map(node => node.textContent).join('')
    const expected = result.blocks.flatMap((block: PdfReflowBlock) => block.spans.map(span => span.text)).join('')
    if (pdfTextSignature(rendered) !== pdfTextSignature(expected)) throw new Error('Não foi possível exibir o texto completo. Tente abrir a página novamente.')
    applyReflowHighlights()
    if (generation !== reflowGeneration) return
    await Promise.all([...(stage.value?.querySelectorAll<HTMLImageElement>('.reader-document img') ?? [])].map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve() })))
    if (generation !== reflowGeneration) return
    await document.fonts?.ready
    if (generation !== reflowGeneration) return
    restoreReflow(locator)
    if (atEnd && stage.value) stage.value.scrollTop = stage.value.scrollHeight
    reflowView = view; previous.view?.release()
    committed = true
    finishPresentation(); prepareNeighbors()
    log('adaptation', { page: requestedPage, adaptation: result.adaptation, visualReference: false })
  } catch (error) {
    if (generation === reflowGeneration && !unmounting) {
      currentPage.value = previous.locator?.page ?? requestedPage; reflowBlocks.value = previous.blocks; reflowFigures.value = previous.figures; reflowAssetResolver.value = previous.resolver
      await nextTick(); restoreReflow(previous.locator)
    }
    clearPresentation(); turnDirection.value = ''; throw error
  } finally { if (!committed) incoming?.release(); if (generation === reflowGeneration) { reflowLoading.value = false; if (committed) captureReflow() } }
}
async function togglePdfMode() {
  captureReflow()
  readerMode.value = readerMode.value === 'visual' ? 'reflow' : 'visual'
  void router.replace({ query: { ...route.query, mode: readerMode.value === 'reflow' ? 'epub' : 'pdf' } })
  releasePreparation(); clearPresentation(); closePanel(false); renders.cancel(); reflowGeneration++; reflowLoading.value = false
  reflowBlocks.value = []; reflowFigures.value = []; reflowAssetResolver.value = undefined
  resetStageScroll(); await nextTick()
  if (readerMode.value === 'reflow') { for (const view of visiblePdf) view.release(); visiblePdf = []; for (const layer of pdfTextLayers) layer?.cancel?.(); pdfTextLayers = [] }
  // The old adapted DOM is gone, so its images/fonts no longer need their URLs.
  reflowView?.release(); reflowView = undefined
  if (unmounting) return
  attachStage()
  if (readerMode.value === 'reflow') await safely(() => loadReflow(reflowLocator?.page === currentPage.value ? reflowLocator : undefined))
  else await safely(renderPdf)
}
async function adjustZoom(delta: number) { const container = stage.value; if (container) { const rect = container.getBoundingClientRect(); captureZoomAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) } zoomMode.value = 'manual'; zoom.value = Math.min(4, Math.max(.25, zoom.value + delta)); twoPage.value = twoPagesFitAtZoom(); await safely(renderPdf) }
async function setZoomMode(mode: 'fit-width' | 'fit-page') { zoomMode.value = mode; twoPage.value = usesTwoPageSpread(innerWidth, innerHeight); zoomAnchor = undefined; resetStageScroll(); await safely(renderPdf) }
async function setEpubFlow(flow: 'scroll' | 'paginated') {
  if (flow === epubFlow.value || epubBusy.value) return
  const locator = captureEpub(undefined, true), root = frame.value?.contentDocument?.querySelector<HTMLElement>('.reader-document')
  if (locator && root && epubFlow.value === 'scroll') locator.textOffset = visibleTextOffset(root)
  epubFlow.value = flow
  await displayEpub(locator, true); await persistSettings()
}
function reloadEpub() { if (epubBusy.value) { reloadPending = true; return }; displayEpub(captureEpub(undefined, true), true) }
async function adjustText(delta: number) { captureReflow(); textScale.value = Math.min(140, Math.max(80, textScale.value + delta)); if (book.value?.format === 'epub') reloadEpub(); else if (readerMode.value === 'reflow') { await nextTick(); restoreReflow(reflowLocator); captureReflow() } await persistSettings() }
async function changeSetting() { if (book.value?.format === 'epub') reloadEpub(); else if (readerMode.value === 'reflow') { await nextTick(); restoreReflow(reflowLocator); captureReflow() } await persistSettings() }
function setTheme(theme: 'light' | 'sepia' | 'dark') { readerTheme.value = theme; if (book.value?.format === 'epub') reloadEpub(); void persistSettings() }
function setToolbarPosition(position: 'top' | 'bottom') { toolbarPosition.value = position; try { localStorage.setItem('litera-reader-toolbar-position', position) } catch { /* Optional preference: storage denial must not stop reading. */ }; showChrome() }
async function persistSettings() {
  try { await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify({ theme: readerTheme.value, fontScale: textScale.value, lineHeight: lineHeight.value, margins: margins.value, appTheme: appTheme.value, reducedMotion: reducedMotion.value, pdfInvert: pdfInvert.value, epubFlow: epubFlow.value }) }) }
  catch (error) { syncMessage.value = errorMessage(error) }
}
function clearSelection() { selectedQuote.value = ''; selectedLocator.value = undefined; getSelection()?.removeAllRanges(); frame.value?.contentWindow?.getSelection()?.removeAllRanges(); setMode('idle'); showChrome() }
async function saveHighlight() {
  if (!selectedQuote.value || !selectedLocator.value || !book.value) return; savingHighlight.value = true
  try { const chapterHref = selectedLocator.value.type === 'epub-cfi' ? selectedLocator.value.chapterHref : undefined, chapter = toc.value.find(item => item.href === chapterHref)?.label, selectedPage = selectedLocator.value.type === 'pdf-page' || selectedLocator.value.type === 'pdf-reflow' ? selectedLocator.value.page : currentPage.value; const result = await api<any>(`/api/v1/books/${id}/highlights`, { method: 'POST', body: JSON.stringify({ quoteText: selectedQuote.value, locator: selectedLocator.value, chapter, ...(book.value.format === 'pdf' ? { pageNumber: selectedPage } : {}) }) }); highlights.value.unshift(result.highlight); clearSelection(); if (book.value.format === 'pdf') { if (readerMode.value === 'reflow') applyReflowHighlights(); else applyPdfHighlights() } else if (frame.value?.contentDocument) applyEpubHighlights(frame.value.contentDocument) } catch (error) { syncMessage.value = errorMessage(error) } finally { savingHighlight.value = false }
}
async function searchBook() {
  const query = searchQuery.value.trim(); if (query.length < 2 || !book.value) return; const generation = ++searchGeneration; searching.value = true
  try { if (book.value.format === 'epub') { const result = await bookSource!.searchEpub(query); if (generation === searchGeneration) searchResults.value = result.results } else { await ensurePdf(); if (generation !== searchGeneration || !pdf || unmounting) return; const found = []; for (let number = 1; number <= pageCount.value && found.length < 20 && generation === searchGeneration; number++) { const page = await pdf.getPage(number), content = await page.getTextContent(), text = content.items.map((item: any) => item.str || '').join(' '); if (text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) found.push({ page: number, label: `Página ${number}`, excerpt: text.slice(0, 160) }); page.cleanup?.() } if (generation === searchGeneration) searchResults.value = found } } catch (error) { syncMessage.value = errorMessage(error) } finally { if (generation === searchGeneration) searching.value = false }
}
async function openResult(result: any) { if (book.value?.format === 'epub') await goToc({ id: result.href, href: result.href, label: result.label }); else { currentPage.value = result.page; if (readerMode.value === 'reflow') await safely(loadReflow); else await safely(renderPdf); closePanel() } }

function togglePanel(next: Panel, event?: MouseEvent) {
  if (panel.value === next) { closePanel(); return }
  if (!panel.value) panelTrigger = event?.currentTarget as HTMLElement ?? document.activeElement as HTMLElement
  panel.value = next; showChrome(true)
}
function closePanel(focus = true) {
  const trigger = panelTrigger
  searchGeneration++; searching.value = false; panel.value = null; panelTrigger = undefined; showChrome()
  // The modal makes the toolbar inert until Vue removes the dialog.
  if (focus) void nextTick(() => trigger?.focus())
}
async function toggleFullscreen() { try { if (!document.fullscreenElement) { if (!shell.value?.requestFullscreen) { syncMessage.value = 'Tela cheia não é suportada neste navegador.'; return } await shell.value.requestFullscreen() } else await document.exitFullscreen() } catch { syncMessage.value = 'Não foi possível alternar a tela cheia neste dispositivo.' } }
function onKey(event: KeyboardEvent) {
  if (event.key === 'Tab' && chrome.value === 'hidden' && !panel.value) {
    event.preventDefault(); showChrome(true)
    void nextTick(() => {
      const controls = shell.value?.querySelectorAll<HTMLElement>('.reader-toolbar a, .reader-toolbar button:not(:disabled)')
      const target = controls?.[event.shiftKey ? controls.length - 1 : 0]
      target?.focus()
    })
    return
  }
  if ((event.target as HTMLElement)?.matches?.('input,textarea,select,[contenteditable="true"]')) return
  if (event.key === 'Escape' && panel.value) { event.preventDefault(); closePanel(); return }
  if (panel.value) return
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
  releasePreparation(); clearPresentation()
  const generation = ++layoutGeneration
  layoutChanging.value = true; clearTimeout(layoutTimer)
  // Debounce browser chrome/orientation resize bursts; retain the last semantic locator.
  layoutTimer = window.setTimeout(() => {
    layoutSize = { width, height }; updateViewport()
    cancelAnimationFrame(viewportFrame)
    viewportFrame = requestAnimationFrame(async () => {
      if (book.value?.format === 'epub') {
        const doc = frame.value?.contentDocument
        if (doc && !epubBusy.value && !doc.defaultView?.getSelection()?.toString().trim()) { restoreEpub(doc, pendingLocator); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (generation !== layoutGeneration || unmounting) return; layoutChanging.value = false; captureEpub(doc, false); prepareNeighbors() }
      } else if (state.value === 'ready' && readerMode.value === 'visual') {
        twoPage.value = zoomMode.value === 'manual' ? twoPagesFitAtZoom() : usesTwoPageSpread(width, height)
        void safely(renderPdf)
      }
      layoutChanging.value = false
      if (readerMode.value === 'reflow') { restoreReflow(reflowLocator); captureReflow() }
      log('viewport', { width, height }); if (queuedNavigation) { const delta = queuedNavigation; queuedNavigation = 0; void move(delta) }
    })
  }, 120)
}
function visibility(event?: Event) { if (document.visibilityState === 'hidden' || event?.type === 'pagehide' || event?.type === 'litera-host-pause') { if (book.value?.format === 'epub') captureEpub(); else captureReflow() } else scheduleLayout() }
function documentSelection() {
  if (book.value?.format !== 'pdf') return
  const root = readerMode.value === 'reflow' ? stage.value?.querySelector('.reader-document') : pdfSpread.value
  updateSelection(document, 'pdf', root ?? undefined)
}
function errorMessage(error: unknown) { const name = (error as any)?.name; if (name === 'PasswordException') return 'Este PDF é protegido por senha.'; if (name === 'InvalidPDFException') return 'O PDF está corrompido ou não é suportado.'; return error instanceof Error ? error.message : 'O leitor não pôde abrir o livro.' }
function retry() { window.location.reload() }

onMounted(async () => {
  try { toolbarPosition.value = localStorage.getItem('litera-reader-toolbar-position') === 'bottom' ? 'bottom' : 'top' } catch { /* Keep the default when optional browser storage is denied. */ }
  bodyOverflow = document.body.style.overflow; bodyOverscroll = document.body.style.overscrollBehavior; document.body.style.overflow = 'hidden'; document.body.style.overscrollBehavior = 'none'
  addEventListener('keydown', onKey); addEventListener('resize', scheduleLayout, { passive: true }); addEventListener('orientationchange', scheduleLayout, { passive: true }); visualViewport?.addEventListener('resize', scheduleLayout, { passive: true }); document.addEventListener('fullscreenchange', scheduleLayout); document.addEventListener('visibilitychange', visibility); document.addEventListener('selectionchange', documentSelection); addEventListener('pagehide', visibility); addEventListener('litera-host-pause', visibility); addEventListener('litera-host-resume', visibility); updateViewport(); layoutSize = { width: innerWidth, height: Math.round(visualViewport?.height ?? innerHeight) }; showChrome()
  try {
    bookSource = await openBookSource(id)
    if (unmounting) { bookSource.dispose(); return }
    book.value = (await api<any>(`/api/v1/books/${id}`)).book; const [saved, settings, highlightResult] = await Promise.all([api<any>(`/api/v1/books/${id}/progress`), api<any>('/api/v1/settings'), api<any>(`/api/v1/books/${id}/highlights`)])
    if (unmounting) return
    highlights.value = highlightResult.highlights; const target = highlights.value.find(item => item.id === Number(route.query.highlight)), restore = target ? { locator: target.locator } : saved.progress; revision = saved.progress?.revision
    epubFlow.value = settings.preferences.epubFlow === 'paginated' ? 'paginated' : 'scroll'; readerTheme.value = settings.preferences.theme; textScale.value = settings.preferences.fontScale; lineHeight.value = settings.preferences.lineHeight; margins.value = settings.preferences.margins; appTheme.value = settings.preferences.appTheme; reducedMotion.value = settings.preferences.reducedMotion; pdfInvert.value = settings.preferences.pdfInvert; applyTheme(appTheme.value); document.documentElement.dataset.reducedMotion = String(reducedMotion.value)
    if (book.value!.format === 'epub') await initEpub(restore); else await initPdf(restore); await nextTick(); if (unmounting) return; attachStage(); if (window.ResizeObserver && stage.value) { resizeObserver = new ResizeObserver(scheduleLayout); resizeObserver.observe(stage.value) }
  } catch (error) { message.value = errorMessage(error); state.value = 'error'; restoring = false }
})
onBeforeUnmount(() => {
  if (book.value?.format === 'epub') captureEpub(); else captureReflow(); unmounting = true; removeEventListener('keydown', onKey); removeEventListener('resize', scheduleLayout); removeEventListener('orientationchange', scheduleLayout); visualViewport?.removeEventListener('resize', scheduleLayout); document.removeEventListener('fullscreenchange', scheduleLayout); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('selectionchange', documentSelection); removeEventListener('pagehide', visibility); removeEventListener('litera-host-pause', visibility); removeEventListener('litera-host-resume', visibility)
  releasePreparation(); clearPresentation(); for (const view of visiblePdf) view.release(); visiblePdf = []; epubAbort?.abort(); epubGeneration++; resizeObserver?.disconnect(); stageInputCleanup?.(); frameInputCleanup?.(); frameEventCleanup?.(); renders.cancel(); for (const layer of pdfTextLayers) layer?.cancel?.(); reflowGeneration++; searchGeneration++; clearTimeout(chromeTimer); clearTimeout(layoutTimer); cancelAnimationFrame(viewportFrame); cancelAnimationFrame(selectionFrame); bookSource?.dispose(); reflowView = undefined; epubViews.fill(undefined); fallbackReady?.(); fallbackReady = undefined; pdf = undefined; try { void pdfLoadingTask?.destroy?.().catch(() => undefined) } catch { /* deterministic cleanup */ }
  applyReaderTheme()
  document.body.style.overflow = bodyOverflow; document.body.style.overscrollBehavior = bodyOverscroll
})
</script>

<template>
  <div ref="shell" class="reader-shell" :class="{ 'reader-shell--focus': chrome === 'hidden', 'reader-shell--toolbar-bottom': toolbarPosition === 'bottom' }">
    <header class="reader-toolbar" data-reader-interactive @focusin="showChrome(true)" @focusout="scheduleChrome">
      <div class="reader-toolbar__edge reader-toolbar__edge--start"><RouterLink class="icon-button" :to="`/books/${id}`" aria-label="Voltar ao livro"><UiIcon name="arrow-left" /></RouterLink><strong class="reader-book-title">{{ book?.title }}</strong></div>
      <nav class="reader-page-controls" aria-label="Navegação da leitura">
        <button class="icon-button" aria-label="Voltar na leitura" :disabled="!canMovePrevious" @click="move(-1)"><UiIcon name="chevron-left" /></button>
        <div class="reader-progress" role="group" :aria-label="readerPosition"><span :title="readerPosition">{{ book?.format === 'epub' ? `Cap. ${currentChapter + 1}/${toc.length}${epubFlow === 'paginated' ? ` · Pág. ${epubScreen}/${epubScreens}` : ''}` : readerPosition }}</span><progress aria-label="Progresso de leitura" :value="readerRatio" max="1" /></div>
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
      <div v-if="readerNotice || hasProgressConflict" class="reader-sync" role="alert" data-reader-interactive><p>{{ hasProgressConflict ? 'Sua posição mudou em outro dispositivo. Escolha a posição do servidor para continuar.' : readerNotice }}</p><button v-if="hasProgressConflict" class="button button--secondary" :disabled="resolvingConflict" @click="useServerPosition">Usar posição do servidor</button><button v-if="syncMessage && !hasProgressConflict" class="icon-button" aria-label="Dispensar aviso" @click="syncMessage = ''"><UiIcon name="x" /></button></div><output v-if="debug" class="reader-debug">{{ interactionMode }} · {{ readerPosition }} · {{ zoomMode }} {{ Math.round(zoom * 100) }}%</output>
      <div v-if="selectedQuote" class="selection-toolbar" role="toolbar" aria-label="Ações do trecho selecionado" data-reader-interactive><span>“{{ selectedQuote.slice(0, 70) }}<template v-if="selectedQuote.length > 70">…</template>”</span><button class="button button--tonal" :disabled="savingHighlight" @click="saveHighlight"><UiIcon name="sparkles" />{{ savingHighlight ? 'Salvando…' : 'Destacar' }}</button><button class="icon-button" aria-label="Fechar ações do trecho" @click="clearSelection"><UiIcon name="x" :size="16" /></button></div>
      <UiDialog v-if="panel" :open="true" :title="panel === 'toc' ? 'Sumário' : panel === 'settings' ? 'Leitura' : 'Buscar no livro'" close-label="Fechar painel" class="reader-toc" data-reader-interactive @close="closePanel()">
        <template v-if="panel === 'toc'"><button v-for="item in toc" :key="item.href" @click="goToc(item)">{{ item.label }}</button></template>
        <ReaderSettings v-else-if="panel === 'settings' && book" v-model:line-height="lineHeight" v-model:margins="margins" v-model:invert="pdfInvert" :format="book.format" :epub-flow="epubFlow" :mode="readerMode" :toolbar-position="toolbarPosition" :text-scale="textScale" :theme="readerTheme" :zoom="zoom" :zoom-mode="zoomMode" @epub-flow="setEpubFlow" @toolbar="setToolbarPosition" @mode="togglePdfMode" @text="adjustText" @theme="setTheme" @zoom="adjustZoom" @fit="setZoomMode" @change="changeSetting" @save="persistSettings" @fullscreen="toggleFullscreen" @search="togglePanel('search')" />
        <template v-else><form class="reader-search" @submit.prevent="searchBook"><label for="reader-query">Texto</label><input id="reader-query" v-model="searchQuery" type="search" minlength="2" required /><button class="button button--primary" :disabled="searching">{{ searching ? 'Buscando…' : 'Buscar' }}</button></form><button v-for="result in searchResults" :key="result.href || result.page" @click="openResult(result)"><strong>{{ result.label }}</strong><small>{{ result.excerpt }}</small></button><p v-if="!searchResults.length && !searching && searchQuery">Nenhuma ocorrência encontrada.</p></template>
      </UiDialog>
      <main ref="stage" :aria-busy="epubBusy || reflowLoading || layoutChanging" class="reader-stage" :class="[turnDirection && `reader-stage--${turnDirection}`, readerMode === 'reflow' && `reader-stage--theme-${readerTheme}`, { 'reader-stage--pdf': book?.format === 'pdf' && readerMode === 'visual', 'reader-stage--pdf-fitted': book?.format === 'pdf' && readerMode === 'visual' && zoomMode !== 'manual', 'reader-stage--reflow': readerMode === 'reflow', 'reader-stage--text': book?.format === 'epub' || readerMode === 'reflow' }]" @scroll.passive="captureReflow"><template v-if="book?.format === 'epub'"><AppState v-if="!frame" class="reader-initial-loading" kind="loading" title="Abrindo capítulo…" /><iframe v-for="(source, slot) in frameSources" :key="slot" class="epub-stage" :class="{ 'epub-stage--preparing': slot !== activeFrame }" :srcdoc="source" :aria-hidden="slot !== activeFrame" :tabindex="slot === activeFrame ? 0 : -1" title="Conteúdo do EPUB" sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox" @load="prepareFrame($event, slot)" /></template><ReaderTextContent v-else-if="readerMode === 'reflow'" :blocks="reflowBlocks" :loading="reflowLoading" :theme="readerTheme" :content-style="reflowStyle" :figures="reflowFigures" :image-url="`/api/v1/books/${id}/pdf/figure?page=${currentPage}`" :resolve-asset="reflowAssetResolver" /><div v-else ref="pdfSpread" class="pdf-spread" :class="{ 'pdf-spread--pinching': pinchScale !== 1 }" :style="pinchScale !== 1 ? { transform: `scale(${pinchScale})`, transformOrigin: `${pinchOrigin.x}px ${pinchOrigin.y}px` } : undefined" role="group" :aria-label="readerPosition" /></main>
    </template>
  </div>
</template>

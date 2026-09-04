import { getOfflineBook, getOfflineResource } from './offline-store'
import { getOfflineUser, offlineContext } from './offline-context'
import { api } from './api'
import { prepareEpubDocument, rewriteCssResources, type EpubAppearance } from '../../shared/epub-document'
import type { PdfReflowBlock, PdfReflowFigure } from '../../shared/pdf-reflow'

type Chapter = { id: string; href: string; label: string }
type ReflowPage = { page: number; pageCount: number; blocks: PdfReflowBlock[]; figures: PdfReflowFigure[]; adaptation?: unknown }
type LocalResource = (url: string) => Promise<Blob | undefined>
type SourceIdentity = { userId: number | undefined; generation: number }
export type SourceView<T> = { value: T; resolve: (url: string) => string; release: () => void }

function assertIdentity(identity?: SourceIdentity): void {
  if (identity && (getOfflineUser() !== identity.userId || offlineContext.generation !== identity.generation)) throw new Error('A conta ativa mudou. Reabra o livro.')
}

export function canonicalBookResource(url: string, origin: string): string {
  const parsed = new URL(url, origin)
  if (parsed.origin !== new URL(origin).origin) throw new Error('O recurso não pertence a este servidor.')
  if (parsed.pathname.endsWith('/epub/chapter')) for (const key of ['scale', 'theme', 'lineHeight', 'margins']) parsed.searchParams.delete(key)
  if (parsed.pathname.endsWith('/pdf/figure')) parsed.searchParams.delete('page')
  parsed.searchParams.sort()
  return parsed.pathname + parsed.search
}

/** A source belongs to one user/book/generation for its whole reader session. */
export class BookSource {
  private disposed = false
  private readonly views = new Set<() => void>()
  readonly local: boolean

  constructor(readonly bookId: number, private readonly resource?: LocalResource, private readonly origin = location.origin, private readonly identity?: SourceIdentity) {
    this.local = Boolean(resource)
  }

  assertCurrent(): void {
    if (this.disposed) throw new Error('A sessão de leitura foi encerrada.')
    assertIdentity(this.identity)
  }

  private canonical(url: string): string {
    const canonical = canonicalBookResource(url, this.origin)
    if (!canonical.startsWith(`/api/v1/books/${this.bookId}/`)) throw new Error('O recurso não pertence a este livro.')
    return canonical
  }

  private async blob(url: string): Promise<Blob> {
    this.assertCurrent()
    const canonical = this.canonical(url)
    const blob = await this.resource?.(canonical)
    this.assertCurrent()
    if (!blob) throw new Error('Um recurso deste livro não está disponível offline. Conecte-se e atualize o download.')
    return blob
  }

  private scope() {
    this.assertCurrent()
    const urls = new Map<string, string>()
    const loadingCss = new Set<string>()
    let released = false
    const release = () => { released = true; for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); this.views.delete(release) }
    this.views.add(release)
    const resolve = (url: string) => {
      this.assertCurrent()
      if (!this.local) return url
      const value = urls.get(canonicalBookResource(url, this.origin))
      if (!value) throw new Error('O recurso offline ainda não foi preparado.')
      return value
    }
    const load = async (url: string) => {
      if (url.startsWith('#') || url.startsWith('data:')) return url
      const parsed = new URL(url, this.origin), key = canonicalBookResource(url, this.origin)
      if (!urls.has(key)) {
        if (loadingCss.has(key) || loadingCss.size >= 16) throw new Error('As folhas de estilo deste livro possuem importações circulares ou excessivas.')
        let blob = await this.blob(key)
        if (blob.type.startsWith('text/css')) {
          loadingCss.add(key)
          try {
            const css = await rewriteCssResources(await blob.text(), asset => load(new URL(asset, new URL(key, this.origin)).href))
            blob = new Blob([css], { type: 'text/css' })
          } finally { loadingCss.delete(key) }
        }
        if (released) throw new Error('O carregamento deste recurso foi cancelado.')
        urls.set(key, URL.createObjectURL(blob))
      }
      return urls.get(key)! + parsed.hash
    }
    return { resolve, load, release }
  }

  private async json<T>(url: string): Promise<T> {
    this.assertCurrent()
    const value = this.local ? JSON.parse(await (await this.blob(url)).text()) : await api<T>(url)
    this.assertCurrent()
    return value
  }

  async manifest(): Promise<{ chapters: Chapter[] }> {
    return this.json(`/api/v1/books/${this.bookId}/epub/manifest`)
  }

  async chapterHtml(url: string, preferences: EpubAppearance, signal?: AbortSignal): Promise<SourceView<string>> {
    const scope = this.scope()
    try {
      let html: string
      if (this.local) html = await (await this.blob(url)).text()
      else {
        const response = await fetch(this.canonical(url), { signal, credentials: 'same-origin', cache: 'no-store', headers: this.identity?.userId !== undefined ? { 'X-Litera-User': String(this.identity.userId) } : undefined })
        this.assertCurrent()
        if (!response.ok) throw new Error(`Não foi possível carregar o capítulo (${response.status}).`)
        html = await response.text()
      }
      this.assertCurrent()
      const value = await prepareEpubDocument(html, preferences, this.local ? scope.load : undefined, async stylesheetUrl => {
        const css = await (await this.blob(stylesheetUrl)).text()
        return rewriteCssResources(css, asset => scope.load(new URL(asset, new URL(stylesheetUrl, this.origin)).href))
      })
      this.assertCurrent()
      if (signal?.aborted) throw new DOMException('Carregamento cancelado.', 'AbortError')
      return { value, resolve: scope.resolve, release: scope.release }
    } catch (error) { scope.release(); throw error }
  }

  async pdfInput(): Promise<{ data: ArrayBuffer } | { url: string; withCredentials: true; httpHeaders?: Record<string, string> }> {
    const url = `/api/v1/books/${this.bookId}/content`
    this.assertCurrent()
    if (!this.local) return { url, withCredentials: true, ...(this.identity?.userId !== undefined ? { httpHeaders: { 'X-Litera-User': String(this.identity.userId) } } : {}) }
    // No binary cache in this object: PDF.js takes ownership of this buffer.
    const data = await (await this.blob(url)).arrayBuffer()
    this.assertCurrent()
    return { data }
  }

  async reflow(page: number): Promise<SourceView<ReflowPage>> {
    const url = `/api/v1/books/${this.bookId}/pdf/reflow?page=${page}`, scope = this.scope()
    try {
      const value = await this.json<ReflowPage>(url)
      if (this.local) {
        const assets = new Set([...(value.figures ?? []).map(figure => figure.asset), ...value.blocks.flatMap(block => block.spans.map(span => span.fontAsset))])
        // Sequential reads bound peak memory for image-heavy pages.
        for (const asset of assets) if (asset) await scope.load(`/api/v1/books/${this.bookId}/pdf/figure?page=${value.page}&asset=${encodeURIComponent(asset)}`)
      }
      this.assertCurrent()
      return { value, resolve: scope.resolve, release: scope.release }
    } catch (error) { scope.release(); throw error }
  }

  async searchEpub(query: string): Promise<{ results: Array<{ href: string; label: string; excerpt: string }> }> {
    if (!this.local) return this.json(`/api/v1/books/${this.bookId}/epub/search?q=${encodeURIComponent(query)}`)
    const { chapters } = await this.manifest(), results: Array<{ href: string; label: string; excerpt: string }> = [], term = query.trim().toLocaleLowerCase()
    if (term.length < 2) return { results }
    for (const chapter of chapters) {
      const html = await (await this.blob(`/api/v1/books/${this.bookId}/epub/chapter?href=${encodeURIComponent(chapter.href)}`)).text()
      const document = new DOMParser().parseFromString(html, 'text/html')
      document.querySelectorAll('style,script').forEach(node => node.remove())
      const text = (document.querySelector('.reader-document')?.textContent ?? '').replace(/\s+/g, ' ').trim()
      const index = text.toLocaleLowerCase().indexOf(term)
      if (index >= 0) results.push({ href: chapter.href, label: chapter.label, excerpt: text.slice(Math.max(0, index - 60), index + term.length + 100) })
      if (results.length >= 20) break
    }
    this.assertCurrent()
    return { results }
  }

  dispose(): void { this.disposed = true; for (const release of [...this.views]) release() }
}

export async function openBookSource(bookId: number): Promise<BookSource> {
  const identity = { userId: getOfflineUser(), generation: offlineContext.generation }
  assertIdentity(identity)
  const userId = identity.userId
  if (userId === undefined) return new BookSource(bookId, undefined, location.origin, identity)
  // Storage unavailability must not prevent the online reader from opening.
  const book = await getOfflineBook(userId, bookId).catch(() => undefined)
  assertIdentity(identity)
  if (!book) return new BookSource(bookId, undefined, location.origin, identity)
  const generation = book.generation
  return new BookSource(bookId, url => getOfflineResource(userId, bookId, url, generation), location.origin, identity)
}

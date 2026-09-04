import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { BookSource, canonicalBookResource, openBookSource } from '../src/web/lib/book-source'
import { cssResourceReferences, epubAppearanceCss, rewriteCssResources } from '../src/shared/epub-document'

const storage = vi.hoisted(() => ({ book: vi.fn(), resource: vi.fn(), user: vi.fn(), context: { generation: 1 }, api: vi.fn() }))
vi.mock('../src/web/lib/offline-store', () => ({ getOfflineBook: storage.book, getOfflineResource: storage.resource }))
vi.mock('../src/web/lib/offline-context', () => ({ getOfflineUser: storage.user, offlineContext: storage.context }))
vi.mock('../src/web/lib/api', () => ({ api: storage.api }))

const origin = 'https://litera.test'
const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

describe('book source', () => {
  beforeEach(() => { vi.stubGlobal('location', { origin }); storage.book.mockReset(); storage.resource.mockReset(); storage.user.mockReturnValue(7); storage.context.generation = 1; storage.api.mockReset().mockImplementation(() => { throw new Error('Unexpected network request') }) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('uses canonical EPUB appearance-independent and PDF figure keys', () => {
    expect(canonicalBookResource('/api/v1/books/3/epub/chapter?theme=dark&href=Text%2Fone.xhtml&scale=130&margins=wide&lineHeight=relaxed', origin)).toBe('/api/v1/books/3/epub/chapter?href=Text%2Fone.xhtml')
    expect(canonicalBookResource('/api/v1/books/3/pdf/figure?page=2&asset=font-a.ttf', origin)).toBe('/api/v1/books/3/pdf/figure?asset=font-a.ttf')
    expect(() => canonicalBookResource('https://another.test/book', origin)).toThrow()
  })

  it('prefers persisted content even with an online connection and captures its generation', async () => {
    storage.book.mockResolvedValue({ generation: 'edition-one' })
    storage.resource.mockResolvedValue(new Blob(['%PDF-local']))
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', { onLine: true })
    const source = await openBookSource(3)
    storage.book.mockResolvedValue({ generation: 'edition-two' })
    const input = await source.pdfInput()
    expect(input).not.toHaveProperty('url')
    expect(new TextDecoder().decode((input as { data: ArrayBuffer }).data)).toBe('%PDF-local')
    expect(storage.resource).toHaveBeenCalledWith(7, 3, '/api/v1/books/3/content', 'edition-one')
    expect(fetch).not.toHaveBeenCalled()
    source.dispose()
  })

  it('preserves the online URL pipeline when no local source exists', async () => {
    const source = new BookSource(3)
    expect(await source.pdfInput()).toEqual({ url: '/api/v1/books/3/content', withCredentials: true })
  })

  it('does not make storage denial a prerequisite for reading online', async () => {
    storage.book.mockRejectedValue(new Error('Storage denied'))
    expect((await openBookSource(3)).local).toBe(false)
  })

  it('fails closed for a missing resource instead of mixing online editions', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const source = new BookSource(3, async () => undefined)
    await expect(source.pdfInput()).rejects.toThrow('não está disponível offline')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an account switch during an in-flight local read', async () => {
    storage.book.mockResolvedValue({ generation: 'one' })
    storage.resource.mockImplementation(async () => { storage.user.mockReturnValue(8); return new Blob(['private']) })
    const source = await openBookSource(3)
    await expect(source.pdfInput()).rejects.toThrow('conta ativa mudou')
  })

  it('rejects a session change during initial storage lookup even if the same user logs in again', async () => {
    storage.book.mockImplementation(async () => { storage.context.generation++; return { generation: 'edition-one' } })
    await expect(openBookSource(3)).rejects.toThrow('conta ativa mudou')
    expect(storage.resource).not.toHaveBeenCalled()
  })

  it('does not turn a session change plus storage failure into an unguarded online source', async () => {
    storage.book.mockImplementation(async () => { storage.context.generation++; throw new Error('Storage denied') })
    await expect(openBookSource(3)).rejects.toThrow('conta ativa mudou')
  })

  it('binds online PDF requests to the captured identity and rejects stale sources', async () => {
    storage.book.mockResolvedValue(undefined)
    const source = await openBookSource(3)
    expect(await source.pdfInput()).toEqual({ url: '/api/v1/books/3/content', withCredentials: true, httpHeaders: { 'X-Litera-User': '7' } })
    storage.context.generation++
    await expect(source.pdfInput()).rejects.toThrow('conta ativa mudou')
    expect(() => source.assertCurrent()).toThrow('conta ativa mudou')
  })

  it('passes captured identity and no-store to online EPUB loading and rejects a changed response context', async () => {
    storage.book.mockResolvedValue(undefined)
    const source = await openBookSource(3)
    const response = new Response('<main class="reader-document">private</main>')
    const fetch = vi.fn(async () => { storage.context.generation++; return response })
    vi.stubGlobal('fetch', fetch)
    await expect(source.chapterHtml('/api/v1/books/3/epub/chapter?href=one.xhtml', { fontScale: 100, theme: 'light', lineHeight: 'normal', margins: 'normal' })).rejects.toThrow('conta ativa mudou')
    expect(fetch).toHaveBeenCalledWith('/api/v1/books/3/epub/chapter?href=one.xhtml', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin', headers: { 'X-Litera-User': '7' } }))
  })

  it('rejects a chapter URL from another book before making an online request', async () => {
    storage.book.mockResolvedValue(undefined)
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const source = await openBookSource(3)
    await expect(source.chapterHtml('/api/v1/books/4/epub/chapter?href=one.xhtml', { fontScale: 100, theme: 'light', lineHeight: 'normal', margins: 'normal' })).rejects.toThrow('não pertence a este livro')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('checks context after reading an online chapter response body', async () => {
    storage.book.mockResolvedValue(undefined)
    const source = await openBookSource(3)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => { storage.context.generation++; return '<main class="reader-document">private</main>' } })))
    await expect(source.chapterHtml('/api/v1/books/3/epub/chapter?href=one.xhtml', { fontScale: 100, theme: 'light', lineHeight: 'normal', margins: 'normal' })).rejects.toThrow('conta ativa mudou')
  })

  it('checks captured identity after online manifest and adapted-page requests', async () => {
    storage.book.mockResolvedValue(undefined)
    const source = await openBookSource(3)
    storage.api.mockImplementation(async () => { storage.context.generation++; return { chapters: [] } })
    await expect(source.manifest()).rejects.toThrow('conta ativa mudou')
    const next = await openBookSource(3)
    storage.api.mockImplementation(async () => { storage.context.generation++; return { page: 1, blocks: [], figures: [] } })
    await expect(next.reflow(1)).rejects.toThrow('conta ativa mudou')
  })

  it('rejects same-user session changes during a local binary read', async () => {
    storage.book.mockResolvedValue({ generation: 'edition-one' })
    storage.resource.mockImplementation(async () => { storage.context.generation++; return new Blob(['private']) })
    const source = await openBookSource(3)
    await expect(source.pdfInput()).rejects.toThrow('conta ativa mudou')
  })

  it('reads the EPUB manifest from the same local source', async () => {
    const chapters = [{ id: 'a', href: 'a.xhtml', label: 'Chapter A' }]
    const read = vi.fn(async () => json({ chapters }))
    const source = new BookSource(3, read)
    expect(await source.manifest()).toEqual({ chapters })
    expect(read).toHaveBeenCalledWith('/api/v1/books/3/epub/manifest')
  })

  it('prepares adapted figures and native fonts before exposing a synchronous resolver', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL'), create = vi.spyOn(URL, 'createObjectURL')
    const page = { page: 2, pageCount: 10, blocks: [{ kind: 'p', spans: [{ text: 'Glyph', fontAsset: 'font-a.ttf' }] }], figures: [{ asset: '2-0.png', afterBlock: 0 }] }
    const resources = new Map([
      ['/api/v1/books/3/pdf/reflow?page=2', json(page)],
      ['/api/v1/books/3/pdf/figure?asset=2-0.png', new Blob(['image'], { type: 'image/png' })],
      ['/api/v1/books/3/pdf/figure?asset=font-a.ttf', new Blob(['font'], { type: 'font/ttf' })],
    ])
    const source = new BookSource(3, async url => resources.get(url))
    const view = await source.reflow(2)
    expect(view.value).toEqual(page)
    expect(view.resolve('/api/v1/books/3/pdf/figure?page=2&asset=2-0.png')).toMatch(/^blob:/)
    expect(view.resolve('/api/v1/books/3/pdf/figure?page=9&asset=font-a.ttf')).toMatch(/^blob:/)
    expect(create).toHaveBeenCalledTimes(2)
    view.release(); source.dispose()
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it('releases partially prepared assets on failure', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const source = new BookSource(3, async url => url.includes('/reflow') ? json({ page: 1, blocks: [], figures: [{ asset: '1-0.png' }, { asset: '1-1.png' }] }) : url.includes('1-0.png') ? new Blob(['first']) : undefined)
    await expect(source.reflow(1)).rejects.toThrow('não está disponível offline')
    expect(revoke).toHaveBeenCalledOnce()
    source.dispose()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('rewrites nested CSS imports and font URLs before creating stylesheet blobs', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return `blob:local-${blobs.length}` })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const asset = (name: string) => '/api/v1/books/3/epub/asset?src=' + name
    const resources = new Map([
      ['/api/v1/books/3/pdf/reflow?page=1', json({ page: 1, blocks: [], figures: [{ asset: 'sheet.css' }] })],
      ['/api/v1/books/3/pdf/figure?asset=sheet.css', new Blob([`@import url("${asset('nested.css')}");`], { type: 'text/css' })],
      [asset('nested.css'), new Blob([`@font-face{font-family:Book;src:url("${asset('book.woff2')}")}`], { type: 'text/css' })],
      [asset('book.woff2'), new Blob(['font'], { type: 'font/woff2' })],
    ])
    const source = new BookSource(3, async url => resources.get(url))
    const view = await source.reflow(1)
    expect(blobs).toHaveLength(3)
    expect(await blobs[1]!.text()).toContain('url("blob:local-1")')
    expect(await blobs[2]!.text()).toBe('@import url("blob:local-2");')
    view.release(); source.dispose()
  })

  it('rejects circular stylesheet imports without leaking object URLs', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const resource = '/api/v1/books/3/pdf/figure?asset=sheet.css'
    const source = new BookSource(3, async url => url.includes('/reflow')
      ? json({ page: 1, blocks: [], figures: [{ asset: 'sheet.css' }] })
      : new Blob([`@import url("${resource}");`], { type: 'text/css' }))
    await expect(source.reflow(1)).rejects.toThrow('circulares')
    expect(create).not.toHaveBeenCalled()
    source.dispose()
  })

  it('does not recreate object URLs after the source was disposed during loading', async () => {
    let release!: (blob: Blob) => void
    const source = new BookSource(3, async url => url.includes('/reflow') ? json({ page: 1, blocks: [], figures: [{ asset: '1-0.png' }] }) : new Promise(resolve => { release = resolve }))
    const create = vi.spyOn(URL, 'createObjectURL'), loading = source.reflow(1)
    const assertion = expect(loading).rejects.toThrow('sessão de leitura')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    source.dispose(); release(new Blob(['late']))
    await assertion
    expect(create).not.toHaveBeenCalled()
  })
})

describe('EPUB offline appearance and resources', () => {
  it('applies the existing reader presets without depending on saved CSS values', () => {
    const css = epubAppearanceCss({ theme: 'sepia', fontScale: 110, lineHeight: 'relaxed', margins: 'wide' })
    expect(css).toContain('#f4ead6'); expect(css).toContain('19.8px'); expect(css).toContain('line-height:1.85'); expect(css).toContain('72rem')
    expect(epubAppearanceCss({ theme: 'dark', fontScale: Infinity, lineHeight: 'normal', margins: 'normal' })).toContain('25.2px')
  })

  it('rewrites image, import and embedded-font CSS URLs without losing declarations', async () => {
    const resolve = vi.fn(async (url: string) => 'blob:' + url)
    expect(await rewriteCssResources('@import url("one.css");@font-face{src:url(\'font.woff2\')}p{background:url(image.png);font-style:italic}', resolve))
      .toBe('@import url("blob:one.css");@font-face{src:url("blob:font.woff2")}p{background:url("blob:image.png");font-style:italic}')
    expect(resolve).toHaveBeenCalledTimes(3)
  })

  it('keeps quoted CSS asset names containing parentheses and apostrophes complete', async () => {
    const css = `@import "theme's.css";figure{background:url("figure(1).png")}i{background:url('author\\'s.png')}`
    expect(cssResourceReferences(css)).toEqual(["figure(1).png", "author's.png", "theme's.css"])
    expect(await rewriteCssResources(css, async value => `blob:${value}`)).toContain('url("blob:figure(1).png")')
  })

  it('reader dispatches progress immediately and no longer runs a second offline queue', () => {
    const reader = fs.readFileSync(new URL('../src/web/pages/ReaderPage.vue', import.meta.url), 'utf8')
    expect(reader).toContain('void saveProgress(value)')
    expect(reader).not.toContain('QueuedProgressSaver')
    expect(reader).not.toContain('OfflineProgress')
    expect(reader).not.toContain('scrollFrame')
    expect(reader).toContain('bookSource?.assertCurrent(); void saveProgress(value)')
    expect(reader).toContain("scroll = () => { captureEpub(document) }")
    expect(reader).toContain("await resolveProgressConflict(id, 'server')")
    expect(reader).toContain('restoring = true\n  resolvingConflict.value = true')
    expect(reader).toContain('delete query.highlight; delete query.mode')
    expect(reader).toContain("cMapUrl: '/pdfjs/cmaps/'")
    expect(reader).toContain("standardFontDataUrl: '/pdfjs/standard_fonts/'")
    expect(reader).toContain("wasmUrl: '/pdfjs/wasm/'")
  })
})

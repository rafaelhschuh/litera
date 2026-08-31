import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { login, testContext } from './setup.js'

describe('MVP smoke flow', () => {
  let context: Awaited<ReturnType<typeof testContext>>
  beforeEach(async () => { context = await testContext() })
  afterEach(async () => context.cleanup())

  it('login -> scan -> catalog -> readers -> restore -> legacy', async () => {
    expect((await login(context.agent)).status).toBe(200)
    const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Books', path: context.books })
    expect((await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)).status).toBe(200)
    const books = (await context.agent.get('/api/v1/books')).body.books
    const epub = books.find((book: any) => book.format === 'epub'); const pdf = books.find((book: any) => book.format === 'pdf')
    const epubContent = await context.agent.get(`/api/v1/books/${epub.id}/content`)
    const pdfContent = await context.agent.get(`/api/v1/books/${pdf.id}/content`)
    expect(epubContent.status).toBe(200); expect(epubContent.headers['content-type']).toContain('application/epub+zip')
    expect(pdfContent.status).toBe(200); expect(pdfContent.headers['content-type']).toContain('application/pdf')
    const reflow = await context.agent.get(`/api/v1/books/${pdf.id}/pdf/reflow?page=1`)
    expect(reflow.status).toBe(200)
    expect(reflow.body.blocks[0]).toMatchObject({ kind: 'p', spans: [{ text: 'Litera PDF real' }] })
    await context.agent.put(`/api/v1/books/${pdf.id}/progress`).send({ format: 'pdf', progressRatio: 1, locator: { type: 'pdf-page', page: 1 } })
    expect((await context.agent.get(`/api/v1/books/${pdf.id}/progress`)).body.progress.locator).toEqual({ type: 'pdf-page', page: 1 })
    expect((await context.agent.get('/legacy')).status).toBe(404)
    await context.agent.put('/api/v1/admin/compatibility').send({ enabled: true })
    expect((await context.agent.get('/legacy/login')).status).toBe(200)
    const manifest = await context.agent.get(`/api/v1/books/${epub.id}/epub/manifest`); expect(manifest.body.chapters).toHaveLength(2)
    const chapter = await context.agent.get(`/api/v1/books/${epub.id}/epub/chapter?href=${encodeURIComponent(manifest.body.chapters[0].href)}`)
    expect(chapter.text).toContain('Conteúdo real'); expect(chapter.text).not.toContain('<script>')
    expect(chapter.text).toContain('<main class="reader-document">')
    expect(chapter.text).toContain('column-count:2')
    expect(chapter.text).toContain('href="#nota-1"')
    expect(chapter.text).toContain('data-epub-href="chapter-2.xhtml"')
    expect(chapter.text).toContain('rel="noopener noreferrer"')
    await context.agent.put(`/api/v1/books/${epub.id}/progress`).send({ format: 'epub', progressRatio: .5, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/4)', chapterHref: manifest.body.chapters[0].href } })
    expect((await context.agent.get(`/api/v1/books/${epub.id}/progress`)).body.progress.progressRatio).toBe(.5)
    await context.agent.put('/api/v1/admin/compatibility').send({ enabled: false })
    expect((await context.agent.get('/legacy')).status).toBe(404)
  })
})

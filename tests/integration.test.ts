import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../src/server/database.js'
import { login, testContext } from './setup.js'

describe('Litera integrated API', () => {
  let context: Awaited<ReturnType<typeof testContext>>
  beforeEach(async () => { context = await testContext() })
  afterEach(async () => context.cleanup())

  it('protects application and administrator boundaries', async () => {
    expect((await context.agent.get('/api/v1/books')).status).toBe(401)
    context.db.prepare(`INSERT INTO users(username,display_name,password_hash,role) VALUES (?,?,?,'reader')`).run('reader','Reader',hashPassword('reader-password-123'))
    const reader = (await import('supertest')).default.agent(context.app)
    expect((await login(reader, 'reader', 'reader-password-123')).status).toBe(200)
    expect((await reader.get('/api/v1/admin/libraries')).status).toBe(403)
  })

  it('scans real EPUB/PDF idempotently, searches and reconciles removal', async () => {
    expect((await login(context.agent)).status).toBe(200)
    const created = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books })
    expect(created.status).toBe(201)
    const first = await context.agent.post(`/api/v1/admin/libraries/${created.body.library.id}/scan`)
    expect(first.body.report).toMatchObject({ discovered: 2, added: 2, missing: 0 })
    const second = await context.agent.post(`/api/v1/admin/libraries/${created.body.library.id}/scan`)
    expect(second.body.report).toMatchObject({ added: 0, updated: 0 })
    const search = await context.agent.get('/api/v1/books?q=Ilha')
    expect(search.body.books).toHaveLength(1); expect(search.body.books[0]).toMatchObject({ title: 'A Ilha de Teste', author: 'Ana Leitora', format: 'epub', hasCover: true })
    expect((context.db.prepare('SELECT cover_path AS coverPath FROM books WHERE id=?').get(search.body.books[0].id) as { coverPath: string }).coverPath).toMatch(/\.web\.jpg$/)
    expect((await context.agent.get('/api/v1/books?q=Caderno')).body.books[0].author).toBe('Paulo Página')
    await fs.rm(path.join(context.books, 'caderno.pdf'))
    const third = await context.agent.post(`/api/v1/admin/libraries/${created.body.library.id}/scan`)
    expect(third.body.report.missing).toBe(1)
    expect((await context.agent.get('/api/v1/books')).body.books).toHaveLength(1)
  })

  it('makes corrupt input actionable without aborting the scan', async () => {
    await fs.writeFile(path.join(context.books, 'broken.epub'), 'not a zip')
    await login(context.agent)
    const created = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books })
    const result = await context.agent.post(`/api/v1/admin/libraries/${created.body.library.id}/scan`)
    expect(result.status).toBe(200); expect(result.body.report.errors).toHaveLength(1)
    const errors = await context.agent.get(`/api/v1/admin/libraries/${created.body.library.id}/errors`)
    expect(errors.body.errors[0].file).toBe('broken.epub')
  })

  it('stores progress per user and exposes Continue Reading', async () => {
    await login(context.agent); const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books }); await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
    const epub = (await context.agent.get('/api/v1/books?q=Ilha')).body.books[0]
    const saved = await context.agent.put(`/api/v1/books/${epub.id}/progress`).send({ format: 'epub', progressRatio: .42, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/4)', chapterHref: 'chapter-2.xhtml' } })
    expect(saved.body.progress).toMatchObject({ progressRatio: .42, locator: { cfi: 'epubcfi(/6/4)' } })
    expect((await context.agent.get(`/api/v1/books/${epub.id}/progress`)).body.progress.locator.chapterHref).toBe('chapter-2.xhtml')
    expect((await context.agent.get('/api/v1/home')).body.continueReading[0].id).toBe(epub.id)
  })

  it('stores format-aware highlights per user', async () => {
    await login(context.agent); const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books }); await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
    const books = (await context.agent.get('/api/v1/books')).body.books
    const epub = books.find((book: any) => book.format === 'epub'); const pdf = books.find((book: any) => book.format === 'pdf')
    const created = await context.agent.post(`/api/v1/books/${epub.id}/highlights`).send({ quoteText: 'Conteúdo real do primeiro capítulo.', locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)', chapterHref: 'chapter-1.xhtml' }, chapter: 'Chegada' })
    expect(created.status).toBe(201); expect(created.body.highlight).toMatchObject({ quoteText: 'Conteúdo real do primeiro capítulo.', chapter: 'Chegada', pageNumber: null })
    expect((await context.agent.put(`/api/v1/highlights/${created.body.highlight.id}/rating`).send({ rating: 4 })).body.rating).toBe(4)
    expect((await context.agent.put(`/api/v1/books/${epub.id}/rating`).send({ rating: 5 })).body.rating).toBe(5)
    expect((await context.agent.get(`/api/v1/books/${epub.id}`)).body.book.userRating).toBe(5)
    expect((await context.agent.post(`/api/v1/books/${epub.id}/highlights`).send({ quoteText: 'Página inventada', locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)' }, pageNumber: 3 })).status).toBe(400)
    expect((await context.agent.post(`/api/v1/books/${pdf.id}/highlights`).send({ quoteText: 'Trecho da página', locator: { type: 'pdf-page', page: 1 }, pageNumber: 1 })).status).toBe(201)
    expect((await context.agent.get(`/api/v1/books/${epub.id}/highlights`)).body.highlights).toHaveLength(1)
    expect((await context.agent.delete(`/api/v1/highlights/${created.body.highlight.id}`)).status).toBe(204)
  })

  it('persists PDF inversion and supports manual metadata with a custom cover', async () => {
    await login(context.agent); const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books }); await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
    const pdf = (await context.agent.get('/api/v1/books')).body.books.find((book: any) => book.format === 'pdf')
    const settings = { theme: 'dark', fontScale: 110, lineHeight: 'relaxed', margins: 'wide', appTheme: 'dark', reducedMotion: false, pdfInvert: true }
    expect((await context.agent.put('/api/v1/settings').send(settings)).body.preferences.pdfInvert).toBe(true)
    expect((await context.agent.get('/api/v1/settings')).body.preferences.pdfInvert).toBe(true)
    const metadata = await context.agent.put(`/api/v1/admin/metadata/books/${pdf.id}`).send({ title: 'Caderno revisado', author: 'Editora Manual', description: 'Descrição organizada.', language: 'pt-BR', genres: ['Ensaios'] })
    expect(metadata.status).toBe(200)
    const uploadedImage = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#74394b' } }).png().toBuffer()
    const cover = await context.agent.put(`/api/v1/admin/metadata/books/${pdf.id}/cover`).send({ dataUrl: `data:image/png;base64,${uploadedImage.toString('base64')}` })
    expect(cover.status).toBe(200)
    expect((await context.agent.get(`/api/v1/books/${pdf.id}`)).body.book).toMatchObject({ title: 'Caderno revisado', author: 'Editora Manual', hasCover: true })
    const stored = context.db.prepare('SELECT cover_path AS coverPath FROM books WHERE id=?').get(pdf.id) as { coverPath: string }
    expect(stored.coverPath).toMatch(/\.web\.jpg$/)
    expect(await sharp(stored.coverPath).metadata()).toMatchObject({ format: 'jpeg', width: 640, height: 960, isProgressive: true })
    const response = await context.agent.get(`/api/v1/books/${pdf.id}/cover`)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^image\/jpeg/)
    expect(response.headers['cache-control']).toContain('stale-while-revalidate=604800')
    expect((await context.agent.get(`/api/v1/books/${pdf.id}/cover`).set('If-None-Match', response.headers.etag)).status).toBe(304)
    expect((await context.agent.put(`/api/v1/admin/metadata/books/${pdf.id}/cover`).send({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })).status).toBe(400)
  })
})

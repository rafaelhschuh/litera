import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { login, testContext } from './setup.js'
import { createScanJob, runScanJob } from '../src/server/jobs.js'
import { writeEpub } from './fixtures.js'

describe('catalog identity and cover ownership', () => {
  let context: Awaited<ReturnType<typeof testContext>>, libraryId: number
  beforeEach(async () => {
    context = await testContext(); await login(context.agent)
    libraryId = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Books', path: context.books })).body.library.id
    await scan()
  })
  afterEach(async () => context.cleanup())
  async function scan() { const response = await context.agent.post(`/api/v1/admin/libraries/${libraryId}/scan`); expect(response.status).toBe(200); return response.body.report }
  async function books() { return (await context.agent.get('/api/v1/books')).body.books as any[] }
  async function coloredBook(file: string, title: string, color: string) {
    await writeEpub(file, title)
    const zip = await JSZip.loadAsync(await fs.readFile(file))
    zip.file('OEBPS/cover.png', await sharp({ create: { width: 8, height: 12, channels: 3, background: color } }).png().toBuffer())
    await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))
  }
  async function cover(bookId: number) { return (await context.agent.get(`/api/v1/books/${bookId}/cover`)).body as Buffer }

  it('refreshes embedded covers on content replacement, repairs old cached associations and keeps rescans idempotent', async () => {
    const book = (await books()).find(book => book.format === 'epub')!
    const before = await cover(book.id)
    await coloredBook(path.join(context.books, 'island.epub'), 'New edition', '#fe1111')
    expect(await scan()).toMatchObject({ added: 0, updated: 1, errors: [] })
    const after = (await books()).find(item => item.id === book.id)!
    expect(after.title).toBe('New edition'); expect(after.coverRevision).not.toBe(book.coverRevision)
    expect(await cover(book.id)).not.toEqual(before)
    const other = (await books()).find(item => item.format === 'pdf')!
    context.db.prepare('UPDATE books SET cover_path=(SELECT cover_path FROM books WHERE id=?),cover_fingerprint=NULL WHERE id=?').run(other.id, book.id)
    await scan()
    expect(await cover(book.id)).not.toEqual(await cover(other.id))
    expect(await scan()).toMatchObject({ added: 0, updated: 0, unchanged: 2, missing: 0, errors: [] })
  })

  it('does not attach a new upload to a missing book whose inode was reused', async () => {
    const old = (await books()).find(book => book.format === 'epub')!
    await fs.rm(path.join(context.books, 'island.epub'))
    const source = path.join(context.root, 'new.epub'); await coloredBook(source, 'Different book', '#1111fe')
    const blocker = createScanJob(context.db, libraryId)
    context.db.prepare("UPDATE scan_jobs SET status='running' WHERE id=?").run(blocker.id)
    const result = await context.agent.post(`/api/v1/admin/libraries/${libraryId}/upload`).query({ filename: 'new.epub' }).set('Content-Type', 'application/octet-stream').send(await fs.readFile(source))
    expect(result.status).toBe(201)
    // A deterministic inode collision, independent of the filesystem allocator.
    const stat = await fs.stat(path.join(context.books, 'new.epub'))
    context.db.prepare('UPDATE book_files SET identity=? WHERE book_id=?').run(`${stat.dev}:${stat.ino}`, old.id)
    context.db.prepare("UPDATE scan_jobs SET status='completed' WHERE id=?").run(blocker.id)
    await runScanJob(context.db, context.config, result.body.job.id)
    // The upload may have already started its job; wait for its real result.
    const { vi } = await import('vitest')
    await vi.waitFor(() => expect((context.db.prepare('SELECT status FROM scan_jobs WHERE id=?').get(result.body.job.id) as any).status).toBe('completed'))
    const added = (await books()).find(book => book.title === 'Different book')!
    expect(added.id).not.toBe(old.id)
    expect((await books()).some(book => book.id === old.id)).toBe(false)
    expect((context.db.prepare('SELECT status FROM book_files WHERE book_id=?').get(old.id) as any).status).toBe('missing')
  })

  it('catalogs hard links separately and reconciles atomic replacements without unique-constraint failures', async () => {
    await fs.link(path.join(context.books, 'island.epub'), path.join(context.books, 'linked.epub'))
    expect(await scan()).toMatchObject({ added: 1, missing: 0, errors: [] })
    expect(await scan()).toMatchObject({ added: 0, unchanged: 3, missing: 0, errors: [] })
    const temporary = path.join(context.root, 'replacement.epub'); await coloredBook(temporary, 'Atomic edition', '#11fe11')
    await fs.rename(temporary, path.join(context.books, 'island.epub'))
    expect(await scan()).toMatchObject({ added: 0, updated: 1, errors: [] })
    expect((await books()).map(book => book.title)).toContain('Atomic edition')
  })

  it('preserves manual covers and metadata across a replacement and versions each manual cover', async () => {
    const book = (await books()).find(book => book.format === 'epub')!
    await context.agent.put(`/api/v1/admin/metadata/books/${book.id}`).send({ title: 'Curated title', genres: [] })
    const bytes = await sharp({ create: { width: 8, height: 12, channels: 3, background: '#ab1122' } }).png().toBuffer()
    expect((await context.agent.put(`/api/v1/admin/metadata/books/${book.id}/cover`).send({ dataUrl: 'data:image/png;base64,' + bytes.toString('base64') })).status).toBe(200)
    const manual = await cover(book.id), previous = (await books()).find(item => item.id === book.id)!
    await coloredBook(path.join(context.books, 'island.epub'), 'Embedded title', '#1234ef')
    await scan()
    expect((await books()).find(item => item.id === book.id)!.title).toBe('Curated title')
    expect(await cover(book.id)).toEqual(manual)
    const next = await sharp({ create: { width: 8, height: 12, channels: 3, background: '#abff22' } }).png().toBuffer()
    await context.agent.put(`/api/v1/admin/metadata/books/${book.id}/cover`).send({ dataUrl: 'data:image/png;base64,' + next.toString('base64') })
    expect((await books()).find(item => item.id === book.id)!.coverRevision).not.toBe(previous.coverRevision)
  })

  it('retries corrupt files instead of silently marking unchanged errors as available', async () => {
    await fs.writeFile(path.join(context.books, 'corrupt.epub'), 'bad archive')
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await scan()).errors).toHaveLength(1)
      expect((context.db.prepare("SELECT status FROM book_files WHERE relative_path='corrupt.epub'").get() as any).status).toBe('error')
      expect((await books()).map(book => book.title)).not.toContain('corrupt')
    }
  })
  it('detects content changes even when size, inode and mtime are unchanged', async () => {
    const file = path.join(context.books, 'island.epub')
    const source = await JSZip.loadAsync(await fs.readFile(file)), padded = new JSZip()
    padded.file('leading.bin', 'x'.repeat(128 * 1024))
    for (const [name, entry] of Object.entries(source.files)) if (!entry.dir) padded.file(name, await entry.async('nodebuffer'))
    padded.file('trailing.bin', 'y'.repeat(128 * 1024))
    await fs.writeFile(file, await padded.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))
    await scan()
    const before = (await books()).find(book => book.format === 'epub')!, stat = await fs.stat(file), bytes = await fs.readFile(file)
    // Re-generate CRCs without changing entry lengths or the source file's timestamps.
    padded.file('OEBPS/content.opf', (await padded.file('OEBPS/content.opf')!.async('string')).replace('A Ilha de Teste', 'A Nova de Teste'))
    const revised = await padded.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
    expect(revised.length).toBe(bytes.length)
    await fs.writeFile(file, revised); await fs.utimes(file, stat.atime, stat.mtime)
    expect(Math.round((await fs.stat(file)).mtimeMs)).toBe(Math.round(stat.mtimeMs))
    expect(await scan()).toMatchObject({ updated: 1, errors: [] })
    const after = (await books()).find(book => book.id === before.id)!
    expect(after.title).toBe('A Nova de Teste'); expect(after.fileRevision).not.toBe(before.fileRevision)
  })

})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/server/config.js'
import { hashPassword, migrations, openDatabase } from '../src/server/database.js'
import { enqueueDueLibraryScans } from '../src/server/jobs.js'
import { login, testContext } from './setup.js'
import { writeEpub } from './fixtures.js'

describe('Beta integrated behavior', () => {
  let context: Awaited<ReturnType<typeof testContext>>
  beforeEach(async () => { context = await testContext() })
  afterEach(async () => { vi.unstubAllGlobals(); await context.cleanup() })

  async function scannedLibrary() {
    await login(context.agent)
    const created = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books })
    await context.agent.post(`/api/v1/admin/libraries/${created.body.library.id}/scan`)
    return created.body.library
  }

  it('reconciles a new-inode rename without duplicating catalog data', async () => {
    const library = await scannedLibrary()
    const original = path.join(context.books, 'island.epub')
    const replacement = path.join(context.books, 'ilha-renomeada.epub')
    const temporary = path.join(context.books, 'copy.epub')
    await fs.copyFile(original, temporary); await fs.rm(original); await fs.rename(temporary, replacement)
    const report = (await context.agent.post(`/api/v1/admin/libraries/${library.id}/scan`)).body.report
    expect(report).toMatchObject({ added: 0, renamed: 1, missing: 0 })
    expect((await context.agent.get('/api/v1/books')).body.pagination.total).toBe(2)
  })

  it('supports multiple independently rescannable libraries', async () => {
    const secondRoot = path.join(context.root, 'second-books'); await fs.mkdir(secondRoot); await writeEpub(path.join(secondRoot, 'second.epub'))
    context.config.allowedBookRoots.push(secondRoot)
    await login(context.agent)
    const first = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books })).body.library
    const second = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Secundária', path: secondRoot })).body.library
    await context.agent.post(`/api/v1/admin/libraries/${first.id}/scan`); await context.agent.post(`/api/v1/admin/libraries/${second.id}/scan`)
    expect((await context.agent.get('/api/v1/books')).body.pagination.total).toBe(3)
    await fs.rm(path.join(secondRoot, 'second.epub')); const report = (await context.agent.post(`/api/v1/admin/libraries/${second.id}/scan`)).body.report
    expect(report.missing).toBe(1); expect((await context.agent.get('/api/v1/books')).body.pagination.total).toBe(2)
  })

  it('persists scan jobs and deduplicates concurrent requests for one library', async () => {
    await login(context.agent)
    const library = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books })).body.library
    const [first, second] = await Promise.all([
      context.agent.post(`/api/v1/admin/libraries/${library.id}/scan?async=true`),
      context.agent.post(`/api/v1/admin/libraries/${library.id}/scan?async=true`),
    ])
    expect(first.status).toBe(202); expect(second.status).toBe(202); expect(second.body.job.id).toBe(first.body.job.id)
    let job: any
    for (let attempt = 0; attempt < 30; attempt++) {
      job = (await context.agent.get(`/api/v1/admin/jobs/${first.body.job.id}`)).body.job
      if (!['queued', 'running'].includes(job.status)) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(job.status).toBe('completed'); expect(job.summary.discovered).toBe(2)
  })

  it('configures and enqueues automatic library rescans when due', async () => {
    await login(context.agent)
    const created = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Automática', path: context.books, rescanIntervalMinutes: 60 })
    expect(created.body.library.rescanIntervalMinutes).toBe(60)
    const due = enqueueDueLibraryScans(context.db, context.config)
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ libraryId: created.body.library.id, status: 'queued' })
    const listed = (await context.agent.get('/api/v1/admin/libraries')).body.libraries[0]
    expect(listed.rescanIntervalMinutes).toBe(60)
    for (let attempt = 0; attempt < 50; attempt++) {
      const status = (context.db.prepare('SELECT status FROM scan_jobs WHERE id=?').get(due[0]!.id) as { status: string }).status
      if (!['queued', 'running'].includes(status)) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  })

  it('keeps progress isolated and rejects a stale update', async () => {
    const library = await scannedLibrary()
    const book = (await context.agent.get('/api/v1/books?q=Ilha')).body.books[0]
    const created = await context.agent.post('/api/v1/admin/users').send({ username: 'ana', displayName: 'Ana', password: 'reader-password-123', role: 'reader', libraryIds: [library.id] })
    expect(created.status).toBe(201)
    const readerA = request.agent(context.app); const readerB = request.agent(context.app)
    await login(readerA, 'ana', 'reader-password-123'); await login(readerB, 'ana', 'reader-password-123')
    const first = await readerA.put(`/api/v1/books/${book.id}/progress`).send({ format: 'epub', progressRatio: .1, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)' } })
    const revision = first.body.progress.revision
    const current = await readerA.put(`/api/v1/books/${book.id}/progress`).send({ format: 'epub', progressRatio: .4, revision, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/4)' } })
    expect(current.body.progress.revision).toBe(revision + 1)
    const stale = await readerB.put(`/api/v1/books/${book.id}/progress`).send({ format: 'epub', progressRatio: .2, revision, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/3)' } })
    expect(stale.status).toBe(409); expect((await readerB.get(`/api/v1/books/${book.id}/progress`)).body.progress.progressRatio).toBe(.4)
    await context.agent.put(`/api/v1/books/${book.id}/progress`).send({ format: 'epub', progressRatio: .8, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/8)' } })
    expect((await readerA.get(`/api/v1/books/${book.id}/progress`)).body.progress.progressRatio).toBe(.4)
  })

  it('applies completion, reopen and Continue Reading dismissal rules without deleting the locator', async () => {
    await scannedLibrary(); const book = (await context.agent.get('/api/v1/books?q=Ilha')).body.books[0]
    const completed = await context.agent.put(`/api/v1/books/${book.id}/progress`).send({ format: 'epub', progressRatio: .99, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/10)' } })
    expect(completed.body.progress.completed).toBe(true); expect((await context.agent.get('/api/v1/home')).body.continueReading).toHaveLength(0)
    await context.agent.post(`/api/v1/books/${book.id}/reopen`); expect((await context.agent.get('/api/v1/home')).body.continueReading[0].id).toBe(book.id)
    await context.agent.delete(`/api/v1/books/${book.id}/continue`); expect((await context.agent.get('/api/v1/home')).body.continueReading).toHaveLength(0)
    expect((await context.agent.get(`/api/v1/books/${book.id}/progress`)).body.progress.locator.cfi).toBe('epubcfi(/6/10)')
  })

  it('enforces library access and revokes sessions when a user is disabled', async () => {
    await scannedLibrary(); const protectedBook = (await context.agent.get('/api/v1/books')).body.books[0]
    const created = await context.agent.post('/api/v1/admin/users').send({ username: 'semacesso', displayName: 'Sem acesso', password: 'reader-password-123', role: 'reader', libraryIds: [] })
    const reader = request.agent(context.app); await login(reader, 'semacesso', 'reader-password-123')
    expect((await reader.get('/api/v1/books')).body.books).toHaveLength(0)
    expect((await reader.get(`/api/v1/books/${protectedBook.id}/content`)).status).toBe(404)
    await context.agent.put(`/api/v1/admin/users/${created.body.user.id}`).send({ active: false })
    expect((await reader.get('/api/v1/auth/me')).status).toBe(401)
  })

  it('degrades cleanly when the metadata provider is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await login(context.agent)
    await context.agent.put('/api/v1/admin/metadata/openlibrary').send({ enabled: true, contact: 'admin@example.test' })
    const library = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Principal', path: context.books })).body.library
    const scan = await context.agent.post(`/api/v1/admin/libraries/${library.id}/scan`)
    expect(scan.status).toBe(200); expect((await context.agent.get('/api/v1/books')).body.books).toHaveLength(2)
    const states = (await context.agent.get('/api/v1/admin/metadata/books')).body.books
    expect(states.some((book: any) => book.status === 'error')).toBe(true)
  })

  it('rejects filesystem paths outside configured roots', async () => {
    await login(context.agent)
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-outside-'))
    try { expect((await context.agent.post('/api/v1/admin/libraries').send({ name: 'Outside', path: outside })).status).toBe(400) } finally { await fs.rm(outside, { recursive: true, force: true }) }
  })

  it('enforces mutation origin and login rate limiting', async () => {
    const originRejected = await context.agent.post('/api/v1/auth/login').set('Origin', 'https://attacker.invalid').send({ username: 'admin', password: 'test-password-strong-123' })
    expect(originRejected.status).toBe(403)
    for (let attempt = 0; attempt < 10; attempt++) await context.agent.post('/api/v1/auth/login').send({ username: 'missing', password: 'wrong' })
    expect((await context.agent.post('/api/v1/auth/login').send({ username: 'missing', password: 'wrong' })).status).toBe(429)
  })
})

describe('MVP to Beta migration', () => {
  it('preserves users, catalog and progress while applying additive migrations', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-upgrade-')); const dataDir = path.join(root, 'data'); await fs.mkdir(dataDir)
    const file = path.join(dataDir, 'litera.sqlite'); const legacy = new Database(file)
    legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
    for (let index = 0; index < 2; index++) { legacy.exec(migrations[index]!); legacy.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(index + 1) }
    const user = legacy.prepare(`INSERT INTO users(username,display_name,password_hash,role) VALUES ('admin','Admin',?,'admin')`).run(hashPassword('upgrade-password-123'))
    const library = legacy.prepare(`INSERT INTO libraries(name,path) VALUES ('Books','/books')`).run()
    const book = legacy.prepare(`INSERT INTO books(title,format) VALUES ('Preserved','epub')`).run()
    legacy.prepare(`INSERT INTO book_files(library_id,book_id,identity,relative_path,size,modified_ms,status) VALUES (?,?,?,?,?,?, 'available')`).run(library.lastInsertRowid, book.lastInsertRowid, '1:1', 'book.epub', 10, 1)
    legacy.prepare(`INSERT INTO reading_progress(user_id,book_id,format,progress_ratio,locator_type,locator_payload) VALUES (?,?,?,?,?,?)`).run(user.lastInsertRowid, book.lastInsertRowid, 'epub', .42, 'epub-cfi', JSON.stringify({ type: 'epub-cfi', cfi: 'epubcfi(/6/4)' }))
    legacy.close()
    const config: AppConfig = { port: 0, dataDir, allowedBookRoots: ['/books'], adminUsername: 'ignored', adminPassword: 'ignored-password-123', secureCookies: false, openLibraryEnabled: false, maxBookBytes: 512 * 1024 * 1024 }
    const upgraded = openDatabase(config)
    expect((upgraded.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as any).version).toBe(6)
    expect((upgraded.prepare('SELECT title FROM books').get() as any).title).toBe('Preserved')
    expect((upgraded.prepare('SELECT progress_ratio AS ratio FROM reading_progress').get() as any).ratio).toBe(.42)
    upgraded.close(); await fs.rm(root, { recursive: true, force: true })
  })
})

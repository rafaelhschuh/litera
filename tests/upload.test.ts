import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../src/server/database.js'
import { createScanJob, runScanJob } from '../src/server/jobs.js'
import { writeEpub } from './fixtures.js'
import { login, testContext } from './setup.js'

describe('administrative library uploads', () => {
  let context: Awaited<ReturnType<typeof testContext>>
  let libraryId: number
  beforeEach(async () => {
    context = await testContext()
    await login(context.agent)
    libraryId = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Uploads', path: context.books })).body.library.id
  })
  afterEach(async () => { await context.cleanup() })
  const endpoint = () => `/api/v1/admin/libraries/${libraryId}/upload`
  async function upload(filename: string, content: Buffer) {
    return context.agent.post(endpoint()).query({ filename }).set('Content-Type', 'application/octet-stream').send(content)
  }
  async function finished(jobId: number) {
    await vi.waitFor(() => {
      const row = context.db.prepare('SELECT status FROM scan_jobs WHERE id=?').get(jobId) as any
      expect(row.status).toBe('completed')
    }, { timeout: 15000 })
  }

  it('uploads EPUB and PDF into the selected library, reads them and rescans without changing originals', async () => {
    const epubSource = path.join(context.root, 'new.epub')
    await writeEpub(epubSource, 'Livro enviado')
    const epub = await fs.readFile(epubSource), pdf = await fs.readFile(path.join(context.books, 'caderno.pdf'))
    const original = await fs.readFile(path.join(context.books, 'island.epub'))
    const first = await upload('Enviado.epub', epub)
    expect(first.status).toBe(201); await finished(first.body.job.id)
    const second = await upload('Enviado.pdf', pdf)
    expect(second.status).toBe(201); await finished(second.body.job.id)
    const books = (await context.agent.get('/api/v1/books')).body.books
    expect(books).toHaveLength(4)
    const book = books.find((book: any) => book.title === 'Livro enviado')
    expect((await context.agent.get(`/api/v1/books/${book.id}/epub/manifest`)).body.chapters).toHaveLength(2)
    expect((await context.agent.get(`/api/v1/books/${book.id}/content`)).status).toBe(200)
    const scan = await context.agent.post(`/api/v1/admin/libraries/${libraryId}/scan`)
    expect(scan.body.report).toMatchObject({ added: 0, updated: 0, missing: 0 })
    expect(await fs.readFile(path.join(context.books, 'island.epub'))).toEqual(original)
    expect(await fs.readdir(path.join(context.config.dataDir, 'upload-staging'))).toEqual([])
  })

  it('rejects unauthenticated, reader, cross-origin and mismatched-account writes', async () => {
    const content = await fs.readFile(path.join(context.books, 'island.epub'))
    expect((await request(context.app).post(endpoint()).query({ filename: 'x.epub' }).set('Content-Type', 'application/octet-stream').send(content)).status).toBe(401)
    context.db.prepare(`INSERT INTO users(username,display_name,password_hash,role) VALUES ('reader','Reader',?,'reader')`).run(hashPassword('reader-password-123'))
    const reader = request.agent(context.app)
    await login(reader, 'reader', 'reader-password-123')
    expect((await reader.post(endpoint()).query({ filename: 'x.epub' }).set('Content-Type', 'application/octet-stream').send(content)).status).toBe(403)
    expect((await context.agent.post(endpoint()).query({ filename: 'x.epub' }).set('Origin', 'https://other.example').set('Content-Type', 'application/octet-stream').send(content)).status).toBe(403)
    expect((await context.agent.post(endpoint()).query({ filename: 'x.epub' }).set('X-Litera-User', '999').set('Content-Type', 'application/octet-stream').send(content)).status).toBe(409)
    expect(await fs.readdir(context.books)).toEqual(['caderno.pdf', 'island.epub'])
  })

  it('rejects traversal, invalid, empty, oversized and unsupported files without publishing them', async () => {
    for (const filename of ['../escape.epub', '..\\escape.pdf', '/tmp/book.epub', '.hidden.epub', 'book\u0000.epub']) {
      expect((await upload(filename, Buffer.from('bad'))).status).toBe(400)
    }
    expect((await upload('text.txt', Buffer.from('bad'))).status).toBe(415)
    expect((await upload('broken.epub', Buffer.from('bad'))).status).toBe(422)
    expect((await upload('broken.pdf', Buffer.from('bad'))).status).toBe(422)
    expect((await upload('empty.epub', Buffer.alloc(0))).status).toBe(400)
    context.config.maxBookBytes = 4
    expect((await upload('large.pdf', Buffer.from('too large'))).status).toBe(413)
    expect(await fs.readdir(context.books)).toEqual(['caderno.pdf', 'island.epub'])
    expect(await fs.readdir(path.join(context.config.dataDir, 'upload-staging'))).toEqual([])
  })

  it('never overwrites an existing book or symlink', async () => {
    const original = await fs.readFile(path.join(context.books, 'island.epub'))
    const another = path.join(context.root, 'another.epub'); await writeEpub(another, 'Outro livro')
    const content = await fs.readFile(another)
    expect((await upload('island.epub', content)).status).toBe(409)
    await fs.symlink(path.join(context.books, 'island.epub'), path.join(context.books, 'link.epub'))
    expect((await upload('link.epub', content)).status).toBe(409)
    expect(await fs.readFile(path.join(context.books, 'island.epub'))).toEqual(original)
    expect((await fs.lstat(path.join(context.books, 'link.epub'))).isSymbolicLink()).toBe(true)
  })

  it('enforces the size limit on chunked bodies and cleans staging', async () => {
    context.config.maxBookBytes = 8
    const signedIn = await login(context.agent)
    const cookie = signedIn.headers['set-cookie'][0].split(';')[0]
    const server = context.app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    try {
      const address = server.address() as { port: number }
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: address.port, path: endpoint() + '?filename=chunked.epub', method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
        req.on('error', reject); req.write('123456'); req.end('789012')
      })
      expect(status).toBe(413)
      expect(await fs.readdir(path.join(context.config.dataDir, 'upload-staging'))).toEqual([])
      expect(await fs.readdir(context.books)).toEqual(['caderno.pdf', 'island.epub'])
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('reports read-only destinations without publishing or keeping temporary files', async () => {
    const content = await fs.readFile(path.join(context.books, 'island.epub'))
    await fs.chmod(context.books, 0o555)
    try {
      const result = await upload('readonly.epub', content)
      expect(result.status).toBe(409)
      expect(result.body.error.code).toBe('LIBRARY_READ_ONLY')
      expect(await fs.readdir(path.join(context.config.dataDir, 'upload-staging'))).toEqual([])
    } finally { await fs.chmod(context.books, 0o755) }
  })

  it('cleans an interrupted upload and blocks conflicting library changes while receiving', async () => {
    const signedIn = await login(context.agent)
    const cookie = signedIn.headers['set-cookie'][0].split(';')[0]
    const server = context.app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address() as { port: number }
    const req = http.request({ host: '127.0.0.1', port: address.port, path: endpoint() + '?filename=interrupted.epub', method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' } })
    req.on('error', () => { /* Deliberate interrupted connection. */ })
    try {
      req.write('incomplete EPUB')
      await vi.waitFor(async () => expect(await fs.readdir(path.join(context.config.dataDir, 'upload-staging'))).toHaveLength(1))
      expect((await context.agent.put(`/api/v1/admin/libraries/${libraryId}`).send({ name: 'Moved', path: context.books })).status).toBe(409)
      req.destroy()
      await vi.waitFor(async () => expect(await fs.readdir(path.join(context.config.dataDir, 'upload-staging'))).toEqual([]))
      expect(await fs.readdir(context.books)).toEqual(['caderno.pdf', 'island.epub'])
    } finally { req.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('queues a successor behind a running scan and serializes cataloging', async () => {
    const active = createScanJob(context.db, libraryId)
    context.db.prepare("UPDATE scan_jobs SET status='running' WHERE id=?").run(active.id)
    const content = await fs.readFile(path.join(context.books, 'island.epub'))
    const result = await upload('during-scan.epub', content)
    expect(result.status).toBe(201)
    expect(result.body.job.id).not.toBe(active.id)
    expect((await runScanJob(context.db, context.config, result.body.job.id)).status).toBe('queued')
    context.db.prepare("UPDATE scan_jobs SET status='completed' WHERE id=?").run(active.id)
    await runScanJob(context.db, context.config, result.body.job.id)
    expect((await context.agent.get('/api/v1/books')).body.books).toHaveLength(3)
  })
})

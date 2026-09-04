import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { login, testContext } from './setup.js'

describe('reading synchronization API', () => {
  let context: Awaited<ReturnType<typeof testContext>>
  let bookId: number, libraryId: number
  const progress = (revision: number, ratio = .25) => ({ format: 'epub', progressRatio: ratio, locator: { type: 'epub-cfi', cfi: `epubcfi(/6/${ratio > .5 ? 4 : 2})` }, revision })
  beforeEach(async () => {
    context = await testContext()
    await login(context.agent)
    libraryId = (await context.agent.post('/api/v1/admin/libraries').send({ name: 'Main', path: context.books })).body.library.id
    await context.agent.post(`/api/v1/admin/libraries/${libraryId}/scan`)
    bookId = (await context.agent.get('/api/v1/books?q=Ilha')).body.books[0].id
  })
  afterEach(async () => context.cleanup())

  it('rejects a competing first write, permits moving backwards, preserves legacy without revision', async () => {
    const url = `/api/v1/books/${bookId}/progress`
    const first = await context.agent.put(url).set('X-Litera-User', '1').send(progress(0, .8))
    expect(first.status).toBe(200)
    expect(first.body.progress.revision).toBe(1)
    const stale = await context.agent.put(url).send(progress(0))
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('STALE_PROGRESS')
    const backwards = await context.agent.put(url).send(progress(1, .1))
    expect(backwards.status).toBe(200)
    expect(backwards.body.progress).toMatchObject({ revision: 2, progressRatio: .1 })
    const legacy = { format: 'epub', progressRatio: .3, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)' } }
    expect((await context.agent.put(url).send(legacy)).status).toBe(200)
  })

  it('replays committed progress without another revision and rejects reused operation payloads', async () => {
    const url = `/api/v1/books/${bookId}/progress`, op = randomUUID()
    const first = await context.agent.put(url).set('X-Litera-Operation', op).send(progress(0))
    const retry = await context.agent.put(url).set('X-Litera-Operation', op).send(progress(0))
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual(first.body)
    expect((await context.agent.get(url)).body.progress.revision).toBe(1)
    const reused = await context.agent.put(url).set('X-Litera-Operation', op).send(progress(1, .7))
    expect(reused.status).toBe(409)
    expect(reused.body.error.code).toBe('OPERATION_ID_REUSED')
  })

  it('bounds durable operation receipts while retaining a generous retry window', async () => {
    const insert = context.db.prepare("INSERT INTO sync_operations(user_id,operation_id,request_hash,response_status,response_body) VALUES (1,?,?,200,'{}')")
    context.db.transaction(() => {
      for (let index = 0; index < 2501; index++) insert.run(`old-operation-${String(index).padStart(5, '0')}`, String(index))
    })()
    const response = await context.agent.put(`/api/v1/books/${bookId}/favorite`).set('X-Litera-Operation', randomUUID())
    expect(response.status).toBe(200)
    const count = context.db.prepare('SELECT COUNT(*) AS count FROM sync_operations WHERE user_id=1').get() as { count: number }
    expect(count.count).toBe(2250)
  })

  it('stores highlight receipt durably and cannot recreate it after deletion', async () => {
    const url = `/api/v1/books/${bookId}/highlights`, op = randomUUID()
    const payload = { quoteText: 'Texto selecionado', locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)' } }
    const first = await context.agent.post(url).set('X-Litera-Operation', op).send(payload)
    expect(first.status).toBe(201)
    const retry = await context.agent.post(url).set('X-Litera-Operation', op).send(payload)
    expect(retry.body.highlight.id).toBe(first.body.highlight.id)
    expect((await context.agent.get(url)).body.highlights).toHaveLength(1)
    const deletion = `/api/v1/highlights/${first.body.highlight.id}`, deleteOp = randomUUID()
    expect((await context.agent.delete(deletion).set('X-Litera-Operation', deleteOp)).status).toBe(204)
    expect((await context.agent.delete(deletion).set('X-Litera-Operation', deleteOp)).status).toBe(204)
    expect((await context.agent.delete(deletion)).status).toBe(204)
    expect((await context.agent.post(url).set('X-Litera-Operation', op).send(payload)).body).toEqual(first.body)
    expect((await context.agent.get(url)).body.highlights).toHaveLength(0)
    expect((context.db.prepare('SELECT count(*) AS count FROM sync_operations').get() as { count: number }).count).toBe(2)
  })

  it('binds protected GET and mutation to the expected session user and scopes receipts', async () => {
    const created = await context.agent.post('/api/v1/admin/users').send({ username: 'other', displayName: 'Other', password: 'other-password-123', role: 'reader', libraryIds: [libraryId] })
    const otherId = created.body.user.id
    const other = request.agent(context.app)
    await login(other, 'other', 'other-password-123')
    const url = `/api/v1/books/${bookId}/highlights`, op = randomUUID(), payload = { quoteText: 'Privado', locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)' } }
    await context.agent.post(url).set('X-Litera-Operation', op).send(payload)
    expect((await other.get(`/api/v1/books/${bookId}`).set('X-Litera-User', '1')).status).toBe(409)
    expect((await other.post(url).set('X-Litera-User', '1').set('X-Litera-Operation', op).send(payload)).status).toBe(409)
    expect((await other.get(url)).body.highlights).toHaveLength(0)
    const own = await other.post(url).set('X-Litera-User', String(otherId)).set('X-Litera-Operation', op).send(payload)
    expect(own.status).toBe(201)
    expect((await other.get(url)).body.highlights).toHaveLength(1)
    expect((await request(context.app).get(url).set('X-Litera-User', String(otherId))).status).toBe(401)
  })

  it('an old favorite replay does not undo a later removal', async () => {
    const url = `/api/v1/books/${bookId}/favorite`, op = randomUUID()
    expect((await context.agent.put(url).set('X-Litera-Operation', op)).status).toBe(200)
    await context.agent.delete(url).set('X-Litera-Operation', randomUUID())
    await context.agent.put(url).set('X-Litera-Operation', op)
    expect((await context.agent.get(`/api/v1/books/${bookId}`)).body.book.favorite).toBe(false)
  })

  it('detects live source revisions before rescan and keeps missing assets out of the SPA', async () => {
    const url = `/api/v1/books/${bookId}`
    const before = (await context.agent.get(url)).body.book
    expect(before.fileRevision).toMatch(/^[a-f0-9]{64}$/)
    expect((await context.agent.get('/api/v1/books?q=Ilha')).body.books[0].fileRevision).toBe(before.fileRevision)
    expect((await context.agent.get(url)).body.book.fileRevision).toBe(before.fileRevision)
    await fs.appendFile(path.join(context.books, 'island.epub'), 'changed')
    const after = (await context.agent.get(url)).body.book
    expect(after.fileRevision).not.toBe(before.fileRevision)
    expect(after.fileSize).toBe(before.fileSize + 7)
    const asset = await context.agent.get('/assets/does-not-exist.js')
    expect(asset.status).toBe(404)
    expect(asset.headers['content-security-policy']).toContain("font-src 'self' blob:")
    expect(asset.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline' blob:")
    expect(asset.text).not.toContain('<div id="app"')
  })
})

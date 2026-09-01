import path from 'node:path'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assessPdfAdaptation, structurePdfText } from '../src/shared/pdf-reflow.js'
import { writeFidelityPdf } from './fixtures.js'
import { login, testContext } from './setup.js'

describe('document fidelity and delivery', () => {
  let context: Awaited<ReturnType<typeof testContext>>
  beforeEach(async () => { context = await testContext() })
  afterEach(async () => { await context.cleanup() })
  it('retains all text and crops illustrations without duplicating the page', async () => {
    await writeFidelityPdf(path.join(context.books, 'fidelity.pdf'), 8 * 1024 * 1024)
    await login(context.agent)
    const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Fidelity', path: context.books })
    await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
    const book = (await context.agent.get('/api/v1/books?q=Fidelidade')).body.books[0]
    const page = (await context.agent.get(`/api/v1/books/${book.id}/pdf/reflow?page=1`)).body
    const text = page.blocks.flatMap((block: any) => block.spans.map((span: any) => span.text)).join(' ')
    expect(text).toContain('INICIO:'); expect(text).toContain('MEIO:'); expect(text).toContain('FINAL: capacidade de continuar o paragrafo completo.')
    expect(page.adaptation).toMatchObject({ safe: true, coverageRatio: 1 })
    const image = (await context.agent.get(`/api/v1/books/${book.id}/pdf/reflow?page=2`)).body
    expect(image.adaptation).toMatchObject({ safe: true, textComplete: true, needsVisualReference: false, hasGraphics: true, coverageRatio: 1 })
    expect(image.figures).toHaveLength(1)
    expect(image.figures[0].crop[2]).toBeLessThan(.4)
    expect(image.figures[0].crop[3]).toBeLessThan(.3)
    const cropped = await context.agent.get(`/api/v1/books/${book.id}/pdf/page-image?page=2&crop=${image.figures[0].crop.join(',')}`)
    const dimensions = await sharp(cropped.body).metadata()
    expect(dimensions.width).toBeLessThan(400); expect(dimensions.height).toBeLessThan(400)
    expect((await context.agent.get(`/api/v1/books/${book.id}/pdf/page-image?page=2&crop=0,0,-1,1`)).status).toBe(400)
    const visual = await context.agent.get(`/api/v1/books/${book.id}/pdf/page-image?page=2`)
    expect(visual.status).toBe(200); expect(visual.headers['content-type']).toContain('image/png'); expect(visual.body.length).toBeGreaterThan(100)
    const bytes = await fs.readFile(path.join(context.books, 'fidelity.pdf'))
    const url = `/api/v1/books/${book.id}/content`
    const ranged = await context.agent.get(url).set('Range', 'bytes=10-29')
    expect(ranged.headers['cache-control']).toBe('private, no-cache'); expect(ranged.status).toBe(206); expect(ranged.headers['content-range']).toBe(`bytes 10-29/${bytes.length}`)
    expect(ranged.headers['content-type']).toContain('application/pdf'); expect(ranged.headers['content-length']).toBe('20')
    const suffix = await context.agent.get(url).set('Range', 'bytes=-20')
    expect(suffix.status).toBe(206); expect(suffix.headers['content-range']).toBe(`bytes ${bytes.length - 20}-${bytes.length - 1}/${bytes.length}`)
    expect((await context.agent.get(url).set('Range', `bytes=${bytes.length}-`)).status).toBe(416)
    expect((await context.agent.get(url).set('Range', 'bytes=0-1,4-5')).status).toBe(200)
  })
  it('keeps diagrams composed of separate thin strokes', async () => {
    await writeFidelityPdf(path.join(context.books, 'lines.pdf'), 0, true)
    await login(context.agent)
    const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Lines', path: context.books })
    await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
    const book = (await context.agent.get('/api/v1/books?q=Fidelidade')).body.books[0]
    const page = (await context.agent.get(`/api/v1/books/${book.id}/pdf/reflow?page=2`)).body
    expect(page.figures).toHaveLength(1)
    expect(page.figures[0].crop[2]).toBeGreaterThan(.28)
    expect(page.figures[0].crop[3]).toBeGreaterThan(.22)
  })
  it('detects lost or unmapped text without attaching a duplicate page', () => {
    const items = [{ str: 'top', transform: [12, 0, 0, 12, 40, 790] }, { str: 'bottom', transform: [12, 0, 0, 12, 40, 10] }]
    const blocks = structurePdfText(items, {}, 612, 792)
    expect(assessPdfAdaptation(items, blocks, false).safe).toBe(true)
    expect(assessPdfAdaptation(items, blocks.slice(1), false)).toMatchObject({ safe: false, textComplete: false, needsVisualReference: false })
    expect(assessPdfAdaptation(items, blocks, true)).toMatchObject({ safe: true, textComplete: true, needsVisualReference: false })
    const broken = [{ str: '\uFFFD\uE000' }]
    expect(assessPdfAdaptation(broken, structurePdfText(broken), false)).toMatchObject({ safe: false, invalidUnicode: true })
    const columns = [{ str: 'left', width: 25, transform: [12, 0, 0, 12, 40, 790] }, { str: 'right', width: 25, transform: [12, 0, 0, 12, 340, 790] }]
    expect(assessPdfAdaptation(columns, structurePdfText(columns), false).textComplete).toBe(true)
    expect(assessPdfAdaptation([...items].reverse(), blocks, false).textComplete).toBe(true)
    expect(assessPdfAdaptation([{ str: 'top', transform: [0, 12, -12, 0, 40, 790] }], blocks, false).safe).toBe(false)
  })
})

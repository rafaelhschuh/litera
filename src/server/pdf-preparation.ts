import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { assessPdfAdaptation, structurePdfText } from '../shared/pdf-reflow.js'
import { preparePdfText } from './pdf-text.js'
import { isPdfGraphic, pdfFigures } from './pdf-figures.js'

const pdfRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const pending = new Map<string, Promise<void>>()
const version = '1'

export async function preparedPdfDirectory(file: string, dataDir: string): Promise<string> {
  const stat = await fs.stat(file)
  const key = createHash('sha256').update(JSON.stringify([version, file, stat.size, stat.mtimeMs])).digest('hex')
  return path.join(dataDir, 'pdf-prepared', key)
}
async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true } catch { return false }
}
async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  const temporary = file + '.' + randomUUID() + '.tmp'
  try { await fs.writeFile(temporary, data); await fs.rename(temporary, file) }
  finally { await fs.rm(temporary, { force: true }) }
}

// A scan opens each PDF once. Each completed page is atomic and reusable after
// interruption. Requests for old libraries can prepare a missing page on demand.
export async function preparePdf(file: string, dataDir: string, requestedPage?: number): Promise<void> {
  const directory = await preparedPdfDirectory(file, dataDir)
  const target = requestedPage ? path.join(directory, requestedPage + '.json') : path.join(directory, 'complete.json')
  if (await exists(target)) return
  const pendingKey = directory + (requestedPage ? ":" + requestedPage : "")
  const running = pending.get(pendingKey)
  if (running) { await running; return preparePdf(file, dataDir, requestedPage) }
  const work = (async () => {
    await fs.mkdir(directory, { recursive: true })
    const task = getDocument({ data: new Uint8Array(await fs.readFile(file)), useSystemFonts: false,
      fontExtraProperties: true, standardFontDataUrl: path.join(pdfRoot, 'standard_fonts') + path.sep,
      cMapUrl: path.join(pdfRoot, 'cmaps') + path.sep, cMapPacked: true })
    try {
      const document = await task.promise
      const first = requestedPage ? Math.min(document.numPages, requestedPage) : 1
      const last = requestedPage ? first : document.numPages
      for (let number = first; number <= last; number++) {
        const output = path.join(directory, number + '.json')
        if (await exists(output)) continue
        const page = await document.getPage(number)
        const content = await page.getTextContent()
        const operators = await page.getOperatorList()
        const viewport = page.getViewport({ scale: 1 })
        const styles = { ...content.styles } as Record<string, any>
        for (const item of content.items as any[]) {
          if (!item.fontName || styles[item.fontName]?.sourceName) continue
          try {
            const font = page.commonObjs.get(item.fontName)
            styles[item.fontName] = { ...styles[item.fontName], sourceName: [font?.name, font?.fallbackName].filter(Boolean).join(' ') }
          } catch { /* retain PDF.js style when a font is unavailable */ }
        }
        const text = await preparePdfText(page, content.items as any[], async data => {
          const asset = 'font-' + createHash('sha256').update(data).digest('hex') + '.ttf'
          if (!await exists(path.join(directory, asset))) await atomicWrite(path.join(directory, asset), data)
          return asset
        })
        const items = text.items
        const tokenBlocks = structurePdfText(items, styles, viewport.width, viewport.height)
        const blocks = text.restoreBlocks(tokenBlocks)
        const hasGraphics = operators.fnArray.some((op, index) => isPdfGraphic(op, operators.argsArray[index]))
        const adaptation = assessPdfAdaptation(items, tokenBlocks, hasGraphics)
        const figures = await pdfFigures(page, blocks, async (data, index) => {
          const asset = number + '-' + index + '.png'
          await atomicWrite(path.join(directory, asset), data)
          return asset
        })
        await atomicWrite(output, JSON.stringify({ page: number, pageCount: document.numPages, blocks, figures, adaptation }))
        page.cleanup()
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      if (!requestedPage) await atomicWrite(path.join(directory, 'complete.json'), JSON.stringify({ pageCount: document.numPages }))
      await atomicWrite(path.join(directory, 'metadata.json'), JSON.stringify({ pageCount: document.numPages }))
    } finally { await task.destroy() }
  })()
  pending.set(pendingKey, work)
  try { await work } finally { pending.delete(pendingKey) }
}

export async function readPreparedPdfPage(file: string, dataDir: string, requestedPage: number): Promise<any> {
  const directory = await preparedPdfDirectory(file, dataDir)
  let page = requestedPage
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'))
    page = Math.min(page, metadata.pageCount)
  } catch { /* old libraries prepare their first requested page below */ }
  let cached = true
  if (!await exists(path.join(directory, page + '.json'))) {
    cached = false
    await preparePdf(file, dataDir, page)
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'))
    page = Math.min(page, metadata.pageCount)
  }
  return { ...JSON.parse(await fs.readFile(path.join(directory, page + '.json'), 'utf8')), cached }
}

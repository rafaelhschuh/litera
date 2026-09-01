import { createCanvas } from '@napi-rs/canvas'
import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfReflowBlock, PdfReflowFigure } from '../shared/pdf-reflow.js'

const pdfGraphicsOperations = new Set(Object.entries(OPS).filter(([name]) => /^(?:paint(?:Image|InlineImage|SolidColorImage)|shadingFill$|constructPath$)/.test(name)).map(([, value]) => value))

// A constructPath ending in endPath only defines clipping; it paints nothing.
export function isPdfGraphic(operation: number, args: any[]): boolean {
  return pdfGraphicsOperations.has(operation) && (operation !== OPS.constructPath || args[0] !== OPS.endPath)
}

// PDF.js records clipped paint bounds in normalized, top-left canvas coordinates.
// Keep those bounds server-owned; the image route validates every requested crop.
export async function pdfFigures(page: PDFPageProxy, blocks: PdfReflowBlock[], store?: (data: Buffer, index: number) => Promise<string>): Promise<PdfReflowFigure[]> {
  const operations = await page.getOperatorList()
  if (!operations.fnArray.some((op, index) => isPdfGraphic(op, operations.argsArray[index]))) return []
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(1, 1000 / Math.max(base.width, base.height)) })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await page.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport, recordOperations: true }).promise
  const bounds = page.recordedBBoxes
  const regions: Array<[number, number, number, number]> = []
  for (let index = 0; index < operations.fnArray.length; index++) {
    if (!isPdfGraphic(operations.fnArray[index]!, operations.argsArray[index]) || !bounds || bounds.isEmpty(index)) continue
    const box: [number, number, number, number] = [Math.max(0, bounds.minX(index)), Math.max(0, bounds.minY(index)), Math.min(1, bounds.maxX(index)), Math.min(1, bounds.maxY(index))]
    const width = box[2] - box[0], height = box[3] - box[1]
    // Ignore page-sized vector backgrounds, but retain full-sized illustrations.
    if ((operations.fnArray[index] === OPS.constructPath && width * height > .85) || width <= 0 || height <= 0) continue
    regions.push(box)
  }
  // Merge overlapping paint operations belonging to the same diagram.
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i]!, b = regions[j]!
      if (a[0] <= b[2] + .01 && a[2] + .01 >= b[0] && a[1] <= b[3] + .01 && a[3] + .01 >= b[1]) {
        regions[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
        regions.splice(j, 1); i = -1; break
      }
    }
  }
  const figures = regions.filter(box => (box[2] - box[0]) * base.width >= 3 && (box[3] - box[1]) * base.height >= 3).sort((a, b) => a[1] - b[1]).map(box => {
    let afterBlock = -1
    blocks.forEach((block, index) => {
      const top = base.convertToViewportPoint(0, block.sourceY ?? 0)[1]! / base.height
      if (top < box[1]) afterBlock = index
    })
    return { afterBlock, crop: [box[0], box[1], box[2] - box[0], box[3] - box[1]] as [number, number, number, number] }
  })
  if (!store || !figures.length) return figures
  // Retain graphics state and clipping, but never bake body text into an image.
  const textPaint = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText])
  await page.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport,
    operationsFilter: index => !textPaint.has(operations.fnArray[index]!) }).promise
  return Promise.all(figures.map(async (figure, index) => {
    const [left, top, w, h] = figure.crop
    const x = Math.floor(left * canvas.width), y = Math.floor(top * canvas.height)
    const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(w * canvas.width)))
    const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(h * canvas.height)))
    const crop = createCanvas(width, height)
    crop.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height)
    return { ...figure, width, height, asset: await store(crop.toBuffer('image/png'), index) }
  }))
}

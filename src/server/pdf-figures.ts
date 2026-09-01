import { createCanvas } from '@napi-rs/canvas'
import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfReflowBlock, PdfReflowFigure } from '../shared/pdf-reflow.js'

export const pdfGraphicsOperations = new Set(Object.entries(OPS).filter(([name]) => /paint|shadingFill|constructPath/i.test(name)).map(([, value]) => value))

// PDF.js records clipped paint bounds in normalized, top-left canvas coordinates.
// Keep those bounds server-owned; the image route validates every requested crop.
export async function pdfFigures(page: PDFPageProxy, blocks: PdfReflowBlock[]): Promise<PdfReflowFigure[]> {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(1, 1000 / Math.max(base.width, base.height)) })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await page.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport, recordOperations: true }).promise
  const operations = await page.getOperatorList(), bounds = page.recordedBBoxes
  const regions: Array<[number, number, number, number]> = []
  for (let index = 0; index < operations.fnArray.length; index++) {
    if (!pdfGraphicsOperations.has(operations.fnArray[index]!) || !bounds || bounds.isEmpty(index)) continue
    const box: [number, number, number, number] = [Math.max(0, bounds.minX(index)), Math.max(0, bounds.minY(index)), Math.min(1, bounds.maxX(index)), Math.min(1, bounds.maxY(index))]
    const width = box[2] - box[0], height = box[3] - box[1]
    // Page backgrounds / searchable scan backdrops must not duplicate the text.
    if (width * height > .85 || width <= 0 || height <= 0) continue
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
  return regions.filter(box => (box[2] - box[0]) * base.width >= 3 && (box[3] - box[1]) * base.height >= 3).sort((a, b) => a[1] - b[1]).map(box => {
    let afterBlock = -1
    blocks.forEach((block, index) => {
      const top = base.convertToViewportPoint(0, block.sourceY ?? 0)[1]! / base.height
      if (top < box[1]) afterBlock = index
    })
    return { afterBlock, crop: [box[0], box[1], box[2] - box[0], box[3] - box[1]] }
  })
}

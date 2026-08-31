export type PdfZoomMode = 'manual' | 'fit-width' | 'fit-page'
export type PdfReaderMode = 'visual' | 'reflow'

export function usesTwoPageSpread(width: number, height: number): boolean {
  return width >= 1024 && width / Math.max(1, height) >= 1.25
}

export function usesTwoPageSpreadAtZoom(width: number, height: number, pageWidth: number, zoom: number, gap = 24): boolean {
  return usesTwoPageSpread(width, height) && pageWidth > 0 && zoom > 0 && pageWidth * zoom * 2 + gap <= width
}

export function pdfSpreadPages(currentPage: number, pageCount: number, twoPage: boolean): number[] {
  const first = Math.min(Math.max(1, currentPage), Math.max(1, pageCount))
  if (!twoPage || first >= pageCount) return [first]
  return [first, first + 1]
}

export function movePdfSpread(currentPage: number, pageCount: number, delta: number, twoPage: boolean): number {
  const step = twoPage ? 2 : 1
  return Math.min(Math.max(1, pageCount), Math.max(1, currentPage + Math.sign(delta) * step))
}

export function resolvePdfReaderMode(queryMode: unknown, savedLocatorType?: string): PdfReaderMode {
  if (queryMode === 'pdf') return 'visual'
  if (queryMode === 'epub') return 'reflow'
  return savedLocatorType === 'pdf-reflow' ? 'reflow' : 'visual'
}

export function fitPdfScale(
  page: { width: number; height: number },
  viewport: { width: number; height: number },
  mode: Exclude<PdfZoomMode, 'manual'>,
): number {
  if (page.width <= 0 || page.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  const widthScale = viewport.width / page.width
  return mode === 'fit-width' ? widthScale : Math.min(widthScale, viewport.height / page.height)
}

export class RenderGeneration {
  private current = 0
  private cancelCurrent: (() => void) | undefined

  begin(cancel: () => void): number {
    this.cancelCurrent?.()
    this.cancelCurrent = cancel
    this.current += 1
    return this.current
  }

  isCurrent(generation: number): boolean {
    return generation === this.current
  }

  finish(generation: number): void {
    if (this.isCurrent(generation)) this.cancelCurrent = undefined
  }

  cancel(): void {
    this.cancelCurrent?.()
    this.cancelCurrent = undefined
    this.current += 1
  }
}

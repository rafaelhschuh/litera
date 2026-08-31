export type BookFormat = 'epub' | 'pdf'

export type EpubLocator = {
  type: 'epub-cfi'
  cfi: string
  chapterHref?: string
  elementIndex?: number
  offset?: number
}

export type PdfLocator = {
  type: 'pdf-page' | 'pdf-reflow'
  page: number
  offset?: number
}

export type ReadingLocator = EpubLocator | PdfLocator

export function normalizeProgress(format: BookFormat, locator: ReadingLocator, ratio: number, pageCount?: number): { locator: ReadingLocator; progressRatio: number } {
  const progressRatio = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  if (format === 'epub') {
    if (locator.type !== 'epub-cfi' || !locator.cfi.trim()) throw new Error('EPUB progress requires a CFI locator')
    return { locator: { ...locator, cfi: locator.cfi.trim() }, progressRatio }
  }
  if (locator.type !== 'pdf-page' && locator.type !== 'pdf-reflow') throw new Error('PDF progress requires a page locator')
  const maximum = Math.max(1, pageCount ?? Number.MAX_SAFE_INTEGER)
  return { locator: { type: locator.type, page: Math.min(maximum, Math.max(1, Math.round(locator.page))), offset: locator.offset }, progressRatio }
}

export function pdfProgress(page: number, pageCount: number): number {
  if (pageCount <= 1) return page > 0 ? 1 : 0
  return Math.min(1, Math.max(0, (page - 1) / (pageCount - 1)))
}

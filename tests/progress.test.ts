import { describe, expect, it } from 'vitest'
import { normalizeProgress, pdfProgress } from '../src/shared/progress.js'
import { readerTapZone } from '../src/shared/reader.js'

describe('format-aware progress', () => {
  it('keeps an EPUB semantic locator and clamps display progress', () => {
    expect(normalizeProgress('epub', { type: 'epub-cfi', cfi: ' epubcfi(/6/4) ', chapterHref: 'c2.xhtml' }, 1.4)).toEqual({ locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/4)', chapterHref: 'c2.xhtml' }, progressRatio: 1 })
  })
  it('keeps PDF page location independently from its derived ratio', () => {
    expect(normalizeProgress('pdf', { type: 'pdf-page', page: 99 }, .5, 12).locator).toEqual({ type: 'pdf-page', page: 12, offset: undefined })
    expect(pdfProgress(3, 5)).toBe(.5)
  })
  it('rejects a locator from another format', () => {
    expect(() => normalizeProgress('epub', { type: 'pdf-page', page: 2 }, .2)).toThrow()
  })
})

describe('mobile reader tap zones', () => {
  it('reserves the middle sixty percent for reader chrome', () => {
    expect(readerTapZone(10, 300)).toBe('previous')
    expect(readerTapZone(45, 300)).toBe('center')
    expect(readerTapZone(70, 300)).toBe('center')
    expect(readerTapZone(150, 300)).toBe('center')
    expect(readerTapZone(255, 300)).toBe('center')
    expect(readerTapZone(290, 300)).toBe('next')
  })
})

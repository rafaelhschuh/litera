import { describe, expect, it, vi } from 'vitest'
import { fitPdfScale, movePdfSpread, pdfSpreadPages, RenderGeneration, resolvePdfReaderMode, usesTwoPageSpread, usesTwoPageSpreadAtZoom } from '../src/shared/pdf-reader.js'
import { structurePdfText } from '../src/shared/pdf-reflow.js'
import { classifyReaderGesture } from '../src/shared/reader-interaction.js'
import { normalizeProgress } from '../src/shared/progress.js'
import { QueuedProgressSaver } from '../src/web/lib/reader-progress.js'
import { findTextHighlightRanges } from '../src/shared/text-highlights.js'

describe('reader gesture classification', () => {
  it('distinguishes taps, horizontal swipes and vertical/diagonal scrolls', () => {
    expect(classifyReaderGesture({ deltaX: 4, deltaY: 5, durationMs: 180 })).toBe('tap')
    expect(classifyReaderGesture({ deltaX: -80, deltaY: 12, durationMs: 220 })).toBe('swipe-next')
    expect(classifyReaderGesture({ deltaX: 24, deltaY: 90, durationMs: 240 })).toBe('scroll')
    expect(classifyReaderGesture({ deltaX: 55, deltaY: 48, durationMs: 220 })).toBe('scroll')
  })

  it('gives selection, pinch and zoomed panning priority over navigation', () => {
    expect(classifyReaderGesture({ deltaX: -90, deltaY: 0, durationMs: 200, selecting: true })).toBe('none')
    expect(classifyReaderGesture({ deltaX: -90, deltaY: 0, durationMs: 200, pinching: true })).toBe('none')
    expect(classifyReaderGesture({ deltaX: -90, deltaY: 0, durationMs: 200, panning: true })).toBe('pan')
  })
})

describe('reader state coordinators', () => {
  it('cancels an older PDF generation and rejects its stale completion', () => {
    const coordinator = new RenderGeneration()
    const cancelFirst = vi.fn(); const cancelSecond = vi.fn()
    const first = coordinator.begin(cancelFirst); const second = coordinator.begin(cancelSecond)
    expect(cancelFirst).toHaveBeenCalledOnce()
    expect(coordinator.isCurrent(first)).toBe(false)
    expect(coordinator.isCurrent(second)).toBe(true)
    coordinator.cancel()
    expect(cancelSecond).toHaveBeenCalledOnce()
  })

  it('keeps fit modes distinct from manual zoom calculations', () => {
    expect(fitPdfScale({ width: 600, height: 800 }, { width: 300, height: 300 }, 'fit-width')).toBe(.5)
    expect(fitPdfScale({ width: 600, height: 800 }, { width: 300, height: 300 }, 'fit-page')).toBe(.375)
  })

  it('lets an explicit PDF mode override stale adapted progress', () => {
    expect(resolvePdfReaderMode('pdf', 'pdf-reflow')).toBe('visual')
    expect(resolvePdfReaderMode('epub', 'pdf-page')).toBe('reflow')
    expect(resolvePdfReaderMode(undefined, 'pdf-reflow')).toBe('reflow')
  })

  it('moves through a two-page PDF spread without skipping the final page', () => {
    expect(usesTwoPageSpread(1440, 900)).toBe(true)
    expect(usesTwoPageSpread(900, 1440)).toBe(false)
    expect(usesTwoPageSpread(844, 390)).toBe(false)
    expect(usesTwoPageSpreadAtZoom(1440, 900, 600, 1)).toBe(true)
    expect(usesTwoPageSpreadAtZoom(1440, 900, 600, 1.2)).toBe(false)
    expect(pdfSpreadPages(3, 8, true)).toEqual([3, 4])
    expect(pdfSpreadPages(8, 8, true)).toEqual([8])
    expect(movePdfSpread(3, 8, 1, true)).toBe(5)
    expect(movePdfSpread(7, 8, 1, true)).toBe(8)
    expect(movePdfSpread(3, 8, -1, true)).toBe(1)
    expect(movePdfSpread(3, 8, 1, false)).toBe(4)
  })

  it('serializes progress saves and keeps only the latest pending locator', async () => {
    const saved: number[] = []
    let release: (() => void) | undefined
    const queue = new QueuedProgressSaver<number>(async value => {
      saved.push(value)
      if (value === 1) await new Promise<void>(resolve => { release = resolve })
    }, 10)
    queue.schedule(1)
    const flushing = queue.flush()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    queue.schedule(2); queue.schedule(3); release!()
    await flushing
    expect(saved).toEqual([1, 3])
  })

  it('preserves a semantic position inside a long EPUB chapter', () => {
    const result = normalizeProgress('epub', { type: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/18)', chapterHref: 'c2.xhtml', elementIndex: 8, offset: 14 }, .42)
    expect(result.locator).toMatchObject({ chapterHref: 'c2.xhtml', elementIndex: 8, offset: 14 })
  })
})

describe('PDF adapted reading structure', () => {
  it('keeps heading hierarchy, alignment and inline emphasis', () => {
    const blocks = structurePdfText([
      { str: 'A história do livro', fontName: 'Title-Bold', transform: [24, 0, 0, 24, 180, 720], width: 240, hasEOL: true },
      { str: 'Um texto', fontName: 'Body-Regular', transform: [12, 0, 0, 12, 72, 680], width: 52 },
      { str: 'importante', fontName: 'Body-BoldItalic', transform: [12, 0, 0, 12, 126, 680], width: 62, hasEOL: true },
    ], {}, 600)

    expect(blocks[0]).toMatchObject({ kind: 'h1', align: 'center' })
    expect(blocks[1]).toMatchObject({ kind: 'p', spans: [
      { text: 'Um texto', bold: false, italic: false },
      { text: ' importante', bold: true, italic: true },
    ] })
  })

  it('removes small running headers and footers without removing page titles', () => {
    const blocks = structurePdfText([
      { str: 'Livro · 12', fontName: 'Body', transform: [10, 0, 0, 10, 40, 790], width: 70, hasEOL: true },
      { str: 'Título do capítulo', fontName: 'Title-Bold', transform: [24, 0, 0, 24, 120, 700], width: 240, hasEOL: true },
      { str: 'Texto principal', fontName: 'Body', transform: [12, 0, 0, 12, 70, 650], width: 90, hasEOL: true },
      { str: 'Editora', fontName: 'Body', transform: [10, 0, 0, 10, 250, 20], width: 45, hasEOL: true },
    ], {}, 500, 800)

    expect(blocks.map(block => block.spans.map(span => span.text).join(''))).toEqual(['Título do capítulo', 'Texto principal'])
  })
})

describe('saved highlight matching', () => {
  it('marks only the exact quote across renderer text chunks', () => {
    expect(findTextHighlightRanges(['Texto anterior sem relação. ', 'Trecho realmente ', 'selecionado. Texto posterior.'], 'Trecho realmente selecionado.')).toEqual([
      { chunkIndex: 1, start: 0, end: 17 },
      { chunkIndex: 2, start: 0, end: 12 },
    ])
  })

  it('uses the EPUB locator to choose the closest repeated quote', () => {
    expect(findTextHighlightRanges(['Repetido', 'Outro texto', 'Repetido'], 'Repetido', 2)).toEqual([
      { chunkIndex: 2, start: 0, end: 8 },
    ])
  })
})

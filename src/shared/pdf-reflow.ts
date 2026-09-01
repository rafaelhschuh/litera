export type PdfReflowSpan = { text: string; bold: boolean; italic: boolean }
export type PdfReflowBlock = {
  kind: 'h1' | 'h2' | 'p'
  align: 'left' | 'center'
  spaced: boolean
  spans: PdfReflowSpan[]
}

type PdfTextItem = {
  str?: string
  fontName?: string
  transform?: number[]
  width?: number
  height?: number
  hasEOL?: boolean
}

type PdfTextStyle = { fontFamily?: string; sourceName?: string }

type ReflowLine = {
  y: number
  x: number
  width: number
  fontSize: number
  spans: PdfReflowSpan[]
}

function fontSize(item: PdfTextItem): number {
  const transform = item.transform ?? []
  return Math.max(1, Math.abs(transform[3] ?? 0), Math.abs(transform[0] ?? 0), Math.abs(item.height ?? 0))
}

function median(values: number[]): number {
  if (!values.length) return 1
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 1
}

function appendSpan(spans: PdfReflowSpan[], span: PdfReflowSpan) {
  const previous = spans[spans.length - 1]
  if (previous && previous.bold === span.bold && previous.italic === span.italic) previous.text += span.text
  else spans.push(span)
}

function readableText(raw: string, previous: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (!previous || /^[-–—,.;:!?%)\]}]/.test(text) || /[-–—([{/]$/.test(previous)) return text
  return ` ${text}`
}

export function structurePdfText(items: PdfTextItem[], styles: Record<string, PdfTextStyle> = {}, pageWidth = 1, _pageHeight = 0): PdfReflowBlock[] {
  const meaningful = items.filter(item => item.str?.trim())
  const bodySize = median(meaningful.map(fontSize))
  const lines: ReflowLine[] = []
  let line: ReflowLine | undefined

  for (const item of items) {
    const raw = item.str ?? ''
    const size = fontSize(item)
    const x = item.transform?.[4] ?? 0
    const y = item.transform?.[5] ?? line?.y ?? 0
    const startsNewLine = Boolean(line && Math.abs(line.y - y) > Math.max(2, Math.min(line.fontSize, size) * .45))
    if (!line || startsNewLine) {
      if (line?.spans.length) lines.push(line)
      line = { y, x, width: 0, fontSize: size, spans: [] }
    }

    const style = styles[item.fontName ?? '']
    const styleName = `${item.fontName ?? ''} ${style?.fontFamily ?? ''} ${style?.sourceName ?? ''}`
    const previousText = line.spans.map(span => span.text).join('')
    const text = readableText(raw, previousText)
    if (text) appendSpan(line.spans, { text, bold: /bold|black|heavy|semi|demi/i.test(styleName), italic: /italic|oblique/i.test(styleName) })
    line.x = Math.min(line.x, x)
    line.width += Math.max(0, item.width ?? 0)
    line.fontSize = Math.max(line.fontSize, size)
    if (item.hasEOL && line.spans.length) { lines.push(line); line = undefined }
  }
  if (line?.spans.length) lines.push(line)

  const contentLines = lines

  return contentLines.map((current, index) => {
    const text = current.spans.map(span => span.text).join('').trim()
    const scale = current.fontSize / Math.max(1, bodySize)
    const predominantlyBold = current.spans.some(span => span.bold)
    const kind = text.length <= 140 && scale >= 1.6 ? 'h1' : text.length <= 120 && (scale >= 1.28 || (predominantlyBold && scale >= 1.08)) ? 'h2' : 'p'
    const center = current.x + current.width / 2
    const align = kind !== 'p' && current.width < pageWidth * .86 && Math.abs(center - pageWidth / 2) < pageWidth * .12 ? 'center' : 'left'
    const previous = contentLines[index - 1]
    const verticalGap = previous ? Math.abs(previous.y - current.y) : 0
    return { kind, align, spaced: Boolean(previous && verticalGap > Math.max(previous.fontSize, current.fontSize) * 1.75), spans: current.spans }
  })
}

// Whitespace is presentation; every other character must survive adaptation.
export function assessPdfAdaptation(items: PdfTextItem[], blocks: PdfReflowBlock[], hasGraphics: boolean) {
  const normalize = (text: string) => text.replace(/\s+/g, '')
  const source = items.filter(item => item.str?.trim())
  const original = normalize(source.map(item => item.str).join(''))
  const rendered = normalize(blocks.flatMap(block => block.spans.map(span => span.text)).join(''))
  const rotated = source.some(item => Math.abs(item.transform?.[1] ?? 0) > .01 || Math.abs(item.transform?.[2] ?? 0) > .01)
  // Upward jumps in extraction order can indicate columns or positioned fragments.
  const fragmented = source.some((item, index) => {
    const previous = source[index - 1]; if (!previous) return false
    const sameLine = Math.abs((item.transform?.[5] ?? 0) - (previous.transform?.[5] ?? 0)) < 2
    const gap = (item.transform?.[4] ?? 0) - (previous.transform?.[4] ?? 0) - (previous.width ?? 0)
    return sameLine && (gap > fontSize(item) * 4 || gap < -fontSize(item))
  })
  const uncertainOrder = source.some((item, index) => index > 0 && (item.transform?.[5] ?? 0) > (source[index - 1]?.transform?.[5] ?? 0) + Math.max(4, fontSize(item)))
  return {
    safe: original.length > 0 && original === rendered && !hasGraphics && !rotated && !uncertainOrder && !fragmented,
    sourceTextItems: source.length, renderedTextItems: blocks.reduce((count, block) => count + block.spans.length, 0),
    sourceCharacterCount: original.length, renderedCharacterCount: rendered.length,
    coverageRatio: original.length ? rendered.length / original.length : 0,
  }
}

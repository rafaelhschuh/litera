export type PdfReflowSpan = { text: string; bold: boolean; italic: boolean }
export type PdfReflowBlock = {
  kind: 'h1' | 'h2' | 'p'
  align: 'left' | 'center'
  spaced: boolean
  spans: PdfReflowSpan[]
  sourceY?: number
}
export type PdfReflowFigure = { afterBlock: number; crop: [number, number, number, number] }
export type PdfTextItem = {
  str?: string
  fontName?: string
  transform?: number[]
  width?: number
  height?: number
  hasEOL?: boolean
}
type PdfTextStyle = { fontFamily?: string; sourceName?: string }
type ReflowLine = { y: number; x: number; right: number; fontSize: number; items: PdfTextItem[] }

function fontSize(item: PdfTextItem): number {
  const t = item.transform ?? []
  return Math.max(1, Math.hypot(t[2] ?? 0, t[3] ?? 0), Math.abs(item.height ?? 0))
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 1
}
// Expand typographic ligatures only: NFKC would also change mathematical symbols.
export function normalizePdfText(text: string): string {
  const ligatures: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' }
  return text.replace(/[ﬀ-ﬆ]/g, value => ligatures[value]!).replaceAll(String.fromCharCode(0), '').replace(/[\u00ad\u200b\ufeff]/g, '').normalize('NFC')
}
export function pdfTextSignature(text: string): string {
  // Order can change when sorting columns; compare all non-whitespace characters,
  // including multiplicity, so equal-length substitutions cannot hide loss.
  return [...normalizePdfText(text).replace(/\s+/g, '')].sort().join('')
}
function appendSpan(spans: PdfReflowSpan[], span: PdfReflowSpan) {
  const previous = spans[spans.length - 1]
  if (previous && previous.bold === span.bold && previous.italic === span.italic) previous.text = normalizePdfText(previous.text + span.text)
  else spans.push({ ...span, text: normalizePdfText(span.text) })
}

function lineSpans(line: ReflowLine, styles: Record<string, PdfTextStyle>): PdfReflowSpan[] {
  const spans: PdfReflowSpan[] = []
  let previous: PdfTextItem | undefined, explicitSpace = false
  for (const item of line.items.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0))) {
    const raw = normalizePdfText(item.str ?? '').replace(/\s+/g, ' ')
    const text = raw.trim()
    if (!text) { explicitSpace ||= raw.length > 0; continue }
    const style = styles[item.fontName ?? '']
    const name = [item.fontName, style?.fontFamily, style?.sourceName].join(' ')
    const gap = (item.transform?.[4] ?? 0) - (previous?.transform?.[4] ?? 0) - (previous?.width ?? 0)
    const separated = explicitSpace || raw.startsWith(' ') || previous?.str?.endsWith(' ') || (previous?.width === undefined ? true : gap >= line.fontSize * .12)
    const space = previous && separated && !/^\p{M}/u.test(text) ? ' ' : ''
    appendSpan(spans, { text: space + text, bold: /bold|black|heavy|semi|demi/i.test(name), italic: /italic|oblique/i.test(name) })
    previous = item; explicitSpace = false
  }
  return spans
}

export function structurePdfText(items: PdfTextItem[], styles: Record<string, PdfTextStyle> = {}, pageWidth = 1, _pageHeight = 0): PdfReflowBlock[] {
  const meaningful = items.filter(item => item.str?.trim())
  const bodySize = median(meaningful.map(fontSize))
  const rows: ReflowLine[] = []
  // Content stream order is drawing order, not necessarily reading order.
  for (const item of items) {
    if (!item.str) continue
    const size = fontSize(item), x = item.transform?.[4] ?? 0, y = item.transform?.[5] ?? 0
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= Math.min(candidate.fontSize, size) * .35)
    if (!row) { row = { y, x, right: x, fontSize: size, items: [] }; rows.push(row) }
    row.items.push(item); row.x = Math.min(row.x, x); row.right = Math.max(row.right, x + (item.width ?? 0)); row.fontSize = Math.max(row.fontSize, size)
  }
  const lines: ReflowLine[] = []
  for (const row of rows.sort((a, b) => b.y - a.y)) {
    let line: ReflowLine | undefined
    for (const item of row.items.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0))) {
      const x = item.transform?.[4] ?? 0
      if (!line || x - line.right > row.fontSize * 3) {
        line = { y: row.y, x, right: x, fontSize: row.fontSize, items: [] }; lines.push(line)
      }
      line.items.push(item); line.right = Math.max(line.right, x + (item.width ?? 0))
    }
  }
  // A sustained gutter identifies two columns. Full-width headings separate bands.
  const middle = pageWidth / 2
  const left = lines.filter(line => line.x < middle && line.right <= middle)
  const right = lines.filter(line => line.x >= middle)
  const columns = left.length >= 2 && right.length >= 2 && Math.min(...right.map(line => line.x)) - Math.max(...left.map(line => line.right)) > bodySize
  const columnTop = Math.min(Math.max(...left.map(line => line.y)), Math.max(...right.map(line => line.y)))
  const columnBottom = Math.max(Math.min(...left.map(line => line.y)), Math.min(...right.map(line => line.y)))
  const ordered: ReflowLine[] = []
  let band: ReflowLine[] = []
  const flush = () => { ordered.push(...band.filter(line => line.x < middle), ...band.filter(line => line.x >= middle)); band = [] }
  for (const line of lines) {
    if (columns && ((line.x < middle && line.right > middle) || line.y > columnTop || line.y < columnBottom)) { flush(); ordered.push(line) }
    else if (columns) band.push(line)
    else ordered.push(line)
  }
  flush()
  const blocks: PdfReflowBlock[] = []
  let previous: ReflowLine | undefined
  for (const current of ordered) {
    const spans = lineSpans(current, styles)
    if (!spans.length) continue
    const text = spans.map(span => span.text).join(''), scale = current.fontSize / bodySize
    const kind = text.length <= 140 && scale >= 1.6 ? 'h1' : text.length <= 120 && scale >= 1.28 ? 'h2' : 'p'
    const width = current.right - current.x, center = (current.x + current.right) / 2
    const align = kind !== 'p' && width < pageWidth * .86 && Math.abs(center - pageWidth / 2) < pageWidth * .12 ? 'center' : 'left'
    const gap = previous ? previous.y - current.y : 0
    const prior = blocks[blocks.length - 1]
    const sameColumn = previous && (!columns || (previous.x < middle) === (current.x < middle))
    const continuation = prior?.kind === 'p' && kind === 'p' && sameColumn && gap > 0 && gap <= Math.max(current.fontSize, previous!.fontSize) * 1.7 && Math.abs(current.fontSize - previous!.fontSize) < bodySize * .15 && current.x - previous!.x < bodySize * .65
    if (continuation) {
      const last = prior.spans[prior.spans.length - 1]!
      // Keep a visible hyphen (it may be lexical); join its continuation without an inserted space.
      if (!/[-‐]$/.test(last.text)) spans[0]!.text = ' ' + spans[0]!.text
      for (const span of spans) appendSpan(prior.spans, span)
    } else blocks.push({ kind, align, spaced: Boolean(previous && gap > Math.max(previous.fontSize, current.fontSize) * 1.75), spans, sourceY: current.y })
    previous = current
  }
  return blocks
}

export function assessPdfAdaptation(items: PdfTextItem[], blocks: PdfReflowBlock[], hasGraphics: boolean) {
  const source = items.filter(item => item.str?.trim())
  const original = pdfTextSignature(source.map(item => item.str).join(''))
  const rendered = pdfTextSignature(blocks.flatMap(block => block.spans.map(span => span.text)).join(''))
  const textComplete = original === rendered
  const rotated = source.some(item => Math.abs(item.transform?.[1] ?? 0) > .01 || Math.abs(item.transform?.[2] ?? 0) > .01)
  const invalidUnicode = /[\uFFFD\uE000-\uF8FF]/u.test(original)
  return {
    safe: original.length > 0 && textComplete && !rotated && !invalidUnicode,
    textComplete, needsVisualReference: original.length === 0, hasGraphics, rotated, invalidUnicode,
    sourceTextItems: source.length, renderedTextItems: blocks.reduce((count, block) => count + block.spans.length, 0),
    sourceCharacterCount: original.length, renderedCharacterCount: rendered.length,
    coverageRatio: original.length ? rendered.length / original.length : 0,
  }
}

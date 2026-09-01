import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfReflowBlock, PdfReflowSpan, PdfTextItem } from '../shared/pdf-reflow.js'

type NativeFont = {
  data?: Uint8Array
  toUnicode?: { _map?: Array<string | undefined> }
}
type Glyph = { originalCharCode: number; unicode: string; fontChar: string; isInFont?: boolean }
type NativeGlyph = { text: string; fontAsset: string }
type Candidate = { fontChar: string; eligible: boolean }

/**
 * Some subset fonts have no Unicode entry for contextual glyphs. PDF.js then
 * exposes the CID as Unicode (e.g. CID 976 becomes Greek beta although its
 * outline is an f). Preserve its native outline, never guess its meaning.
 * Requires getDocument({ fontExtraProperties: true }).
 */
export async function preparePdfText(
  page: PDFPageProxy,
  items: PdfTextItem[],
  storeFont: (data: Buffer, name: string) => Promise<string>,
): Promise<{ items: PdfTextItem[]; restoreBlocks: (blocks: PdfReflowBlock[]) => PdfReflowBlock[] }> {
  const operators = await page.getOperatorList()
  const fonts = new Map<string, NativeFont>()
  const candidates = new Map<string, Map<string, Candidate>>()
  const usedFonts = new Set(items.map(item => item.fontName).filter((name): name is string => Boolean(name)))
  for (const name of usedFonts) {
    if (page.commonObjs.has(name)) fonts.set(name, page.commonObjs.get(name) as NativeFont)
  }
  let currentFont = ''
  const stack: string[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const glyph = value as Glyph
    if (typeof glyph.unicode !== 'string' || typeof glyph.fontChar !== 'string' || !Number.isInteger(glyph.originalCharCode)) return
    const font = fonts.get(currentFont)
    if (!font?.data?.length || !font.toUnicode?._map) return
    const code = glyph.originalCharCode
    const explicit = font.toUnicode._map[code] !== undefined
    const eligible = !explicit && glyph.isInFont === true && code >= 0 && code <= 0x10ffff &&
      glyph.unicode === String.fromCodePoint(code) && glyph.fontChar !== glyph.unicode
    let values = candidates.get(currentFont)
    if (!values) { values = new Map(); candidates.set(currentFont, values) }
    const prior = values.get(glyph.unicode)
    // Text items do not carry CIDs. Never replace an ambiguous Unicode value.
    values.set(glyph.unicode, {
      fontChar: glyph.fontChar,
      eligible: eligible && (!prior || (prior.eligible && prior.fontChar === glyph.fontChar)),
    })
  }
  const textOperations = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText])
  operators.fnArray.forEach((operation, index) => {
    const args = operators.argsArray[index]
    if (operation === OPS.save) stack.push(currentFont)
    else if (operation === OPS.restore) currentFont = stack.pop() ?? ''
    else if (operation === OPS.setFont) currentFont = String(args[0])
    else if (textOperations.has(operation)) visit(args)
  })

  const sourceCharacters = new Set(items.flatMap(item => [...(item.str ?? '')]))
  const replacements = new Map<string, Map<string, string>>()
  const native = new Map<string, NativeGlyph>()
  let nextToken = 0xf0000
  for (const [fontName, values] of candidates) {
    const selected = [...values].filter(([unicode, value]) => value.eligible && items.some(item => item.fontName === fontName && item.str?.includes(unicode)))
    if (!selected.length) continue
    const asset = await storeFont(Buffer.from(fonts.get(fontName)!.data!), fontName)
    const mapping = new Map<string, string>()
    const tokensByGlyph = new Map<string, string>()
    for (const [unicode, value] of selected) {
      let token = tokensByGlyph.get(value.fontChar)
      if (!token) {
        while (nextToken <= 0xffffd && sourceCharacters.has(String.fromCodePoint(nextToken))) nextToken++
        if (nextToken > 0xffffd) throw new Error('Too many unmapped PDF glyphs')
        token = String.fromCodePoint(nextToken++)
        tokensByGlyph.set(value.fontChar, token)
        native.set(token, { text: value.fontChar, fontAsset: asset })
      }
      mapping.set(unicode, token)
    }
    replacements.set(fontName, mapping)
  }
  return {
    items: items.map(item => {
      const mapping = replacements.get(item.fontName ?? '')
      return mapping && item.str ? { ...item, str: [...item.str].map(char => mapping.get(char) ?? char).join('') } : item
    }),
    restoreBlocks: blocks => blocks.map(block => ({
      ...block,
      spans: block.spans.flatMap(span => {
        const spans: PdfReflowSpan[] = []
        let text = ''
        const flush = () => { if (text) { spans.push({ ...span, text }); text = '' } }
        for (const char of span.text) {
          const glyph = native.get(char)
          if (glyph) { flush(); spans.push({ ...span, ...glyph }) }
          else text += char
        }
        flush()
        return spans
      }),
    })),
  }
}

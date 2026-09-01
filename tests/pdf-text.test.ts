import { describe, expect, it } from 'vitest'
import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { preparePdfText } from '../src/server/pdf-text.js'
import { structurePdfText } from '../src/shared/pdf-reflow.js'

const textItem = (str: string, fontName = 'body') => ({ str, fontName, width: 80, transform: [12, 0, 0, 12, 10, 100] })
const glyph = (code: number, fontChar: string, unicode = String.fromCodePoint(code)) => ({ originalCharCode: code, fontChar, unicode, isInFont: true })
function pageFor(glyphs: ReturnType<typeof glyph>[], mapped: Array<string | undefined> = []) {
  const font = { data: new Uint8Array([0, 1, 2]), toUnicode: { _map: mapped } }
  return {
    getOperatorList: async () => ({ fnArray: [OPS.setFont, OPS.showText], argsArray: [['body', 12], [glyphs]] }),
    commonObjs: { has: () => true, get: () => font },
  } as unknown as PDFPageProxy
}

describe('native PDF glyph preservation', () => {
  it('uses the native font only for an unmapped CID and keeps text around it intact', async () => {
    const input = [textItem('Soϐia 6')]
    const saved: Buffer[] = []
    const prepared = await preparePdfText(pageFor([glyph(976, '\ue070')]), input, async data => { saved.push(data); return 'cambria.ttf' })
    const blocks = prepared.restoreBlocks(structurePdfText(prepared.items))
    expect(blocks[0]!.spans).toEqual([
      { text: 'So', bold: false, italic: false },
      { text: '\ue070', bold: false, italic: false, fontAsset: 'cambria.ttf' },
      { text: 'ia 6', bold: false, italic: false },
    ])
    expect(input[0]!.str).toBe('Soϐia 6')
    expect(saved).toHaveLength(1)
  })

  it('keeps explicitly mapped Greek and numbers as real Unicode', async () => {
    const mapped: string[] = []
    mapped[976] = 'ϐ'; mapped[54] = '6'
    const prepared = await preparePdfText(pageFor([glyph(976, '\ue070'), glyph(54, '\ue080')], mapped), [textItem('ϐ 6')], async () => { throw new Error('Should not store a font') })
    expect(prepared.items[0]!.str).toBe('ϐ 6')
  })

  it('does not replace an ambiguous Unicode shared by mapped and unmapped glyphs', async () => {
    const mapped: string[] = []; mapped[15] = 'ϐ'
    const prepared = await preparePdfText(pageFor([glyph(976, '\ue070'), glyph(15, '\ue071', 'ϐ')], mapped), [textItem('ϐϐ')], async () => { throw new Error('Should not store a font') })
    expect(prepared.items[0]!.str).toBe('ϐϐ')
  })

  it('does not collide with private characters already present in the source', async () => {
    const input = [textItem('\u{f0000}ϐ')]
    const prepared = await preparePdfText(pageFor([glyph(976, '\ue070')]), input, async () => 'font.ttf')
    const blocks = prepared.restoreBlocks(structurePdfText(prepared.items))
    expect(blocks[0]!.spans[0]!.text).toBe('\u{f0000}')
    expect(blocks[0]!.spans[1]!.fontAsset).toBe('font.ttf')
  })
})

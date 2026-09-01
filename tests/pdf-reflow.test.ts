import { describe, expect, it } from 'vitest'
import { structurePdfText, assessPdfAdaptation, type PdfTextItem } from '../src/shared/pdf-reflow.js'
const item = (str: string, x: number, y: number, width: number, fontName = 'Body'): PdfTextItem => ({ str, transform: [12, 0, 0, 12, x, y], width, fontName })
const text = (items: PdfTextItem[]) => structurePdfText(items, {}, 600, 800).map(block => block.spans.map(span => span.text).join(''))
describe('PDF reflow typography and completeness', () => {
  it('joins glyph fragments without spaces inside words and preserves real spaces', () => {
    expect(text([item('capaci', 40, 700, 30), item('dade', 70, 700, 22), item(' ', 92, 700, 3), item('de', 95, 700, 12), item('ler.', 110, 700, 20)])).toEqual(['capacidade de ler.'])
  })
  it('normalizes accents and ligatures without changing mathematical symbols', () => {
    const items = [item('A ma', 40, 700, 24), item('̃e', 64, 700, 6), item('e o ﬁlho: x² = ¼.', 74, 700, 110)]
    expect(text(items)).toEqual(['A mãe e o filho: x² = ¼.'])
    expect(assessPdfAdaptation(items, structurePdfText(items), false).textComplete).toBe(true)
  })
  it('reconstructs wrapped paragraphs, preserving emphasis and paragraph indentation', () => {
    const items = [item('A leitura começa', 52, 700, 150), item('e continua', 40, 682, 70, 'Bold'), item('até o final.', 113, 682, 70), item('Novo parágrafo.', 52, 664, 110)]
    const blocks = structurePdfText(items, {}, 600, 800)
    expect(blocks.map(block => block.spans.map(span => span.text).join(''))).toEqual(['A leitura começa e continua até o final.', 'Novo parágrafo.'])
    expect(blocks[0]!.spans.some(span => span.bold && span.text.includes('continua'))).toBe(true)
  })
  it('orders interleaved columns and retains text at both page edges', () => {
    const items = [item('Direita início', 330, 700, 170), item('Esquerda início', 40, 700, 170), item('Direita fim.', 330, 682, 170), item('Esquerda fim.', 40, 682, 170), item('Rodapé', 40, 5, 70), item('Cabeçalho', 40, 795, 70)]
    expect(text(items)).toEqual(['Cabeçalho', 'Esquerda início Esquerda fim.', 'Direita início Direita fim.', 'Rodapé'])
    expect(assessPdfAdaptation(items, structurePdfText(items, {}, 600), false).coverageRatio).toBe(1)
  })
  it('detects a substitution even when the character count matches', () => {
    const items = [item('Texto completo.', 40, 700, 100)]
    const blocks = structurePdfText(items); blocks[0]!.spans[0]!.text = 'Texto incomple.'
    expect(assessPdfAdaptation(items, blocks, false).textComplete).toBe(false)
  })
})

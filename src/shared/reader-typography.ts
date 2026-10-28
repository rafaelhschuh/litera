export const readerFonts = {
  publisher: { label: 'Fonte do livro', css: 'Georgia, "Times New Roman", serif' },
  serif: { label: 'Clássica', css: 'Georgia, "Times New Roman", serif' },
  literary: { label: 'Literária', css: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  sans: { label: 'Sem serifa', css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  mono: { label: 'Monoespaçada', css: 'ui-monospace, "Courier New", monospace' },
} as const

export type ReaderTypography = {
  fontFamily: keyof typeof readerFonts
  marginSize: number
  marginTop: number
  marginBottom: number
  lineSpacing: number
  letterSpacing: number
  paragraphSpacing: number
  textAlign: 'publisher' | 'start' | 'justify'
}

export const defaultReaderTypography: ReaderTypography = { fontFamily: 'publisher', marginSize: 24, marginTop: 80, marginBottom: 96, lineSpacing: 1.65, letterSpacing: 0, paragraphSpacing: 1, textAlign: 'publisher' }
export const readerLineHeights = { compact: 1.45, normal: 1.65, relaxed: 1.85 } as const

export function resolveReaderTypography(value: Partial<ReaderTypography> & { lineHeight?: string }): ReaderTypography {
  const bounded = (number: unknown, fallback: number, min: number, max: number) => typeof number === 'number' && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
  return {
    fontFamily: value.fontFamily && Object.prototype.hasOwnProperty.call(readerFonts, value.fontFamily) ? value.fontFamily : 'publisher',
    marginSize: bounded(value.marginSize, 24, 12, 80),
    marginTop: bounded(value.marginTop, 80, 0, 160),
    marginBottom: bounded(value.marginBottom, 96, 0, 160),
    lineSpacing: bounded(value.lineSpacing, readerLineHeights[value.lineHeight as keyof typeof readerLineHeights] ?? 1.65, 1.2, 2.4),
    letterSpacing: bounded(value.letterSpacing, 0, 0, .12),
    paragraphSpacing: bounded(value.paragraphSpacing, 1, .5, 2),
    textAlign: value.textAlign === 'start' || value.textAlign === 'justify' ? value.textAlign : 'publisher',
  }
}

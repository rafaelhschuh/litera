import { testContext, login } from '../setup.js'
import { writeFidelityPdf } from '../fixtures.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { requireAdmin } from '../../src/server/auth.js'
const context = await testContext()
const font = await fs.readFile(path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts/LiberationSans-Regular.ttf'))
const pdfPath = path.join(context.books, 'fidelity.pdf')
await writeFidelityPdf(pdfPath, 8 * 1024 * 1024)
// Incremental PDF update: retain the fidelity pages and add a real embedded
// CID font with one deliberately unmapped glyph, exercising adapted font assets.
const originalPdf = await fs.readFile(pdfPath)
const previousXref = Number(originalPdf.toString('latin1').match(/startxref\n(\d+)\n%%EOF\s*$/)![1])
const cidToGid = Buffer.alloc(977 * 2)
cidToGid.writeUInt16BE(73, 976 * 2)
const stream = (data: Buffer, extra = '') => Buffer.concat([Buffer.from(`<< /Length ${data.length} ${extra} >>\nstream\n`), data, Buffer.from('\nendstream')])
const cmap = Buffer.from('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /OfflineUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0001> <0041> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end')
const updates: Array<[number, string | Buffer]> = [
  [6, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 13 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>'],
  [7, stream(Buffer.from('q 180 0 0 180 80 300 cm /Im1 Do Q\nBT /F1 18 Tf 40 700 Td (Pagina com imagem preservada) Tj ET\nBT /F2 18 Tf 40 650 Td <03D0> Tj ET'))],
  [13, '<< /Type /Font /Subtype /Type0 /BaseFont /OfflineSans /Encoding /Identity-H /DescendantFonts [14 0 R] /ToUnicode 17 0 R >>'],
  [14, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /OfflineSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 15 0 R /CIDToGIDMap 18 0 R /DW 600 >>'],
  [15, '<< /Type /FontDescriptor /FontName /OfflineSans /Flags 32 /FontBBox [-543 -303 1301 981] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 688 /StemV 80 /FontFile2 16 0 R >>'],
  [16, stream(font, `/Length1 ${font.length}`)], [17, stream(cmap)], [18, stream(cidToGid)],
]
const chunks = [originalPdf]
let offset = originalPdf.length
const offsets: Array<[number, number]> = []
for (const [id, value] of updates) {
  offsets.push([id, offset])
  const chunk = Buffer.concat([Buffer.from(`${id} 0 obj\n`), typeof value === 'string' ? Buffer.from(value) : value, Buffer.from('\nendobj\n')])
  chunks.push(chunk); offset += chunk.length
}
chunks.push(Buffer.from('xref\n' + offsets.map(([id, position]) => `${id} 1\n${String(position).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 19 /Root 1 0 R /Info 9 0 R /Prev ${previousXref} >>\nstartxref\n${offset}\n%%EOF\n`))
await fs.writeFile(pdfPath, Buffer.concat(chunks))
const epubPath = path.join(context.books, 'island.epub')
const zip = await JSZip.loadAsync(await fs.readFile(epubPath))
const illustration = await zip.file('OEBPS/cover.png')!.async('nodebuffer')
zip.file('OEBPS/images/arrival.png', illustration)
zip.file('OEBPS/images/crossing.png', illustration)
zip.file('OEBPS/fonts/offline.ttf', font)
zip.file('OEBPS/styles/book.css', '@import "details.css"; @font-face{font-family:OfflineFixture;src:url("../fonts/offline.ttf") format("truetype")} .offline-caption{font-family:OfflineFixture,sans-serif;font-style:italic} .offline-figure{background-image:url("../images/crossing.png")}')
zip.file('OEBPS/styles/details.css', '.offline-caption{font-weight:700}')
zip.file('OEBPS/content.opf', (await zip.file('OEBPS/content.opf')!.async('string')).replace('</manifest>', '<item id="arrival" href="images/arrival.png" media-type="image/png"/><item id="crossing" href="images/crossing.png" media-type="image/png"/><item id="offline-font" href="fonts/offline.ttf" media-type="font/ttf"/><item id="book-css" href="styles/book.css" media-type="text/css"/><item id="details-css" href="styles/details.css" media-type="text/css"/></manifest>'))
for (const chapter of [1, 2]) {
  const name = `OEBPS/chapter-${chapter}.xhtml`
  const original = await zip.file(name)!.async('string')
  const image = chapter === 1 ? 'arrival' : 'crossing'
  zip.file(name, original.replace('</head>', '<link rel="stylesheet" href="styles/book.css"/></head>').replace('</body>', `<figure class="offline-figure"><img src="images/${image}.png" alt="Ilustração offline ${chapter}"/><figcaption class="offline-caption">Legenda offline ${chapter}</figcaption></figure>` + Array.from({ length: 180 }, (_, index) => `<p>Capitulo ${chapter}, paragrafo ${index}. Texto longo para navegar, selecionar e restaurar uma posicao sem perder conteudo.</p>`).join('') + '</body>'))
}
await fs.writeFile(epubPath, await zip.generateAsync({ type: 'nodebuffer' }))
await login(context.agent)
const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Reader fixtures', path: context.books })
await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
// Test-only, authenticated fixture mutation. The test subsequently uses the real
// scan API; no fabricated revisions or successful application responses.
context.app.post('/__e2e/revise-epub', requireAdmin, async (_req, res, next) => {
  try {
    const revised = await JSZip.loadAsync(await fs.readFile(epubPath))
    await fs.writeFile(epubPath, await revised.generateAsync({ type: 'nodebuffer', comment: `offline-revision-${randomUUID()}` }))
    res.json({ libraryId: library.body.library.id })
  } catch (error) { next(error) }
})
const server = context.app.listen(3107, '127.0.0.1')
async function close() { server.close(); await context.cleanup(); process.exit(0) }
process.on('SIGTERM', close)
process.on('SIGINT', close)

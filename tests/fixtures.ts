import fs from 'node:fs/promises'
import JSZip from 'jszip'

export async function writeEpub(filePath: string, title = 'A Ilha de Teste', author = 'Ana Leitora'): Promise<void> {
  const zip = new JSZip()
  const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAIAAABrW6giAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR4nGMosfSGIwZKOQCPExdB3MAPCgAAAABJRU5ErkJggg==', 'base64')
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:litera:test-island</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>pt-BR</dc:language><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/><item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine></package>`)
  zip.file('OEBPS/cover.png', cover)
  zip.file('OEBPS/chapter-1.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chegada</title></head><body><h1>Chegada</h1><p>Conteúdo real do primeiro capítulo.<a href="#nota-1">Nota</a><a href="chapter-2.xhtml">Próximo capítulo</a><a href="https://example.com/reference">Referência externa</a></p><aside id="nota-1">Texto da nota.</aside><script>alert('never')</script></body></html>`)
  zip.file('OEBPS/chapter-2.xhtml', `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Travessia</title></head><body><h1>Travessia</h1><p>Conteúdo real do segundo capítulo.</p></body></html>`)
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

export async function writePdf(filePath: string, title = 'Caderno PDF', author = 'Paulo Página'): Promise<void> {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 49 >>\nstream\nBT /F1 18 Tf 72 720 Td (Litera PDF real) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Title (${title}) /Author (${author}) >>`,
  ]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index++) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await fs.writeFile(filePath, pdf)
}

export async function writeFidelityPdf(filePath: string, paddingBytes = 0, lineDiagram = false): Promise<void> {
  const text = [
    'BT /F1 12 Tf 40 775 Td (INICIO: paragrafo antes da nota.) Tj ET',
    'BT /F1 12 Tf 40 755 Td <' + Buffer.from('A mãe aprendeu: atenção, ação e coração.', 'latin1').toString('hex') + '> Tj ET',
    ...Array.from({ length: 35 }, (_, index) => `BT /F1 12 Tf 40 ${740 - index * 18} Td (Paragrafo ${index}: conteudo integral para leitura adaptada.) Tj ET`),
    'BT /F1 12 Tf 40 390 Td (MEIO: toma nota disto.) Tj ET',
    'BT /F1 12 Tf 40 20 Td (FINAL: capacidade de continuar o paragrafo completo.) Tj ET',
  ].sort((a, b) => Number(b.match(/40 (\d+) Td/)?.[1]) - Number(a.match(/40 (\d+) Td/)?.[1])).join('\n')
  const graphic = (lineDiagram ? 'q 0.5 w 80 300 m 260 300 l S 260 300 m 260 480 l S 260 480 m 80 480 l S 80 480 m 80 300 l S Q' : 'q 180 0 0 180 80 300 cm /Im1 Do Q') + '\nBT /F1 18 Tf 40 700 Td (Pagina com imagem preservada) Tj ET'
  const stream = (value: string) => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R 10 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(text), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>',
    stream(graphic),
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nC27B90>\nendstream',
    '<< /Title (Fidelidade PDF) >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 11 0 R >>',
    stream(text),
  ]
  if (paddingBytes) objects.push(stream('0'.repeat(paddingBytes)))
  let result = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(result)
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await fs.writeFile(filePath, result)
}

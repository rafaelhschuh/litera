import fs from 'node:fs/promises'
import JSZip from 'jszip'

export async function writeEpub(filePath: string, title = 'A Ilha de Teste', author = 'Ana Leitora'): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:litera:test-island</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>pt-BR</dc:language></metadata><manifest><item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine></package>`)
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
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

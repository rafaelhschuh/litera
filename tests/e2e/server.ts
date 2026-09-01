import { testContext, login } from '../setup.js'
import { writeFidelityPdf } from '../fixtures.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
const context = await testContext()
await writeFidelityPdf(path.join(context.books, 'fidelity.pdf'))
const epubPath = path.join(context.books, 'island.epub')
const zip = await JSZip.loadAsync(await fs.readFile(epubPath))
for (const chapter of [1, 2]) {
  const name = `OEBPS/chapter-${chapter}.xhtml`
  const original = await zip.file(name)!.async('string')
  zip.file(name, original.replace('</body>', Array.from({ length: 180 }, (_, index) => `<p>Capitulo ${chapter}, paragrafo ${index}. Texto longo para navegar, selecionar e restaurar uma posicao sem perder conteudo.</p>`).join('') + '</body>'))
}
await fs.writeFile(epubPath, await zip.generateAsync({ type: 'nodebuffer' }))
await login(context.agent)
const library = await context.agent.post('/api/v1/admin/libraries').send({ name: 'Reader fixtures', path: context.books })
await context.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)
const server = context.app.listen(3107, '127.0.0.1')
async function close() { server.close(); await context.cleanup(); process.exit(0) }
process.on('SIGTERM', close)
process.on('SIGINT', close)

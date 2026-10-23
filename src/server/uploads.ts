import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Request } from 'express'
import type { AppConfig } from './config.js'
import { extractEpub } from './epub.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { validateLibraryPath } from './scanner.js'

export class UploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

export function uploadFilename(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 220 || /[/\\]/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || value.startsWith('.') || value !== value.trim()) {
    throw new UploadError(400, 'INVALID_FILENAME', 'Use um nome de arquivo sem pastas, com até 220 bytes.')
  }
  if (!/\.(epub|pdf)$/i.test(value)) throw new UploadError(415, 'UNSUPPORTED_BOOK', 'Envie um livro EPUB ou PDF.')
  return value
}

/** Stage and validate before publishing a new source file; never overwrite a book. */
export async function receiveBook(req: Request, config: AppConfig, libraryPath: string, filename: string): Promise<void> {
  const root = validateLibraryPath(libraryPath, config)
  const length = Number(req.headers['content-length'])
  if (Number.isFinite(length) && length > config.maxBookBytes) throw new UploadError(413, 'BOOK_TOO_LARGE', `O limite por livro é ${Math.round(config.maxBookBytes / 1024 / 1024)} MB.`)
  const temporary = path.join(config.dataDir, 'upload-staging')
  await fs.promises.mkdir(temporary, { recursive: true, mode: 0o700 })
  const staged = path.join(temporary, randomUUID())
  let bytes = 0
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length
    callback(bytes > config.maxBookBytes ? new UploadError(413, 'BOOK_TOO_LARGE', 'O livro ultrapassa o limite de tamanho configurado.') : null, chunk)
  } })
  const interrupted = () => limiter.destroy(new UploadError(400, 'UPLOAD_INTERRUPTED', 'O envio foi interrompido. Tente novamente.'))
  req.once('aborted', interrupted)
  req.once('error', interrupted)
  try {
    const received = pipeline(limiter, fs.createWriteStream(staged, { flags: 'wx', mode: 0o600 }))
    req.pipe(limiter)
    await received
    if (!bytes) throw new UploadError(400, 'EMPTY_BOOK', 'O arquivo está vazio.')
    try {
      if (/\.epub$/i.test(filename)) { const epub = await extractEpub(staged); if (!epub.chapters.length) throw new Error('Empty EPUB') }
      else {
        const task = getDocument({ data: new Uint8Array(await fs.promises.readFile(staged)), useSystemFonts: false })
        try { const pdf = await task.promise; if (!pdf.numPages) throw new Error('Empty PDF') }
        finally { await task.destroy() }
      }
    } catch { throw new UploadError(422, 'INVALID_BOOK', 'O arquivo não é um EPUB/PDF válido ou está protegido por senha.') }
    if (req.aborted) throw new UploadError(400, 'UPLOAD_INTERRUPTED', 'O envio foi interrompido.')
    // Recheck the configured boundary after the potentially long transfer.
    if (validateLibraryPath(libraryPath, config) !== root) throw new UploadError(409, 'LIBRARY_CHANGED', 'A pasta da biblioteca mudou durante o envio. Tente novamente.')
    try {
      // A hidden file on the destination filesystem keeps scans from seeing a partial book.
      const publishing = path.join(root, `.litera-upload-${randomUUID()}`)
      try {
        await fs.promises.copyFile(staged, publishing, fs.constants.COPYFILE_EXCL)
        await fs.promises.chmod(publishing, 0o644)
        await fs.promises.link(publishing, path.join(root, filename))
      } finally { await fs.promises.rm(publishing, { force: true }) }
    } catch (reason) {
      const code = (reason as NodeJS.ErrnoException).code
      if (code === 'EEXIST') throw new UploadError(409, 'BOOK_EXISTS', 'Já existe um arquivo com esse nome. Renomeie o livro antes de enviar; nenhum arquivo foi substituído.')
      if (['EROFS', 'EACCES', 'EPERM'].includes(code ?? '')) throw new UploadError(409, 'LIBRARY_READ_ONLY', 'Esta pasta não permite gravação. Habilite escrita no volume da biblioteca para enviar livros.')
      if (['ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? '')) throw new UploadError(409, 'UPLOAD_FILESYSTEM_UNSUPPORTED', 'O volume não permite publicar arquivos com segurança. Use uma pasta com suporte a hard links.')
      throw reason
    }
  } finally {
    req.unpipe(limiter)
    req.removeListener('aborted', interrupted)
    req.removeListener('error', interrupted)
    if (!req.complete) req.resume()
    await fs.promises.rm(staged, { force: true })
  }
}

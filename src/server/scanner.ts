import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { AppConfig } from './config.js'
import { preparePdf } from './pdf-preparation.js'
import { storeOptimizedCover } from './covers.js'
import type { LiteraDatabase } from './database.js'
import { extractEpub } from './epub.js'
import { configuredMetadataProvider, type NormalizedMetadata } from './metadata.js'

export type ScanReport = { discovered: number; added: number; updated: number; renamed: number; unchanged: number; missing: number; errors: Array<{ file: string; message: string }> }
const pdfStandardFontDataUrl = `${path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}${path.sep}`

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function validateLibraryPath(candidate: string, config: AppConfig): string {
  const real = fs.realpathSync(candidate)
  if (!fs.statSync(real).isDirectory()) throw new Error('Library path is not a directory')
  const allowed = config.allowedBookRoots.some((root) => {
    try { return isWithin(real, fs.realpathSync(root)) } catch { return false }
  })
  if (!allowed) throw new Error('Library path is outside LITERA_BOOK_ROOTS')
  return real
}

function walk(directory: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) result.push(...walk(full))
    else if (entry.isFile() && ['.epub', '.pdf'].includes(path.extname(entry.name).toLowerCase())) result.push(full)
  }
  return result
}

async function fileFingerprint(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return 'sha256:' + hash.digest('hex')
}

async function embeddedCover(data: Buffer, config: AppConfig): Promise<string> {
  // Content-addressed paths never let inode reuse overwrite another book's image.
  return storeOptimizedCover(data, path.join(config.dataDir, 'covers', createHash('sha256').update(data).digest('hex')))
}

type PdfInfo = { title: string; author?: string; pageCount: number; cover?: { data: Buffer; extension: string } }

async function pdfMetadata(filePath: string): Promise<PdfInfo> {
  const data = new Uint8Array(await fs.promises.readFile(filePath))
  const document = await getDocument({ data, useSystemFonts: false, standardFontDataUrl: pdfStandardFontDataUrl }).promise
  try {
    const metadata = await document.getMetadata().catch(() => undefined)
    const info = metadata?.info as Record<string, unknown> | undefined
    const clean = (value: string): string => /[ÃÂ]/.test(value) ? Buffer.from(value, 'latin1').toString('utf8') : value
    let cover: PdfInfo['cover']
    try {
      const page = await document.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(640 / base.width, 960 / base.height)
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
      const canvasContext = canvas.getContext('2d')
      await page.render({ canvas: canvas as any, canvasContext: canvasContext as any, viewport, background: '#ffffff' }).promise
      cover = { data: canvas.toBuffer('image/png'), extension: '.png' }
      page.cleanup()
    } catch { cover = undefined }
    return {
      title: typeof info?.Title === 'string' && info.Title.trim() ? clean(info.Title.trim()) : path.basename(filePath, path.extname(filePath)),
      author: typeof info?.Author === 'string' && info.Author.trim() ? clean(info.Author.trim()) : undefined,
      pageCount: document.numPages,
      cover,
    }
  } finally {
    if (typeof (document as any).destroy === 'function') await (document as any).destroy()
  }
}

export async function scanLibrary(db: LiteraDatabase, config: AppConfig, libraryId: number, jobId?: number): Promise<ScanReport> {
  const library = db.prepare('SELECT id, path FROM libraries WHERE id = ?').get(libraryId) as { id: number; path: string } | undefined
  if (!library) throw new Error('Library not found')
  const libraryPath = validateLibraryPath(library.path, config)
  const files = walk(libraryPath)
  const report: ScanReport = { discovered: files.length, added: 0, updated: 0, renamed: 0, unchanged: 0, missing: 0, errors: [] }
  const seen = new Set<number>()
  const claimed = new Set<number>()
  const provider = configuredMetadataProvider(config, db)
  for (const filePath of files) {
    const relative = path.relative(libraryPath, filePath)
    const format = path.extname(filePath).toLowerCase().slice(1) as 'epub' | 'pdf'
    try {
      const stat = fs.statSync(filePath)
      let identity = `${stat.dev}:${stat.ino}`
      const fingerprint = stat.size <= config.maxBookBytes ? await fileFingerprint(filePath) : null
      const assertStable = () => {
        const current = fs.statSync(filePath)
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs) throw new Error('File changed during scan; retry after the transfer completes')
      }
      assertStable()
      const selectFile = `SELECT f.id, f.identity, f.book_id AS bookId, f.size, f.modified_ms AS modifiedMs, f.relative_path AS relativePath, f.fingerprint, f.status, b.cover_path AS coverPath, b.cover_source AS coverSource, b.cover_fingerprint AS coverFingerprint, b.metadata_provenance AS provenance FROM book_files f JOIN books b ON b.id=f.book_id WHERE f.library_id=?`
      // A path identifies an edition replacement; a move requires identical content.
      // Inodes are recyclable and must never identify an unrelated new upload.
      let existing = db.prepare(selectFile + ' AND f.relative_path=?').get(libraryId, relative) as any
      if (!existing && fingerprint) {
        const candidates = db.prepare(selectFile + ' AND f.fingerprint=? ORDER BY f.id').all(libraryId, fingerprint) as any[]
        const movable = candidates.filter(candidate => !claimed.has(candidate.id) && !fs.existsSync(path.join(libraryPath, candidate.relativePath)))
        existing = movable.find(candidate => candidate.identity === identity) ?? (movable.length === 1 ? movable[0] : undefined)
        if (existing) report.renamed++
      }
      const collision = db.prepare('SELECT id,relative_path AS relativePath FROM book_files WHERE library_id=? AND identity=?').get(libraryId, identity) as any
      if (collision && collision.id !== existing?.id) {
        if (fs.existsSync(path.join(libraryPath, collision.relativePath))) identity += ':' + createHash('sha256').update(relative).digest('hex')
        else db.prepare("UPDATE book_files SET identity='retired:' || id || ':' || identity WHERE id=?").run(collision.id)
      }
      if (existing) { claimed.add(existing.id); seen.add(existing.id) }
      if (stat.size > config.maxBookBytes) {
        const message = `File exceeds the configured ${Math.round(config.maxBookBytes / 1024 / 1024)} MB limit`
        report.errors.push({ file: relative, message })
        const existingLarge = existing
        if (existingLarge) db.prepare(`UPDATE book_files SET relative_path=?,size=?,modified_ms=?,fingerprint=?,status='error',ingestion_error=?,last_seen_job_id=? WHERE id=?`).run(relative, stat.size, Math.round(stat.mtimeMs), fingerprint, message, jobId ?? null, existingLarge.id)
        else {
          const book = db.prepare('INSERT INTO books(title,format,metadata_status,metadata_error) VALUES (?,?,?,?)').run(path.basename(filePath, path.extname(filePath)), format, 'local', message)
          const inserted = db.prepare(`INSERT INTO book_files(library_id,book_id,identity,relative_path,size,modified_ms,fingerprint,status,ingestion_error,last_seen_job_id) VALUES (?,?,?,?,?,?,?,'error',?,?)`).run(libraryId, book.lastInsertRowid, identity, relative, stat.size, Math.round(stat.mtimeMs), fingerprint, message, jobId ?? null)
          seen.add(Number(inserted.lastInsertRowid))
        }
        continue
      }
      if (format === 'pdf') {
        try { await preparePdf(filePath, config.dataDir) }
        catch (error) { report.errors.push({ file: relative, message: 'PDF preparation: ' + (error instanceof Error ? error.message : 'failed') }) }
      }
      const manualCover = existing?.coverSource === 'manual'
      const coverCurrent = manualCover || (existing?.coverFingerprint === fingerprint && (existing?.coverPath ? fs.existsSync(existing.coverPath) : existing?.coverSource === 'none'))
      if (existing && existing.status === 'available' && existing.fingerprint === fingerprint && coverCurrent) {
        db.prepare("UPDATE book_files SET relative_path=?,identity=?,size=?,modified_ms=?,status='available',ingestion_error=NULL,last_seen_job_id=? WHERE id=?").run(relative, identity, stat.size, Math.round(stat.mtimeMs), jobId ?? null, existing.id)
        report.unchanged++
        continue
      }
      try {
        const embedded = format === 'epub' ? await extractEpub(filePath) : await pdfMetadata(filePath)
        let enriched: NormalizedMetadata | undefined
        let providerError: string | undefined
        if (provider) {
          try {
            const candidates = await provider.search({ title: embedded.title, author: embedded.author, identifier: 'identifier' in embedded ? embedded.identifier : undefined })
            if (candidates[0] && (candidates[0].confidence ?? 0) >= 0.78) enriched = await provider.getDetails(candidates[0])
          } catch (error) { providerError = error instanceof Error ? error.message : 'Metadata provider failed' }
        }
        const metadata = { ...embedded, description: enriched?.description, genres: enriched?.genres ?? ('genres' in embedded ? embedded.genres : undefined), publishedYear: enriched?.publishedYear, series: enriched?.series ?? ('series' in embedded ? embedded.series : undefined), seriesIndex: enriched?.seriesIndex ?? ('seriesIndex' in embedded ? embedded.seriesIndex : undefined), provider: enriched?.provider, providerKey: enriched?.key, confidence: enriched?.confidence, provenance: enriched?.provenance }
        let coverPath: string | null = manualCover ? existing.coverPath : null
        let coverProcessed = true
        if (metadata.cover && !manualCover) {
          try { coverPath = await embeddedCover(metadata.cover.data, config) }
          catch (error) { coverProcessed = false; report.errors.push({ file: relative, message: 'Cover: ' + (error instanceof Error ? error.message : 'Invalid image') }) }
        }
        assertStable()
        db.transaction(() => {
          if (existing) {
            if (existing.provenance !== 'manual') db.prepare(`UPDATE books SET title=?, author=?, identifier=?, language=?, cover_path=?, page_count=?,
              description=COALESCE(?,description), genres=COALESCE(?,genres), published_year=COALESCE(?,published_year), series=COALESCE(?,series), series_index=COALESCE(?,series_index), metadata_provider=COALESCE(?,metadata_provider), provider_record_key=COALESCE(?,provider_record_key), metadata_confidence=?, metadata_provenance=?, metadata_status=?, metadata_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
              .run(metadata.title, metadata.author ?? null, 'identifier' in metadata ? metadata.identifier ?? null : null, 'language' in metadata ? metadata.language ?? null : null, coverPath ?? null, 'pageCount' in metadata ? metadata.pageCount : null, metadata.description ?? null, metadata.genres ? JSON.stringify(metadata.genres) : null, metadata.publishedYear ?? null, metadata.series ?? null, metadata.seriesIndex ?? null, metadata.provider ?? null, metadata.providerKey ?? null, metadata.confidence ?? null, metadata.provenance ?? 'embedded', providerError ? 'error' : enriched ? 'matched' : provider ? 'not_found' : 'local', providerError ?? null, existing.bookId)
            db.prepare(`UPDATE book_files SET identity=?, relative_path=?, size=?, modified_ms=?, fingerprint=?, status='available', ingestion_error=NULL,last_seen_job_id=? WHERE id=?`)
              .run(identity, relative, stat.size, Math.round(stat.mtimeMs), fingerprint, jobId ?? null, existing.id)
            report.updated++
          } else {
            const book = db.prepare(`INSERT INTO books(title, author, identifier, language, cover_path, format, page_count, description, genres, published_year, series, series_index, metadata_provider, provider_record_key, metadata_confidence, metadata_provenance, metadata_status, metadata_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(metadata.title, metadata.author ?? null, 'identifier' in metadata ? metadata.identifier ?? null : null, 'language' in metadata ? metadata.language ?? null : null, coverPath ?? null, format, 'pageCount' in metadata ? metadata.pageCount : null, metadata.description ?? null, metadata.genres ? JSON.stringify(metadata.genres) : null, metadata.publishedYear ?? null, metadata.series ?? null, metadata.seriesIndex ?? null, metadata.provider ?? null, metadata.providerKey ?? null, metadata.confidence ?? null, metadata.provenance ?? 'embedded', providerError ? 'error' : enriched ? 'matched' : provider ? 'not_found' : 'local', providerError ?? null)
            db.prepare(`INSERT INTO book_files(library_id, book_id, identity, relative_path, size, modified_ms, fingerprint, status,last_seen_job_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'available',?)`)
              .run(libraryId, book.lastInsertRowid, identity, relative, stat.size, Math.round(stat.mtimeMs), fingerprint, jobId ?? null)
            report.added++
          }
          const bookId = existing?.bookId ?? (db.prepare('SELECT book_id AS bookId FROM book_files WHERE library_id=? AND identity=?').get(libraryId, identity) as { bookId: number }).bookId
          db.prepare(`UPDATE books SET cover_path=?,cover_source=?,cover_fingerprint=?,page_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(coverPath, manualCover ? 'manual' : coverPath ? 'embedded' : coverProcessed ? 'none' : null, manualCover ? existing.coverFingerprint : coverProcessed ? fingerprint : null, 'pageCount' in metadata ? metadata.pageCount : null, bookId)
          const fileRow = db.prepare('SELECT id FROM book_files WHERE library_id=? AND relative_path=?').get(libraryId, relative) as { id: number }
          seen.add(fileRow.id)
          if (provider) db.prepare(`INSERT INTO metadata_provider_results(book_id,provider,provider_key,status,payload,error,confidence,provenance) VALUES (?,?,?,?,?,?,?,?)`).run(bookId, provider.id, enriched?.key ?? null, providerError ? 'error' : enriched ? 'matched' : 'not_found', enriched ? JSON.stringify(enriched) : null, providerError ?? null, enriched?.confidence ?? null, enriched?.provenance ?? null)
        })()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown ingestion error'
        report.errors.push({ file: relative, message })
        if (existing) db.prepare(`UPDATE book_files SET identity=?,relative_path=?,size=?,modified_ms=?,fingerprint=?,status='error',ingestion_error=?,last_seen_job_id=? WHERE id=?`).run(identity, relative, stat.size, Math.round(stat.mtimeMs), fingerprint, message, jobId ?? null, existing.id)
        else {
          const book = db.prepare(`INSERT INTO books(title, format) VALUES (?, ?)`).run(path.basename(filePath, path.extname(filePath)), format)
          const inserted = db.prepare(`INSERT INTO book_files(library_id,book_id,identity,relative_path,size,modified_ms,fingerprint,status,ingestion_error,last_seen_job_id) VALUES (?,?,?,?,?,?,?,'error',?,?)`)
            .run(libraryId, book.lastInsertRowid, identity, relative, stat.size, Math.round(stat.mtimeMs), fingerprint, message, jobId ?? null)
          seen.add(Number(inserted.lastInsertRowid))
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File could not be read'
      report.errors.push({ file: relative, message })
      const row = db.prepare('SELECT id FROM book_files WHERE library_id=? AND relative_path=?').get(libraryId, relative) as { id: number } | undefined
      if (row) {
        seen.add(row.id)
        db.prepare("UPDATE book_files SET status='error',ingestion_error=?,last_seen_job_id=? WHERE id=?").run(message, jobId ?? null, row.id)
      }
    }
  }
  const known = db.prepare('SELECT id, identity, status FROM book_files WHERE library_id = ?').all(libraryId) as Array<{ id: number; identity: string; status: string }>
  for (const row of known) if (!seen.has(row.id) && row.status !== 'missing') { db.prepare(`UPDATE book_files SET status='missing' WHERE id=?`).run(row.id); report.missing++ }
  const status = report.errors.length ? 'completed_with_errors' : 'completed'
  db.prepare('UPDATE libraries SET last_scan_at=CURRENT_TIMESTAMP, last_scan_status=?, last_scan_summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, JSON.stringify(report), libraryId)
  return report
}

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createCanvas } from '@napi-rs/canvas'
import express, { type NextFunction, type Request, type Response } from 'express'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { z } from 'zod'
import { preparePdf, preparedPdfDirectory, readPreparedPdfPage } from './pdf-preparation.js'
import type { ReadingLocator } from '../shared/progress.js'
import { normalizeProgress } from '../shared/progress.js'
import { createSession, deleteSession, parseCookies, requireAdmin, requireUser, sessionMiddleware, type SessionUser } from './auth.js'
import type { AppConfig } from './config.js'
import { ensureOptimizedCover, InvalidCoverError, storeOptimizedCover } from './covers.js'
import { hashPassword, openDatabase, verifyPassword, type LiteraDatabase } from './database.js'
import { extractEpub, readEpubAsset, readEpubChapter, searchEpub } from './epub.js'
import { validateLibraryPath } from './scanner.js'
import { createScanJob, enqueueScanJob, mapScanJob, resumeScanJobs, runScanJob } from './jobs.js'
import { configuredMetadataProvider } from './metadata.js'

const projectRoot = process.cwd()
const pdfStandardFontDataUrl = `${path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}${path.sep}`
const pdfCMapUrl = pdfStandardFontDataUrl.replace(/standard_fonts[/\\]$/, 'cmaps/')

const loginSchema = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(1024) })
const librarySchema = z.object({ name: z.string().trim().min(1).max(120), path: z.string().trim().min(1).max(4096), rescanIntervalMinutes: z.number().int().min(0).max(10_080).default(0) })
const progressSchema = z.object({ format: z.enum(['epub', 'pdf']), progressRatio: z.number(), locator: z.record(z.string(), z.unknown()), completed: z.boolean().optional(), revision: z.number().int().positive().optional() })
const userSchema = z.object({ username: z.string().trim().min(1).max(100), displayName: z.string().trim().min(1).max(120), password: z.string().min(12).max(1024), role: z.enum(['admin', 'reader']).default('reader'), libraryIds: z.array(z.number().int().positive()).default([]) })
const userUpdateSchema = z.object({ displayName: z.string().trim().min(1).max(120).optional(), role: z.enum(['admin', 'reader']).optional(), active: z.boolean().optional(), password: z.string().min(12).max(1024).optional(), libraryIds: z.array(z.number().int().positive()).optional() })
const preferenceSchema = z.object({ theme: z.enum(['light', 'sepia', 'dark']), fontScale: z.number().int().min(80).max(140), lineHeight: z.enum(['compact', 'normal', 'relaxed']), margins: z.enum(['narrow', 'normal', 'wide']), appTheme: z.enum(['system', 'light', 'dark']), reducedMotion: z.boolean(), pdfInvert: z.boolean().default(false) })
const highlightSchema = z.object({ quoteText: z.string().trim().min(1).max(10000), locator: z.record(z.string(), z.unknown()), chapter: z.string().trim().max(500).optional(), pageNumber: z.number().int().positive().optional() })
const ratingSchema = z.object({ rating: z.number().int().min(0).max(5) })
const metadataEditSchema = z.object({ title: z.string().trim().min(1).max(500), author: z.string().trim().max(500).nullable().optional(), description: z.string().trim().max(20_000).nullable().optional(), language: z.string().trim().max(50).nullable().optional(), identifier: z.string().trim().max(200).nullable().optional(), series: z.string().trim().max(500).nullable().optional(), seriesIndex: z.number().nonnegative().nullable().optional(), publishedYear: z.number().int().min(0).max(3000).nullable().optional(), genres: z.array(z.string().trim().min(1).max(100)).max(50).default([]) })
const coverUploadSchema = z.object({ dataUrl: z.string().max(12_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/i) })

function apiError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

function safeJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function bookSelect(): string {
  return `SELECT b.id, b.title, b.author, b.description, b.language, b.identifier, b.format, b.page_count AS pageCount, b.genres, b.published_year AS publishedYear,
    b.added_at AS addedAt, MAX(f.size) AS fileSize, CASE WHEN b.cover_path IS NULL THEN 0 ELSE 1 END AS hasCover,
    b.series, b.series_index AS seriesIndex, b.metadata_status AS metadataStatus, b.metadata_error AS metadataError,
    p.progress_ratio AS progressRatio, p.locator_payload AS locatorPayload, p.last_read_at AS lastReadAt, p.completed, br.rating AS userRating,
    CASE WHEN fav.book_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available'
      AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?))
    LEFT JOIN reading_progress p ON p.book_id=b.id AND p.user_id=?
    LEFT JOIN favorites fav ON fav.book_id=b.id AND fav.user_id=?
    LEFT JOIN book_ratings br ON br.book_id=b.id AND br.user_id=?`
}

function bookParams(req: Request): Array<string | number> { return [req.user!.role, req.user!.id, req.user!.id, req.user!.id, req.user!.id] }

function mapBook(row: any): any {
  return { ...row, genres: safeJson(row.genres) ?? [], hasCover: Boolean(row.hasCover), favorite: Boolean(row.favorite), completed: Boolean(row.completed), progressRatio: row.progressRatio ?? null, locator: safeJson(row.locatorPayload), locatorPayload: undefined }
}

function locateBookFile(db: LiteraDatabase, bookId: number, user: SessionUser): { filePath: string; format: 'epub' | 'pdf' } | undefined {
  const row = db.prepare(`SELECT l.path AS libraryPath, f.relative_path AS relativePath, b.format
    FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available' JOIN libraries l ON l.id=f.library_id
    WHERE b.id=? AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?)) LIMIT 1`).get(bookId, user.role, user.id) as any
  if (!row) return undefined
  const filePath = path.resolve(row.libraryPath, row.relativePath)
  const relative = path.relative(path.resolve(row.libraryPath), filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
  return { filePath, format: row.format }
}

function streamFile(req: Request, res: Response, filePath: string, next: NextFunction): void {
  const stat = fs.statSync(filePath)
  res.setHeader('Accept-Ranges', 'bytes')
  // A multipart/unknown range is deliberately ignored with a complete 200 response.
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
  let start = 0; let end = stat.size - 1
  if (range && (range[1] || range[2])) {
    if (!range[1]) start = Math.max(0, stat.size - Number(range[2]))
    else { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end) }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      res.status(416).setHeader('Content-Range', `bytes */${stat.size}`); res.end(); return
    }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  }
  res.setHeader('Content-Length', String(Math.max(0, end - start + 1)))
  if (!stat.size || req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(filePath, { start, end }).once('error', next).pipe(res)
}

export function createApp(config: AppConfig, suppliedDb?: LiteraDatabase) {
  const db = suppliedDb ?? openDatabase(config)
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    const requestId = typeof req.headers['x-request-id'] === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(req.headers['x-request-id']) ? req.headers['x-request-id'] : randomUUID()
    const started = Date.now()
    res.setHeader('X-Request-Id', requestId)
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ level: 'info', event: 'http_request', requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started, userId: req.user?.id }))
    })
    next()
  })
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
    next()
  })
  app.use(express.json({ limit: '12mb' }))
  app.use(sessionMiddleware(db))
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin
      const expected = config.publicOrigin ?? `${req.protocol}://${req.get('host')}`
      if (origin && origin !== expected) { apiError(res, 403, 'ORIGIN_MISMATCH', 'Request origin is not allowed'); return }
    }
    next()
  })

  app.get('/health', (_req, res) => res.json({ status: 'ok', version: '0.4.2', database: 'ok' }))

  const loginAttempts = new Map<string, { count: number; reset: number }>()
  app.post('/api/v1/auth/login', (req, res) => {
    const key = req.ip ?? 'unknown'; const now = Date.now(); const attempt = loginAttempts.get(key)
    if (attempt && attempt.reset > now && attempt.count >= 10) { apiError(res, 429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again later.'); return }
    const input = loginSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_INPUT', 'Username and password are required'); return }
    const user = db.prepare('SELECT id, username, display_name AS displayName, password_hash AS passwordHash, role, active FROM users WHERE username=?').get(input.data.username) as any
    if (!user || !user.active || !verifyPassword(input.data.password, user.passwordHash)) {
      const current = attempt && attempt.reset > now ? attempt : { count: 0, reset: now + 15 * 60_000 }; current.count++; loginAttempts.set(key, current)
      apiError(res, 401, 'INVALID_CREDENTIALS', 'Username or password is incorrect'); return
    }
    loginAttempts.delete(key)
    const token = createSession(db, user.id)
    db.prepare('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?').run(user.id)
    res.cookie('litera_session', token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' })
    res.json({ user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } })
  })
  app.post('/api/v1/auth/logout', (req, res) => {
    deleteSession(db, parseCookies(req.headers.cookie).litera_session)
    res.clearCookie('litera_session', { path: '/' })
    res.status(204).end()
  })
  app.get('/api/v1/auth/me', requireUser, (req, res) => res.json({ user: req.user }))
  resumeScanJobs(db, config)
  // Upgrade existing libraries without waiting for a scheduled/manual rescan.
  const existingPdfs = db.prepare("SELECT l.path AS root, f.relative_path AS relative FROM book_files f JOIN libraries l ON l.id=f.library_id JOIN books b ON b.id=f.book_id WHERE b.format='pdf' AND f.status='available'").all() as Array<{ root: string; relative: string }>
  setImmediate(() => { void (async () => {
    for (const file of existingPdfs) {
      try {
        const library = validateLibraryPath(file.root, config)
        const source = fs.realpathSync(path.join(library, file.relative))
        if (!source.startsWith(library + path.sep) || fs.statSync(source).size > config.maxBookBytes) continue
        await preparePdf(source, config.dataDir)
      } catch (error) { console.error(JSON.stringify({ event: 'pdf_preparation_failed', message: error instanceof Error ? error.message : 'Preparation failed' })) }
    }
  })() })

  app.get('/api/v1/home', requireUser, (req, res) => {
    const continueReading = db.prepare(`${bookSelect()} WHERE p.progress_ratio > 0 AND p.completed=0 AND p.dismissed_from_continue=0 GROUP BY b.id ORDER BY p.last_read_at DESC LIMIT 12`).all(...bookParams(req)).map(mapBook)
    const recentlyAdded = db.prepare(`${bookSelect()} GROUP BY b.id ORDER BY b.added_at DESC LIMIT 18`).all(...bookParams(req)).map(mapBook)
    res.json({ continueReading, recentlyAdded })
  })
  app.get('/api/v1/books', requireUser, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 24))
    const filters: string[] = []; const values: unknown[] = []
    if (q) { filters.push(`(b.title LIKE ? ESCAPE '\\' OR COALESCE(b.author,'') LIKE ? ESCAPE '\\')`); values.push(pattern, pattern) }
    if (req.query.format === 'epub' || req.query.format === 'pdf') { filters.push('b.format=?'); values.push(req.query.format) }
    if (typeof req.query.author === 'string' && req.query.author) { filters.push('b.author=?'); values.push(req.query.author) }
    if (typeof req.query.series === 'string' && req.query.series) { filters.push('b.series=?'); values.push(req.query.series) }
    if (typeof req.query.genre === 'string' && req.query.genre) { filters.push('b.genres LIKE ?'); values.push(`%${JSON.stringify(req.query.genre).slice(1, -1)}%`) }
    if (req.query.favorite === 'true') filters.push('fav.book_id IS NOT NULL')
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : ''
    const order = req.query.sort === 'recent' ? 'b.added_at DESC' : req.query.sort === 'author' ? `COALESCE(b.author,''),b.title` : 'b.title'
    const rows = db.prepare(`${bookSelect()}${where} GROUP BY b.id ORDER BY ${order} LIMIT ? OFFSET ?`).all(...bookParams(req), ...values, pageSize, (page - 1) * pageSize)
    const count = db.prepare(`SELECT COUNT(DISTINCT b.id) AS count FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available' AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?)) LEFT JOIN favorites fav ON fav.book_id=b.id AND fav.user_id=?${where}`).get(req.user!.role, req.user!.id, req.user!.id, ...values) as { count: number }
    res.json({ books: rows.map(mapBook), query: q, pagination: { page, pageSize, total: count.count, pages: Math.max(1, Math.ceil(count.count / pageSize)) } })
  })
  app.get('/api/v1/books/:id', requireUser, (req, res) => {
    const row = db.prepare(`${bookSelect()} WHERE b.id=? GROUP BY b.id`).get(...bookParams(req), Number(req.params.id))
    if (!row) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    res.json({ book: mapBook(row) })
  })
  app.get('/api/v1/books/:id/content', requireUser, (req, res, next) => {
    const file = locateBookFile(db, Number(req.params.id), req.user!)
    if (!file || !fs.existsSync(file.filePath)) { apiError(res, 404, 'BOOK_FILE_NOT_FOUND', 'Book file is unavailable'); return }
    res.type(file.format === 'epub' ? 'application/epub+zip' : 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Cache-Control', 'private, no-cache')
    streamFile(req, res, file.filePath, next)
  })
  app.get('/api/v1/books/:id/cover', requireUser, async (req, res, next) => {
    const row = db.prepare(`SELECT b.cover_path AS coverPath FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available' WHERE b.id=? AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?)) LIMIT 1`).get(Number(req.params.id), req.user!.role, req.user!.id) as { coverPath: string | null } | undefined
    if (!row?.coverPath || !fs.existsSync(row.coverPath)) { res.status(404).end(); return }
    try {
      const coverPath = await ensureOptimizedCover(row.coverPath)
      if (coverPath !== row.coverPath) {
        const result = db.prepare('UPDATE books SET cover_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND cover_path=?').run(coverPath, Number(req.params.id), row.coverPath)
        const coversRoot = path.resolve(config.dataDir, 'covers')
        const oldCover = path.resolve(row.coverPath)
        const relative = path.relative(coversRoot, oldCover)
        if (result.changes && relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.promises.rm(oldCover, { force: true })
      }
      const stat = fs.statSync(coverPath)
      const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`
      res.type('image/jpeg')
      res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800')
      res.setHeader('ETag', etag)
      if (req.headers['if-none-match'] === etag) { res.status(304).end(); return }
      streamFile(req, res, coverPath, next)
    } catch (error) { next(error) }
  })
  app.get('/api/v1/books/:id/epub/manifest', requireUser, async (req, res, next) => {
    try {
      const file = locateBookFile(db, Number(req.params.id), req.user!); if (!file || file.format !== 'epub') { apiError(res, 404, 'EPUB_NOT_FOUND', 'EPUB is unavailable'); return }
      const info = await extractEpub(file.filePath)
      res.json({ title: info.title, chapters: info.chapters })
    } catch (error) { next(error) }
  })
  app.get('/api/v1/books/:id/epub/chapter', requireUser, async (req, res, next) => {
    try {
      const href = typeof req.query.href === 'string' ? req.query.href : ''
      const scale = Math.min(140, Math.max(80, Number(req.query.scale) || 100))
      const theme = ['light', 'sepia', 'dark'].includes(String(req.query.theme)) ? String(req.query.theme) : 'light'
      const lineHeight = ({ compact: 1.45, normal: 1.65, relaxed: 1.85 } as Record<string, number>)[String(req.query.lineHeight)] ?? 1.65
      const measure = ({ narrow: 42, normal: 56, wide: 72 } as Record<string, number>)[String(req.query.margins)] ?? 56
      const palette = theme === 'dark' ? { background: '#20201e', color: '#eeeeea' } : theme === 'sepia' ? { background: '#f4ead6', color: '#302a21' } : { background: '#ffffff', color: '#272520' }
      const file = locateBookFile(db, Number(req.params.id), req.user!); if (!file || file.format !== 'epub') { apiError(res, 404, 'EPUB_NOT_FOUND', 'EPUB is unavailable'); return }
      const html = (await readEpubChapter(file.filePath, href)).replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (_match, before, source, after) => `${before}/api/v1/books/${req.params.id}/epub/asset?chapter=${encodeURIComponent(href)}&src=${encodeURIComponent(source)}${after}`)
      res.type('html').send(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{width:100%;min-height:100%;margin:0;background:${palette.background};touch-action:pan-y}body{position:static;overflow-wrap:anywhere;color:${palette.color}}.reader-document{width:min(${measure}rem,100%);min-height:100%;margin:0 auto;padding:clamp(5rem,10vh,7rem) clamp(1rem,4vw,3rem) 6rem;font:${18 * scale / 100}px/${lineHeight} Georgia,serif}*,*:before,*:after{box-sizing:border-box;max-width:100%}img,svg,video,canvas{display:block;max-width:100%;height:auto;margin:auto}a{color:inherit;text-decoration:underline;text-underline-offset:.15em}@media(min-width:1100px) and (orientation:landscape){.reader-document{width:min(${measure + 24}rem,calc(100% - 4rem));column-count:2;column-width:28em;column-gap:clamp(4rem,7vw,8rem);column-rule:1px solid color-mix(in srgb,currentColor 14%,transparent)}h1,h2,h3,p,figure,blockquote{break-inside:avoid-column}}</style></head><body><main class="reader-document">${html}</main></body></html>`)
    } catch (error) { next(error) }
  })
  app.get('/api/v1/books/:id/epub/asset', requireUser, async (req, res, next) => {
    try {
      const chapter = typeof req.query.chapter === 'string' ? req.query.chapter : ''
      const source = typeof req.query.src === 'string' ? req.query.src : ''
      const file = locateBookFile(db, Number(req.params.id), req.user!); if (!file || file.format !== 'epub') { apiError(res, 404, 'EPUB_NOT_FOUND', 'EPUB is unavailable'); return }
      const asset = await readEpubAsset(file.filePath, chapter, source)
      res.setHeader('Cache-Control', 'private, max-age=86400')
      res.type(asset.contentType).send(asset.data)
    } catch (error) { next(error) }
  })
  app.get('/api/v1/books/:id/epub/search', requireUser, async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
      if (query.length < 2) { apiError(res, 400, 'INVALID_QUERY', 'Search requires at least 2 characters'); return }
      const file = locateBookFile(db, Number(req.params.id), req.user!); if (!file || file.format !== 'epub') { apiError(res, 404, 'EPUB_NOT_FOUND', 'EPUB is unavailable'); return }
      res.json({ results: await searchEpub(file.filePath, query) })
    } catch (error) { next(error) }
  })

  app.get('/api/v1/books/:id/pdf/reflow', requireUser, async (req, res, next) => {
    try {
      const file = locateBookFile(db, Number(req.params.id), req.user!)
      if (!file || file.format !== 'pdf') { apiError(res, 404, 'PDF_NOT_FOUND', 'PDF is unavailable'); return }
      const requestedPage = Number(req.query.page)
      const pageNumber = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1
      res.json(await readPreparedPdfPage(file.filePath, config.dataDir, pageNumber))
    } catch (error) { next(error) }
  })

  app.get('/api/v1/books/:id/pdf/figure', requireUser, async (req, res, next) => {
    try {
      const file = locateBookFile(db, Number(req.params.id), req.user!)
      if (!file || file.format !== 'pdf') { apiError(res, 404, 'PDF_NOT_FOUND', 'PDF is unavailable'); return }
      const asset = typeof req.query.asset === 'string' ? req.query.asset : ''
      if (!/^(?:[1-9]\d*-\d+\.png|font-[a-f0-9]+\.ttf)$/.test(asset)) { apiError(res, 400, 'INVALID_ASSET', 'Invalid figure'); return }
      const directory = await preparedPdfDirectory(file.filePath, config.dataDir)
      res.setHeader('Cache-Control', 'private, no-cache')
      res.sendFile(asset, { root: directory }, error => { if (error) { if ((error as any).status === 404) apiError(res, 404, 'ASSET_NOT_FOUND', 'Figure unavailable'); else next(error) } })
    } catch (error) { next(error) }
  })

  app.get('/api/v1/books/:id/pdf/page-image', requireUser, async (req, res, next) => {
    try {
      const file = locateBookFile(db, Number(req.params.id), req.user!)
      if (!file || file.format !== 'pdf') { apiError(res, 404, 'PDF_NOT_FOUND', 'PDF is unavailable'); return }
      const pageParam = Number(req.query.page)
      const requestedPage = Number.isFinite(pageParam) ? Math.max(1, Math.floor(pageParam)) : 1
      const stat = fs.statSync(file.filePath)
      const crop = req.query.crop === undefined ? undefined : z.string().transform(value => value.split(',').map(Number)).pipe(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().positive().max(1), z.number().positive().max(1)])).safeParse(req.query.crop)
      if (crop && (!crop.success || crop.data[0] + crop.data[2] > 1.001 || crop.data[1] + crop.data[3] > 1.001)) { apiError(res, 400, 'INVALID_CROP', 'Invalid page region'); return }
      const region = crop?.success ? crop.data : undefined
      const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}-${requestedPage}-${region?.join(',') ?? 'full'}"`
      res.setHeader('Cache-Control', 'private, no-cache')
      res.setHeader('ETag', etag)
      if (req.headers['if-none-match'] === etag) { res.status(304).end(); return }
      const task = getDocument({ data: new Uint8Array(await fs.promises.readFile(file.filePath)), useSystemFonts: false, standardFontDataUrl: pdfStandardFontDataUrl, cMapUrl: pdfCMapUrl, cMapPacked: true })
      const document = await task.promise
      try {
        const pageNumber = Math.min(document.numPages, requestedPage)
        const page = await document.getPage(pageNumber)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.max(.25, Math.min(1.5, 1400 / base.width, 1800 / base.height))
        const viewport = page.getViewport({ scale })
        const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
        const canvasContext = canvas.getContext('2d')
        await page.render({ canvas: canvas as any, canvasContext: canvasContext as any, viewport, background: '#ffffff' }).promise
        page.cleanup()
        res.type('png').setHeader('Content-Disposition', `inline; filename="page-${pageNumber}.png"`)
        if (region) {
          const x = Math.floor(region[0] * canvas.width), y = Math.floor(region[1] * canvas.height)
          const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(region[2] * canvas.width)))
          const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(region[3] * canvas.height)))
          const cropped = createCanvas(width, height)
          cropped.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height)
          res.send(cropped.toBuffer('image/png'))
        } else res.send(canvas.toBuffer('image/png'))
      } finally { await task.destroy() }
    } catch (error) { next(error) }
  })

  app.get('/api/v1/books/:id/progress', requireUser, (req, res) => {
    if (!locateBookFile(db, Number(req.params.id), req.user!)) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    const row = db.prepare('SELECT format, progress_ratio AS progressRatio, locator_type AS locatorType, locator_payload AS locatorPayload, completed, revision, last_read_at AS lastReadAt FROM reading_progress WHERE user_id=? AND book_id=?').get(req.user!.id, Number(req.params.id)) as any
    res.json({ progress: row ? { ...row, completed: Boolean(row.completed), locator: safeJson(row.locatorPayload), locatorPayload: undefined } : null })
  })
  app.put('/api/v1/books/:id/progress', requireUser, (req, res) => {
    const input = progressSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_PROGRESS', 'Progress payload is invalid'); return }
    if (!locateBookFile(db, Number(req.params.id), req.user!)) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    const book = db.prepare('SELECT id, format, page_count AS pageCount FROM books WHERE id=?').get(Number(req.params.id)) as any
    if (!book) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    if (book.format !== input.data.format) { apiError(res, 400, 'FORMAT_MISMATCH', 'Progress format does not match the book'); return }
    try {
      const normalized = normalizeProgress(book.format, input.data.locator as ReadingLocator, input.data.progressRatio, book.pageCount ?? undefined)
      const current = db.prepare('SELECT revision,format,progress_ratio AS progressRatio,locator_payload AS locatorPayload,completed,last_read_at AS lastReadAt FROM reading_progress WHERE user_id=? AND book_id=?').get(req.user!.id, book.id) as any
      if (current && input.data.revision !== undefined && input.data.revision !== current.revision) {
        apiError(res, 409, 'STALE_PROGRESS', 'Progress changed in another tab or device')
        res.end()
        return
      }
      const completed = input.data.completed ?? normalized.progressRatio >= 0.98
      db.prepare(`INSERT INTO reading_progress(user_id, book_id, format, progress_ratio, locator_type, locator_payload, completed,dismissed_from_continue)
        VALUES (?, ?, ?, ?, ?, ?, ?,0) ON CONFLICT(user_id, book_id) DO UPDATE SET progress_ratio=excluded.progress_ratio,
        locator_type=excluded.locator_type, locator_payload=excluded.locator_payload, completed=excluded.completed,
        dismissed_from_continue=0,revision=reading_progress.revision+1, last_read_at=CURRENT_TIMESTAMP`)
        .run(req.user!.id, book.id, book.format, normalized.progressRatio, normalized.locator.type, JSON.stringify(normalized.locator), completed ? 1 : 0)
      const saved = db.prepare('SELECT revision, last_read_at AS lastReadAt FROM reading_progress WHERE user_id=? AND book_id=?').get(req.user!.id, book.id) as Record<string, unknown>
      res.json({ progress: { ...normalized, format: book.format, completed, ...saved } })
    } catch (error) { apiError(res, 400, 'INVALID_LOCATOR', error instanceof Error ? error.message : 'Invalid locator') }
  })
  app.delete('/api/v1/books/:id/continue', requireUser, (req, res) => {
    db.prepare('UPDATE reading_progress SET dismissed_from_continue=1 WHERE user_id=? AND book_id=?').run(req.user!.id, Number(req.params.id))
    res.status(204).end()
  })
  app.post('/api/v1/books/:id/reopen', requireUser, (req, res) => {
    const result = db.prepare('UPDATE reading_progress SET completed=0,dismissed_from_continue=0,last_read_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE user_id=? AND book_id=?').run(req.user!.id, Number(req.params.id))
    if (!result.changes) { apiError(res, 404, 'PROGRESS_NOT_FOUND', 'Reading progress not found'); return }
    res.json({ reopened: true })
  })

  app.put('/api/v1/books/:id/favorite', requireUser, (req, res) => {
    if (!locateBookFile(db, Number(req.params.id), req.user!)) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    db.prepare('INSERT OR IGNORE INTO favorites(user_id,book_id) VALUES (?,?)').run(req.user!.id, Number(req.params.id))
    res.json({ favorite: true })
  })
  app.put('/api/v1/books/:id/rating', requireUser, (req, res) => {
    const input = ratingSchema.safeParse(req.body)
    if (!input.success || !locateBookFile(db, Number(req.params.id), req.user!)) { apiError(res, 400, 'INVALID_RATING', 'Rating must be between 0 and 5'); return }
    db.prepare(`INSERT INTO book_ratings(user_id,book_id,rating) VALUES (?,?,?) ON CONFLICT(user_id,book_id) DO UPDATE SET rating=excluded.rating,updated_at=CURRENT_TIMESTAMP`).run(req.user!.id, Number(req.params.id), input.data.rating)
    res.json({ rating: input.data.rating })
  })
  app.delete('/api/v1/books/:id/favorite', requireUser, (req, res) => {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND book_id=?').run(req.user!.id, Number(req.params.id))
    res.status(204).end()
  })
  app.get('/api/v1/books/:id/highlights', requireUser, (req, res) => {
    const bookId = Number(req.params.id)
    if (!locateBookFile(db, bookId, req.user!)) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    const rows = db.prepare(`SELECT id,quote_text AS quoteText,locator_payload AS locatorPayload,chapter,page_number AS pageNumber,rating,created_at AS createdAt,updated_at AS updatedAt FROM highlights WHERE user_id=? AND book_id=? ORDER BY created_at DESC`).all(req.user!.id, bookId) as any[]
    res.json({ highlights: rows.map(row => ({ ...row, locator: safeJson(row.locatorPayload), locatorPayload: undefined })) })
  })
  app.post('/api/v1/books/:id/highlights', requireUser, (req, res) => {
    const bookId = Number(req.params.id)
    const file = locateBookFile(db, bookId, req.user!)
    if (!file) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    const input = highlightSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_HIGHLIGHT', 'Highlight payload is invalid'); return }
    if (file.format === 'epub' && input.data.pageNumber) { apiError(res, 400, 'INVALID_HIGHLIGHT', 'EPUB highlights do not use absolute page numbers'); return }
    const result = db.prepare(`INSERT INTO highlights(user_id,book_id,quote_text,locator_payload,chapter,page_number) VALUES (?,?,?,?,?,?)`).run(req.user!.id, bookId, input.data.quoteText, JSON.stringify(input.data.locator), input.data.chapter ?? null, input.data.pageNumber ?? null)
    const row = db.prepare(`SELECT id,quote_text AS quoteText,locator_payload AS locatorPayload,chapter,page_number AS pageNumber,rating,created_at AS createdAt,updated_at AS updatedAt FROM highlights WHERE id=?`).get(result.lastInsertRowid) as any
    res.status(201).json({ highlight: { ...row, locator: safeJson(row.locatorPayload), locatorPayload: undefined } })
  })
  app.delete('/api/v1/highlights/:id', requireUser, (req, res) => {
    const result = db.prepare('DELETE FROM highlights WHERE id=? AND user_id=?').run(Number(req.params.id), req.user!.id)
    if (!result.changes) { apiError(res, 404, 'HIGHLIGHT_NOT_FOUND', 'Highlight not found'); return }
    res.status(204).end()
  })
  app.put('/api/v1/highlights/:id/rating', requireUser, (req, res) => {
    const input = ratingSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_RATING', 'Rating must be between 0 and 5'); return }
    const result = db.prepare('UPDATE highlights SET rating=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(input.data.rating, Number(req.params.id), req.user!.id)
    if (!result.changes) { apiError(res, 404, 'HIGHLIGHT_NOT_FOUND', 'Highlight not found'); return }
    res.json({ rating: input.data.rating })
  })
  app.get('/api/v1/catalog/authors', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT b.author AS name,COUNT(DISTINCT b.id) AS bookCount FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available' WHERE b.author IS NOT NULL AND b.author<>'' AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?)) GROUP BY b.author ORDER BY b.author COLLATE NOCASE`).all(req.user!.role, req.user!.id)
    res.json({ authors: rows })
  })
  app.get('/api/v1/catalog/series', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT b.series AS name,COUNT(DISTINCT b.id) AS bookCount FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available' WHERE b.series IS NOT NULL AND b.series<>'' AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?)) GROUP BY b.series ORDER BY b.series COLLATE NOCASE`).all(req.user!.role, req.user!.id)
    res.json({ series: rows })
  })
  app.get('/api/v1/catalog/genres', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT b.genres FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available' WHERE b.genres IS NOT NULL AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?)) GROUP BY b.id`).all(req.user!.role, req.user!.id) as Array<{ genres: string }>
    const counts = new Map<string, number>()
    for (const row of rows) for (const genre of (safeJson(row.genres) as string[] | null) ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1)
    res.json({ genres: [...counts].map(([name, bookCount]) => ({ name, bookCount })).sort((a, b) => a.name.localeCompare(b.name)) })
  })

  app.get('/api/v1/settings', requireUser, (req, res) => {
    const row = db.prepare(`SELECT theme,font_scale AS fontScale,line_height AS lineHeight,margins,app_theme AS appTheme,reduced_motion AS reducedMotion,pdf_invert AS pdfInvert FROM reader_preferences WHERE user_id=?`).get(req.user!.id) as any
    res.json({ preferences: row ? { ...row, reducedMotion: Boolean(row.reducedMotion), pdfInvert: Boolean(row.pdfInvert) } : { theme: 'light', fontScale: 100, lineHeight: 'normal', margins: 'normal', appTheme: 'system', reducedMotion: false, pdfInvert: false } })
  })
  app.put('/api/v1/settings', requireUser, (req, res) => {
    const input = preferenceSchema.safeParse(req.body); if (!input.success) { apiError(res, 400, 'INVALID_PREFERENCES', 'Reading preferences are invalid'); return }
    const value = input.data
    db.prepare(`INSERT INTO reader_preferences(user_id,theme,font_scale,line_height,margins,app_theme,reduced_motion,pdf_invert) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,font_scale=excluded.font_scale,line_height=excluded.line_height,margins=excluded.margins,app_theme=excluded.app_theme,reduced_motion=excluded.reduced_motion,pdf_invert=excluded.pdf_invert,updated_at=CURRENT_TIMESTAMP`).run(req.user!.id, value.theme, value.fontScale, value.lineHeight, value.margins, value.appTheme, value.reducedMotion ? 1 : 0, value.pdfInvert ? 1 : 0)
    res.json({ preferences: value })
  })
  app.put('/api/v1/account/password', requireUser, (req, res) => {
    const input = z.object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().min(12).max(1024) }).safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_PASSWORD', 'The new password must contain at least 12 characters'); return }
    const row = db.prepare('SELECT password_hash AS passwordHash FROM users WHERE id=?').get(req.user!.id) as { passwordHash: string }
    if (!verifyPassword(input.data.currentPassword, row.passwordHash)) { apiError(res, 401, 'INVALID_CREDENTIALS', 'Current password is incorrect'); return }
    db.transaction(() => { db.prepare('UPDATE users SET password_hash=?,password_changed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(input.data.newPassword), req.user!.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user!.id) })()
    const token = createSession(db, req.user!.id)
    res.cookie('litera_session', token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' })
    res.json({ changed: true })
  })

  app.get('/api/v1/admin/overview', requireAdmin, (_req, res) => {
    const books = (db.prepare(`SELECT COUNT(DISTINCT b.id) AS count FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available'`).get() as any).count
    const libraries = (db.prepare('SELECT COUNT(*) AS count FROM libraries').get() as any).count
    const users = (db.prepare('SELECT COUNT(*) AS count FROM users WHERE active=1').get() as any).count
    const ingestionErrors = (db.prepare(`SELECT COUNT(*) AS count FROM book_files WHERE status='error'`).get() as any).count
    const activeJobs = (db.prepare(`SELECT COUNT(*) AS count FROM scan_jobs WHERE status IN ('queued','running')`).get() as any).count
    const failedJobs = (db.prepare(`SELECT COUNT(*) AS count FROM scan_jobs WHERE status='failed'`).get() as any).count
    res.json({ books, libraries, users, ingestionErrors, activeJobs, failedJobs, status: 'healthy' })
  })
  app.get('/api/v1/admin/libraries', requireAdmin, (_req, res) => {
    const libraries = db.prepare(`SELECT l.*, COUNT(DISTINCT CASE WHEN f.status='available' THEN f.book_id END) AS bookCount,
      SUM(CASE WHEN f.status='error' THEN 1 ELSE 0 END) AS errorCount FROM libraries l LEFT JOIN book_files f ON f.library_id=l.id GROUP BY l.id ORDER BY l.name`).all()
    res.json({ libraries: libraries.map((row: any) => ({ ...row, rescanIntervalMinutes: row.rescan_interval_minutes, last_scan_summary: safeJson(row.last_scan_summary) })) })
  })
  app.post('/api/v1/admin/libraries', requireAdmin, (req, res) => {
    const input = librarySchema.safeParse(req.body); if (!input.success) { apiError(res, 400, 'INVALID_LIBRARY', 'Name and filesystem path are required'); return }
    try {
      const realPath = validateLibraryPath(input.data.path, config)
      const result = db.prepare('INSERT INTO libraries(name, path, rescan_interval_minutes) VALUES (?, ?, ?)').run(input.data.name, realPath, input.data.rescanIntervalMinutes)
      res.status(201).json({ library: { id: Number(result.lastInsertRowid), name: input.data.name, path: realPath, rescanIntervalMinutes: input.data.rescanIntervalMinutes } })
    } catch (error) { apiError(res, 400, 'INVALID_LIBRARY_PATH', error instanceof Error ? error.message : 'Invalid library path') }
  })
  app.put('/api/v1/admin/libraries/:id', requireAdmin, (req, res) => {
    const input = librarySchema.safeParse(req.body); if (!input.success) { apiError(res, 400, 'INVALID_LIBRARY', 'Name and filesystem path are required'); return }
    try {
      const realPath = validateLibraryPath(input.data.path, config)
      const result = db.prepare('UPDATE libraries SET name=?, path=?, rescan_interval_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.data.name, realPath, input.data.rescanIntervalMinutes, Number(req.params.id))
      if (!result.changes) { apiError(res, 404, 'LIBRARY_NOT_FOUND', 'Library not found'); return }
      res.json({ library: { id: Number(req.params.id), name: input.data.name, path: realPath, rescanIntervalMinutes: input.data.rescanIntervalMinutes } })
    } catch (error) { apiError(res, 400, 'INVALID_LIBRARY_PATH', error instanceof Error ? error.message : 'Invalid library path') }
  })
  app.post('/api/v1/admin/libraries/:id/scan', requireAdmin, async (req, res, next) => {
    try {
      const libraryId = Number(req.params.id)
      if (req.query.async === 'true') { const job = enqueueScanJob(db, config, libraryId, req.user!.id); res.status(202).json({ job }); return }
      const job = createScanJob(db, libraryId, req.user!.id)
      const completed = job.status === 'queued' ? await runScanJob(db, config, job.id) : job
      if (completed.status === 'failed') { apiError(res, 500, 'SCAN_FAILED', completed.error ?? 'Scan failed'); return }
      res.json({ report: completed.summary, job: completed })
    } catch (error) { next(error) }
  })
  app.get('/api/v1/admin/libraries/:id/errors', requireAdmin, (req, res) => {
    const errors = db.prepare(`SELECT f.relative_path AS file, f.ingestion_error AS message FROM book_files f WHERE f.library_id=? AND f.status='error' ORDER BY f.relative_path`).all(Number(req.params.id))
    res.json({ errors })
  })
  app.get('/api/v1/admin/jobs', requireAdmin, (req, res) => {
    const status = typeof req.query.status === 'string' && ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(req.query.status) ? req.query.status : undefined
    const rows = status
      ? db.prepare(`SELECT j.*,j.library_id AS libraryId,j.max_attempts AS maxAttempts,j.queued_at AS queuedAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.correlation_id AS correlationId,l.name AS libraryName FROM scan_jobs j JOIN libraries l ON l.id=j.library_id WHERE j.status=? ORDER BY j.id DESC LIMIT 100`).all(status)
      : db.prepare(`SELECT j.*,j.library_id AS libraryId,j.max_attempts AS maxAttempts,j.queued_at AS queuedAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.correlation_id AS correlationId,l.name AS libraryName FROM scan_jobs j JOIN libraries l ON l.id=j.library_id ORDER BY j.id DESC LIMIT 100`).all()
    res.json({ jobs: rows.map(mapScanJob) })
  })
  app.get('/api/v1/admin/jobs/:id', requireAdmin, (req, res) => {
    const row = db.prepare(`SELECT j.*,j.library_id AS libraryId,j.max_attempts AS maxAttempts,j.queued_at AS queuedAt,j.started_at AS startedAt,j.finished_at AS finishedAt,j.correlation_id AS correlationId,l.name AS libraryName FROM scan_jobs j JOIN libraries l ON l.id=j.library_id WHERE j.id=?`).get(Number(req.params.id))
    if (!row) { apiError(res, 404, 'JOB_NOT_FOUND', 'Job not found'); return }
    res.json({ job: mapScanJob(row) })
  })
  app.post('/api/v1/admin/jobs/:id/cancel', requireAdmin, (req, res) => {
    const result = db.prepare(`UPDATE scan_jobs SET status='cancelled',finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'`).run(Number(req.params.id))
    if (!result.changes) { apiError(res, 409, 'JOB_NOT_CANCELLABLE', 'Only queued jobs can be cancelled safely'); return }
    res.json({ cancelled: true })
  })
  app.post('/api/v1/admin/jobs/:id/retry', requireAdmin, (req, res) => {
    const result = db.prepare(`UPDATE scan_jobs SET status='queued',attempt=0,error=NULL,started_at=NULL,finished_at=NULL,queued_at=CURRENT_TIMESTAMP WHERE id=? AND status='failed'`).run(Number(req.params.id))
    if (!result.changes) { apiError(res, 409, 'JOB_NOT_RETRYABLE', 'Only failed jobs can be retried'); return }
    void runScanJob(db, config, Number(req.params.id))
    res.status(202).json({ queued: true })
  })

  app.get('/api/v1/admin/users', requireAdmin, (_req, res) => {
    const users = db.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.role,u.active,u.created_at AS createdAt,u.last_login_at AS lastLoginAt,GROUP_CONCAT(ul.library_id) AS libraryIds FROM users u LEFT JOIN user_libraries ul ON ul.user_id=u.id GROUP BY u.id ORDER BY u.username COLLATE NOCASE`).all().map((row: any) => ({ ...row, active: Boolean(row.active), libraryIds: row.libraryIds ? String(row.libraryIds).split(',').map(Number) : [] }))
    res.json({ users })
  })
  app.post('/api/v1/admin/users', requireAdmin, (req, res) => {
    const input = userSchema.safeParse(req.body); if (!input.success) { apiError(res, 400, 'INVALID_USER', 'User details are invalid'); return }
    try {
      const result = db.transaction(() => {
        const created = db.prepare('INSERT INTO users(username,display_name,password_hash,role,updated_at,password_changed_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(input.data.username, input.data.displayName, hashPassword(input.data.password), input.data.role)
        const userId = Number(created.lastInsertRowid)
        if (input.data.role === 'reader') for (const libraryId of input.data.libraryIds) db.prepare('INSERT INTO user_libraries(user_id,library_id) VALUES (?,?)').run(userId, libraryId)
        return userId
      })()
      res.status(201).json({ user: { id: result, username: input.data.username, displayName: input.data.displayName, role: input.data.role, active: true, libraryIds: input.data.libraryIds } })
    } catch { apiError(res, 409, 'USER_CONFLICT', 'Username already exists or a library is invalid') }
  })
  app.put('/api/v1/admin/users/:id', requireAdmin, (req, res) => {
    const userId = Number(req.params.id); const input = userUpdateSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_USER', 'User details are invalid'); return }
    const existing = db.prepare('SELECT id,role,active FROM users WHERE id=?').get(userId) as { id: number; role: string; active: number } | undefined
    if (!existing) { apiError(res, 404, 'USER_NOT_FOUND', 'User not found'); return }
    if (userId === req.user!.id && input.data.active === false) { apiError(res, 409, 'SELF_DEACTIVATION', 'You cannot deactivate your current account'); return }
    const nextRole = input.data.role ?? existing.role
    const nextActive = input.data.active ?? Boolean(existing.active)
    if (existing.role === 'admin' && (!nextActive || nextRole !== 'admin')) {
      const admins = (db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1`).get() as { count: number }).count
      if (admins <= 1) { apiError(res, 409, 'LAST_ADMIN', 'At least one active administrator is required'); return }
    }
    try {
      db.transaction(() => {
        db.prepare(`UPDATE users SET display_name=COALESCE(?,display_name),role=?,active=?,password_hash=COALESCE(?,password_hash),password_changed_at=CASE WHEN ? IS NULL THEN password_changed_at ELSE CURRENT_TIMESTAMP END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(input.data.displayName ?? null, nextRole, nextActive ? 1 : 0, input.data.password ? hashPassword(input.data.password) : null, input.data.password ?? null, userId)
        if (input.data.libraryIds || nextRole === 'admin') { db.prepare('DELETE FROM user_libraries WHERE user_id=?').run(userId); if (nextRole === 'reader') for (const libraryId of input.data.libraryIds ?? []) db.prepare('INSERT INTO user_libraries(user_id,library_id) VALUES (?,?)').run(userId, libraryId) }
        if (!nextActive || input.data.password) db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
      })()
      res.json({ updated: true })
    } catch { apiError(res, 409, 'USER_UPDATE_CONFLICT', 'The user could not be updated with those libraries') }
  })

  app.get('/api/v1/admin/metadata', requireAdmin, (_req, res) => {
    const enabled = (db.prepare(`SELECT value FROM system_settings WHERE key='metadata.openlibrary.enabled'`).get() as any)?.value === 'true'
    const contact = (db.prepare(`SELECT value FROM system_settings WHERE key='metadata.openlibrary.contact'`).get() as any)?.value ?? ''
    const cached = (db.prepare(`SELECT COUNT(*) AS count FROM metadata_cache WHERE provider='openlibrary' AND expires_at>CURRENT_TIMESTAMP`).get() as any).count
    const errors = (db.prepare(`SELECT COUNT(*) AS count FROM metadata_provider_results WHERE provider='openlibrary' AND status='error'`).get() as any).count
    res.json({ providers: [{ id: 'openlibrary', name: 'Open Library', enabled, contact, cached, errors, policy: 'Low-volume lookups; 7-day cache; embedded metadata is never overwritten blindly.' }] })
  })
  app.put('/api/v1/admin/metadata/openlibrary', requireAdmin, (req, res) => {
    const input = z.object({ enabled: z.boolean(), contact: z.string().trim().email().or(z.literal('')) }).safeParse(req.body)
    if (!input.success || (input.data.enabled && !input.data.contact)) { apiError(res, 400, 'INVALID_PROVIDER_CONFIG', 'An email contact is required when Open Library is enabled'); return }
    db.transaction(() => { db.prepare(`UPDATE system_settings SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key='metadata.openlibrary.enabled'`).run(String(input.data.enabled)); db.prepare(`UPDATE system_settings SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key='metadata.openlibrary.contact'`).run(input.data.contact) })()
    res.json({ provider: { id: 'openlibrary', enabled: input.data.enabled, contact: input.data.contact } })
  })
  app.post('/api/v1/admin/metadata/openlibrary/test', requireAdmin, async (_req, res) => {
    try { const provider = configuredMetadataProvider(config, db); if (!provider) { apiError(res, 409, 'PROVIDER_DISABLED', 'Enable the provider before testing it'); return }; await provider.search({ title: 'Pride and Prejudice', author: 'Jane Austen' }); res.json({ healthy: true }) } catch (error) { apiError(res, 503, 'PROVIDER_UNAVAILABLE', error instanceof Error ? error.message : 'Provider unavailable') }
  })
  app.get('/api/v1/admin/metadata/books', requireAdmin, (_req, res) => {
    const books = db.prepare(`SELECT id,title,author,description,language,identifier,format,genres,published_year AS publishedYear,series,series_index AS seriesIndex,metadata_status AS status,metadata_error AS error,metadata_provider AS provider,metadata_confidence AS confidence,metadata_provenance AS provenance,CASE WHEN cover_path IS NULL THEN 0 ELSE 1 END AS hasCover FROM books ORDER BY updated_at DESC LIMIT 500`).all() as any[]
    res.json({ books: books.map(book => ({ ...book, genres: safeJson(book.genres) ?? [], hasCover: Boolean(book.hasCover) })) })
  })
  app.put('/api/v1/admin/metadata/books/:id', requireAdmin, (req, res) => {
    const input = metadataEditSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_METADATA', 'Book metadata is invalid'); return }
    const value = input.data
    const result = db.prepare(`UPDATE books SET title=?,author=?,description=?,language=?,identifier=?,series=?,series_index=?,published_year=?,genres=?,metadata_status='matched',metadata_provider='manual',metadata_provenance='manual',metadata_confidence=1,metadata_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(value.title, value.author ?? null, value.description ?? null, value.language ?? null, value.identifier ?? null, value.series ?? null, value.seriesIndex ?? null, value.publishedYear ?? null, JSON.stringify(value.genres), Number(req.params.id))
    if (!result.changes) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    res.json({ updated: true })
  })
  app.put('/api/v1/admin/metadata/books/:id/cover', requireAdmin, async (req, res, next) => {
    const input = coverUploadSchema.safeParse(req.body)
    if (!input.success) { apiError(res, 400, 'INVALID_COVER', 'Use a JPEG, PNG or WebP image up to 8 MB'); return }
    const match = input.data.dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i)!
    const image = Buffer.from(match[2]!, 'base64')
    if (!image.length || image.length > 8 * 1024 * 1024) { apiError(res, 400, 'INVALID_COVER', 'Cover image must be no larger than 8 MB'); return }
    const bookId = Number(req.params.id)
    if (!db.prepare('SELECT id FROM books WHERE id=?').get(bookId)) { apiError(res, 404, 'BOOK_NOT_FOUND', 'Book not found'); return }
    const coverDir = path.join(config.dataDir, 'covers')
    try {
      const coverPath = await storeOptimizedCover(image, path.join(coverDir, `${bookId}-manual`))
      db.prepare(`UPDATE books SET cover_path=?,metadata_status='matched',metadata_provider='manual',metadata_provenance='manual',metadata_confidence=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(coverPath, bookId)
      res.json({ updated: true, hasCover: true })
    } catch (error) {
      if (error instanceof InvalidCoverError) { apiError(res, 400, 'INVALID_COVER', error.message); return }
      next(error)
    }
  })
  app.get('/api/v1/admin/compatibility', requireAdmin, (_req, res) => {
    const enabled = (db.prepare(`SELECT value FROM system_settings WHERE key='legacy.enabled'`).get() as any)?.value === 'true'
    res.json({ legacy: { enabled, target: 'Older WebKit / iOS 10 generation' } })
  })
  app.put('/api/v1/admin/compatibility', requireAdmin, (req, res) => {
    const input = z.object({ enabled: z.boolean() }).safeParse(req.body); if (!input.success) { apiError(res, 400, 'INVALID_SETTING', 'enabled must be a boolean'); return }
    db.prepare(`UPDATE system_settings SET value=?, updated_at=CURRENT_TIMESTAMP WHERE key='legacy.enabled'`).run(String(input.data.enabled))
    res.json({ legacy: { enabled: input.data.enabled } })
  })
  app.get('/api/v1/admin/system', requireAdmin, (_req, res) => {
    const migrations = db.prepare('SELECT version,applied_at AS appliedAt FROM schema_migrations ORDER BY version').all()
    const storage = fs.statfsSync(config.dataDir)
    const providerEnabled = (db.prepare(`SELECT value FROM system_settings WHERE key='metadata.openlibrary.enabled'`).get() as any)?.value === 'true'
    res.json({ version: '0.4.2', build: process.env.LITERA_BUILD ?? 'development', health: 'healthy', database: { engine: 'SQLite', journalMode: db.pragma('journal_mode', { simple: true }), migrations }, storage: { dataDir: config.dataDir, availableBytes: storage.bavail * storage.bsize }, allowedBookRoots: config.allowedBookRoots, secureCookies: config.secureCookies, metadataProvider: providerEnabled ? 'Open Library (enabled)' : 'Open Library (disabled)', maxBookBytes: config.maxBookBytes })
  })

  app.get(['/legacy', '/legacy/*path'], (req, res) => {
    const enabled = (db.prepare(`SELECT value FROM system_settings WHERE key='legacy.enabled'`).get() as any)?.value === 'true'
    if (!enabled) { res.status(404).type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>Litera compatibility mode</title></head><body><main><h1>Compatibility mode is disabled</h1><p>An administrator can enable it in Litera compatibility settings.</p></main></body></html>'); return }
    res.sendFile(path.join(projectRoot, 'src/legacy/index.html'))
  })
  app.use('/legacy-assets', express.static(path.join(projectRoot, 'src/legacy'), { fallthrough: false, etag: true, maxAge: '1h' }))
  app.use('/api', (_req, res) => apiError(res, 404, 'NOT_FOUND', 'Endpoint not found'))

  const webRoot = path.join(projectRoot, 'dist/web')
  if (fs.existsSync(webRoot)) {
    app.use(express.static(webRoot, { index: false }))
    app.get(['/', '/*path'], (_req, res) => res.sendFile(path.join(webRoot, 'index.html')))
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId: res.getHeader('X-Request-Id'), errorId: createHash('sha256').update(message).digest('hex').slice(0, 12) }))
    apiError(res, 500, 'INTERNAL_ERROR', 'The request could not be completed')
  })
  return { app, db }
}

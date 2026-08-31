import { randomUUID } from 'node:crypto'
import type { AppConfig } from './config.js'
import type { LiteraDatabase } from './database.js'
import { scanLibrary, type ScanReport } from './scanner.js'

export type ScanJob = {
  id: number
  libraryId: number
  libraryName?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  attempt: number
  maxAttempts: number
  queuedAt: string
  startedAt?: string
  finishedAt?: string
  summary?: ScanReport
  error?: string
  correlationId?: string
}

function safeJson(value?: string | null): ScanReport | undefined {
  if (!value) return undefined
  try { return JSON.parse(value) as ScanReport } catch { return undefined }
}

export function mapScanJob(row: any): ScanJob {
  return {
    id: row.id,
    libraryId: row.libraryId ?? row.library_id,
    libraryName: row.libraryName,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts ?? row.max_attempts,
    queuedAt: row.queuedAt ?? row.queued_at,
    startedAt: row.startedAt ?? row.started_at ?? undefined,
    finishedAt: row.finishedAt ?? row.finished_at ?? undefined,
    summary: safeJson(row.summary),
    error: row.error ?? undefined,
    correlationId: row.correlationId ?? row.correlation_id ?? undefined,
  }
}

export function createScanJob(db: LiteraDatabase, libraryId: number, userId?: number): ScanJob {
  const library = db.prepare('SELECT id FROM libraries WHERE id=?').get(libraryId)
  if (!library) throw new Error('Library not found')
  const active = db.prepare(`SELECT * FROM scan_jobs WHERE library_id=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`).get(libraryId)
  if (active) return mapScanJob(active)
  const result = db.prepare(`INSERT INTO scan_jobs(library_id,status,requested_by,correlation_id) VALUES (?,'queued',?,?)`).run(libraryId, userId ?? null, randomUUID())
  return mapScanJob(db.prepare('SELECT * FROM scan_jobs WHERE id=?').get(Number(result.lastInsertRowid)))
}

export async function runScanJob(db: LiteraDatabase, config: AppConfig, jobId: number): Promise<ScanJob> {
  const claimed = db.prepare(`UPDATE scan_jobs SET status='running',attempt=attempt+1,started_at=CURRENT_TIMESTAMP,finished_at=NULL,error=NULL WHERE id=? AND status='queued'`).run(jobId)
  if (!claimed.changes) return mapScanJob(db.prepare('SELECT * FROM scan_jobs WHERE id=?').get(jobId))
  const row = db.prepare('SELECT library_id AS libraryId,attempt,max_attempts AS maxAttempts FROM scan_jobs WHERE id=?').get(jobId) as { libraryId: number; attempt: number; maxAttempts: number }
  try {
    const report = await scanLibrary(db, config, row.libraryId, jobId)
    db.prepare(`UPDATE scan_jobs SET status='completed',summary=?,finished_at=CURRENT_TIMESTAMP WHERE id=?`).run(JSON.stringify(report), jobId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scan failed'
    const retry = row.attempt < row.maxAttempts
    db.prepare(`UPDATE scan_jobs SET status=?,error=?,finished_at=CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END,started_at=CASE WHEN ? THEN NULL ELSE started_at END WHERE id=?`).run(retry ? 'queued' : 'failed', message, retry ? 1 : 0, retry ? 1 : 0, jobId)
    if (retry) setTimeout(() => { void runScanJob(db, config, jobId) }, 250)
  }
  return mapScanJob(db.prepare('SELECT * FROM scan_jobs WHERE id=?').get(jobId))
}

export function enqueueScanJob(db: LiteraDatabase, config: AppConfig, libraryId: number, userId?: number): ScanJob {
  const job = createScanJob(db, libraryId, userId)
  if (job.status === 'queued') setImmediate(() => { void runScanJob(db, config, job.id) })
  return job
}

export function resumeScanJobs(db: LiteraDatabase, config: AppConfig): void {
  const jobs = db.prepare(`SELECT id FROM scan_jobs WHERE status='queued' ORDER BY queued_at,id`).all() as Array<{ id: number }>
  for (const job of jobs) setImmediate(() => { void runScanJob(db, config, job.id) })
}

export function enqueueDueLibraryScans(db: LiteraDatabase, config: AppConfig): ScanJob[] {
  const libraries = db.prepare(`SELECT l.id FROM libraries l
    WHERE l.rescan_interval_minutes > 0
      AND (l.last_scan_at IS NULL OR datetime(l.last_scan_at, '+' || l.rescan_interval_minutes || ' minutes') <= CURRENT_TIMESTAMP)
      AND NOT EXISTS (SELECT 1 FROM scan_jobs j WHERE j.library_id=l.id AND j.status IN ('queued','running'))`).all() as Array<{ id: number }>
  return libraries.map(({ id }) => enqueueScanJob(db, config, id))
}

export function startAutomaticScans(db: LiteraDatabase, config: AppConfig): () => void {
  const tick = () => {
    try { enqueueDueLibraryScans(db, config) }
    catch (error) { console.error(JSON.stringify({ level: 'error', event: 'automatic_scan_tick_failed', message: error instanceof Error ? error.message : 'Unknown error' })) }
  }
  tick()
  const timer = setInterval(tick, 60_000)
  timer.unref()
  return () => clearInterval(timer)
}

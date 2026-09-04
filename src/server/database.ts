import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { AppConfig } from './config.js'

export const migrations = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'reader')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_scan_at TEXT,
    last_scan_status TEXT,
    last_scan_summary TEXT
  );
  CREATE TABLE books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    description TEXT,
    language TEXT,
    identifier TEXT,
    cover_path TEXT,
    format TEXT NOT NULL CHECK(format IN ('epub', 'pdf')),
    page_count INTEGER,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE book_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    identity TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('available', 'missing', 'error')),
    ingestion_error TEXT,
    UNIQUE(library_id, identity),
    UNIQUE(library_id, relative_path)
  );
  CREATE TABLE reading_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK(format IN ('epub', 'pdf')),
    progress_ratio REAL NOT NULL,
    locator_type TEXT NOT NULL,
    locator_payload TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, book_id)
  );
  CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO system_settings(key, value) VALUES ('legacy.enabled', 'false');
  CREATE INDEX books_search ON books(title, author);
  CREATE INDEX progress_recent ON reading_progress(user_id, last_read_at DESC);
  `,
  `
  ALTER TABLE books ADD COLUMN genres TEXT;
  ALTER TABLE books ADD COLUMN published_year INTEGER;
  ALTER TABLE books ADD COLUMN metadata_provider TEXT;
  ALTER TABLE books ADD COLUMN provider_record_key TEXT;
  CREATE TABLE metadata_provider_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_key TEXT,
    status TEXT NOT NULL CHECK(status IN ('matched', 'not_found', 'error')),
    payload TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE users ADD COLUMN updated_at TEXT;
  ALTER TABLE users ADD COLUMN password_changed_at TEXT;
  ALTER TABLE users ADD COLUMN last_login_at TEXT;
  ALTER TABLE sessions ADD COLUMN revoked_at TEXT;
  ALTER TABLE books ADD COLUMN series TEXT;
  ALTER TABLE books ADD COLUMN series_index REAL;
  ALTER TABLE books ADD COLUMN metadata_confidence REAL;
  ALTER TABLE books ADD COLUMN metadata_provenance TEXT;
  ALTER TABLE books ADD COLUMN metadata_status TEXT;
  ALTER TABLE books ADD COLUMN metadata_error TEXT;
  ALTER TABLE book_files ADD COLUMN fingerprint TEXT;
  ALTER TABLE book_files ADD COLUMN last_seen_job_id INTEGER;
  ALTER TABLE reading_progress ADD COLUMN dismissed_from_continue INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE metadata_provider_results ADD COLUMN confidence REAL;
  ALTER TABLE metadata_provider_results ADD COLUMN provenance TEXT;

  CREATE TABLE user_libraries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, library_id)
  );
  INSERT OR IGNORE INTO user_libraries(user_id, library_id)
    SELECT u.id, l.id FROM users u CROSS JOIN libraries l WHERE u.role = 'reader';

  CREATE TABLE reader_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'light',
    font_scale INTEGER NOT NULL DEFAULT 100,
    line_height TEXT NOT NULL DEFAULT 'normal',
    margins TEXT NOT NULL DEFAULT 'normal',
    app_theme TEXT NOT NULL DEFAULT 'system',
    reduced_motion INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, book_id)
  );
  CREATE TABLE scan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT,
    summary TEXT,
    error TEXT,
    correlation_id TEXT
  );
  CREATE TABLE metadata_cache (
    provider TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, cache_key)
  );
  INSERT OR IGNORE INTO system_settings(key, value) VALUES ('metadata.openlibrary.enabled', 'false');
  INSERT OR IGNORE INTO system_settings(key, value) VALUES ('metadata.openlibrary.contact', '');

  CREATE INDEX book_files_fingerprint ON book_files(library_id, fingerprint);
  CREATE INDEX book_files_status ON book_files(library_id, status);
  CREATE INDEX scan_jobs_status ON scan_jobs(status, queued_at);
  CREATE INDEX scan_jobs_library ON scan_jobs(library_id, queued_at DESC);
  CREATE INDEX favorites_user ON favorites(user_id, created_at DESC);
  CREATE INDEX user_libraries_library ON user_libraries(library_id, user_id);
  CREATE INDEX books_author ON books(author COLLATE NOCASE);
  CREATE INDEX books_series ON books(series COLLATE NOCASE);
  `,
  `
  CREATE TABLE highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    quote_text TEXT NOT NULL,
    locator_payload TEXT NOT NULL,
    chapter TEXT,
    page_number INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX highlights_user_book ON highlights(user_id, book_id, created_at DESC);
  `,
  `
  ALTER TABLE reader_preferences ADD COLUMN pdf_invert INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE libraries ADD COLUMN rescan_interval_minutes INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE highlights ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5);
  CREATE TABLE book_ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, book_id)
  );
  `,
  `
  CREATE TABLE sync_operations (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, operation_id)
  );
  `,
]

export type LiteraDatabase = Database.Database

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, saltText, hashText] = encoded.split(':')
  if (scheme !== 'scrypt' || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, 'base64')
  const actual = scryptSync(password, Buffer.from(saltText, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

export function openDatabase(config: AppConfig): LiteraDatabase {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const db = new Database(path.join(config.dataDir, 'litera.sqlite'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => row.version))
  const hadBetaSchema = applied.has(3)
  migrations.forEach((sql, index) => {
    const version = index + 1
    if (!applied.has(version)) db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version) })()
  })
  db.prepare(`UPDATE scan_jobs SET status='queued', started_at=NULL, error=COALESCE(error, 'Recovered after restart') WHERE status='running'`).run()
  if (!hadBetaSchema) {
    db.prepare(`UPDATE system_settings SET value=? WHERE key='metadata.openlibrary.enabled'`).run(String(config.openLibraryEnabled))
    db.prepare(`UPDATE system_settings SET value=? WHERE key='metadata.openlibrary.contact'`).run(config.openLibraryContact ?? '')
  }
  bootstrapAdmin(db, config)
  return db
}

function bootstrapAdmin(db: LiteraDatabase, config: AppConfig): void {
  const count = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count
  if (count > 0) return
  if (!config.adminUsername || !config.adminPassword) {
    throw new Error('A fresh installation requires LITERA_ADMIN_USERNAME and LITERA_ADMIN_PASSWORD')
  }
  if (config.adminPassword.length < 12) throw new Error('LITERA_ADMIN_PASSWORD must contain at least 12 characters')
  db.prepare('INSERT INTO users(username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(config.adminUsername, config.adminUsername, hashPassword(config.adminPassword), 'admin')
}

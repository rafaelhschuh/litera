import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { LiteraDatabase } from './database.js'

export type SessionUser = { id: number; username: string; displayName: string; role: 'admin' | 'reader' }

declare global {
  namespace Express {
    interface Request { user?: SessionUser }
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function parseCookies(value?: string): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(value.split(';').map((part) => part.trim().split('=')).filter((pair) => pair.length === 2).map(([key, val]) => [key!, decodeURIComponent(val!)]))
}

export function createSession(db: LiteraDatabase, userId: number): string {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires)
  return token
}

export function deleteSession(db: LiteraDatabase, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
}

export function sessionMiddleware(db: LiteraDatabase) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie).litera_session
    if (token) {
      const row = db.prepare(`SELECT u.id, u.username, u.display_name AS displayName, u.role
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND s.revoked_at IS NULL AND u.active = 1`).get(tokenHash(token)) as SessionUser | undefined
      if (row) req.user = row
    }
    next()
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }); return }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }); return }
  if (req.user.role !== 'admin') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access required' } }); return }
  next()
}

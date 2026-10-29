import { z } from 'zod'
import type { LiteraDatabase } from './database.js'
import type { SessionUser } from './auth.js'
import { activeSeconds, dateInZone, emptyActivity, type ActivityEvent, type ActivityDay } from '../shared/reading-activity.js'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value })
const zone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } })
export const activityEventSchema = z.object({
  eventId: z.uuid(), sessionId: z.uuid(), startedAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  seconds: z.number().int().min(1).max(30), day: date, timeZone: zone,
}).refine(value => {
  try {
    const start = Date.parse(value.startedAt), end = Date.parse(value.endedAt)
    return start >= Date.UTC(2020, 0, 1) && end <= Date.now() + 300_000 && end > start && end - start <= 35_000
      && value.seconds * 1000 <= end - start + 1000 && dateInZone(new Date(start), value.timeZone) === value.day && dateInZone(new Date(end - 1), value.timeZone) === value.day
  } catch { return false }
})
export const activityQuerySchema = z.object({
  from: date, to: date, timeZone: zone,
  knownEventIds: z.array(z.uuid()).max(10_000).default([]), bookIds: z.array(z.number().int().positive()).max(10_000).default([]),
}).refine(value => { const span = Date.parse(value.to) - Date.parse(value.from); return span >= 0 && span <= 365 * 86_400_000 })

export function readingActivity(db: LiteraDatabase, user: SessionUser, input: z.infer<typeof activityQuerySchema>) {
  const result = emptyActivity(input.from, input.to, input.timeZone)
  const allowed = db.prepare(`SELECT DISTINCT b.id,b.title,b.author FROM books b JOIN book_files f ON f.book_id=b.id AND f.status='available'
    WHERE (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.library_id=f.library_id AND ul.user_id=?))`).all(user.role, user.id) as Array<{ id: number; title: string; author?: string }>
  const allowedIds = new Set(allowed.map(book => book.id))
  result.allowedBookIds = input.bookIds.filter(id => allowedIds.has(id))
  const events = (db.prepare(`SELECT event_id AS eventId, session_id AS sessionId, book_id AS bookId,started_at AS startedAt,ended_at AS endedAt,seconds,day,time_zone AS timeZone
    FROM reading_activity WHERE user_id=? AND day BETWEEN ? AND ?`).all(user.id, input.from, input.to) as ActivityEvent[]).filter(event => allowedIds.has(event.bookId))
  const highlights = (db.prepare(`SELECT book_id AS bookId,created_at AS createdAt FROM highlights WHERE user_id=? AND created_at>=? AND created_at<=?`).all(user.id, new Date(Date.parse(input.from) - 86_400_000).toISOString().slice(0, 10), new Date(Date.parse(input.to) + 2 * 86_400_000).toISOString().slice(0, 10)) as Array<{ bookId: number; createdAt: string }>).filter(item => allowedIds.has(item.bookId)).map(item => ({ ...item, day: dateInZone(new Date(item.createdAt.includes('T') ? item.createdAt : item.createdAt.replace(' ', 'T') + 'Z'), input.timeZone) }))
  // Index once: cost follows recorded intervals, not catalog × days × intervals.
  const byDay = new Map<string, ActivityEvent[]>(), byBook = new Map<number, Map<string, ActivityEvent[]>>()
  const highlightDays = new Map<string, number>(), highlightBooks = new Map<number, Map<string, number>>()
  for (const event of events) {
    const day = byDay.get(event.day) ?? []; day.push(event); byDay.set(event.day, day)
    const book = byBook.get(event.bookId) ?? new Map<string, ActivityEvent[]>()
    const bookDay = book.get(event.day) ?? []; bookDay.push(event); book.set(event.day, bookDay); byBook.set(event.bookId, book)
  }
  for (const item of highlights) {
    if (item.day < input.from || item.day > input.to) continue
    highlightDays.set(item.day, (highlightDays.get(item.day) ?? 0) + 1)
    const book = highlightBooks.get(item.bookId) ?? new Map<string, number>()
    book.set(item.day, (book.get(item.day) ?? 0) + 1); highlightBooks.set(item.bookId, book)
  }
  const populate = (day: ActivityDay, selected: ActivityEvent[], count: number) => {
    day.seconds = activeSeconds(selected); day.sessionIds = [...new Set(selected.map(event => event.sessionId))]
    day.bookIds = [...new Set(selected.map(event => event.bookId))]; day.highlights = count
  }
  for (const day of result.days) populate(day, byDay.get(day.date) ?? [], highlightDays.get(day.date) ?? 0)
  const bookIndex = new Map(allowed.map(book => [book.id, book]))
  for (const id of new Set([...byBook.keys(), ...highlightBooks.keys()])) {
    const book = bookIndex.get(id)!, bookEvents = byBook.get(id), bookHighlights = highlightBooks.get(id)
    const days: ActivityDay[] = []
    for (const day of new Set([...(bookEvents?.keys() ?? []), ...(bookHighlights?.keys() ?? [])])) {
      const entry: ActivityDay = { date: day, seconds: 0, sessionIds: [], bookIds: [], highlights: 0 }
      populate(entry, bookEvents?.get(day) ?? [], bookHighlights?.get(day) ?? 0); days.push(entry)
    }
    result.books.push({ ...book, days: days.sort((a, b) => a.date.localeCompare(b.date)) })
  }
  for (let index = 0; index < input.knownEventIds.length; index += 500) {
    const ids = input.knownEventIds.slice(index, index + 500)
    const rows = db.prepare(`SELECT event_id AS id FROM reading_activity WHERE user_id=? AND event_id IN (${ids.map(() => '?').join(',')})`).all(user.id, ...ids) as Array<{ id: string }>
    result.includedEventIds.push(...rows.map(row => row.id))
  }
  const first = db.prepare(`SELECT MIN(day) AS day FROM reading_activity a WHERE user_id=? AND EXISTS (SELECT 1 FROM book_files f WHERE f.book_id=a.book_id AND f.status='available' AND (?='admin' OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.user_id=? AND ul.library_id=f.library_id)))`).get(user.id, user.role, user.id) as { day: string | null }
  result.recordingSince = first.day; result.updatedAt = new Date().toISOString()
  return result
}

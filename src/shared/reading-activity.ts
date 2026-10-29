export type ActivityEvent = {
  eventId: string; sessionId: string; bookId: number; startedAt: string; endedAt: string
  seconds: number; day: string; timeZone: string
}
export type ActivityDay = { date: string; seconds: number; sessionIds: string[]; bookIds: number[]; highlights: number }
export type ActivityBook = { id: number; title: string; author?: string; days: ActivityDay[] }
export type ReadingActivity = {
  from: string; to: string; timeZone: string; days: ActivityDay[]; books: ActivityBook[]
  includedEventIds: string[]; allowedBookIds: number[]; recordingSince: string | null
  offline?: boolean; pending?: number; updatedAt?: string
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function emptyActivity(from: string, to: string, timeZone: string): ReadingActivity {
  const days: ActivityDay[] = []
  for (const date = new Date(`${from}T12:00:00Z`); localDateUtc(date) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push({ date: localDateUtc(date), seconds: 0, sessionIds: [], bookIds: [], highlights: 0 })
    if (days.length >= 366) break
  }
  return { from, to, timeZone, days, books: [], includedEventIds: [], allowedBookIds: [], recordingSince: null }
}
function localDateUtc(date: Date) { return date.toISOString().slice(0, 10) }
/** Count overlapping intervals only once, including simultaneous devices. */
export function activeSeconds(events: ActivityEvent[]): number {
  const intervals = events.map(event => [Date.parse(event.endedAt) - event.seconds * 1000, Date.parse(event.endedAt)] as const).sort((a, b) => a[0] - b[0])
  let total = 0, end = 0
  for (const [start, finish] of intervals) { total += Math.max(0, finish - Math.max(start, end)); end = Math.max(end, finish) }
  return Math.round(total / 1000)
}
export function overlayActivity(base: ReadingActivity, events: ActivityEvent[], titles: Map<number, { title: string; author?: string }>): ReadingActivity {
  const result: ReadingActivity = JSON.parse(JSON.stringify(base)), included = new Set(base.includedEventIds)
  const additions = new Map<ActivityDay, ActivityEvent[]>()
  const unique = new Map(events.filter(event => !included.has(event.eventId) && event.day >= base.from && event.day <= base.to).map(event => [event.eventId, event]))
  for (const event of unique.values()) {
    if (!base.offline && !base.allowedBookIds.includes(event.bookId)) continue
    const day = result.days.find(item => item.date === event.day)
    if (!day) continue
    let book = result.books.find(item => item.id === event.bookId)
    if (!book) { book = { id: event.bookId, title: titles.get(event.bookId)?.title ?? 'Livro', author: titles.get(event.bookId)?.author, days: [] }; result.books.push(book) }
    let bookDay = book.days.find(item => item.date === event.day)
    if (!bookDay) { bookDay = { date: event.day, seconds: 0, sessionIds: [], bookIds: [event.bookId], highlights: 0 }; book.days.push(bookDay) }
    for (const item of [day, bookDay]) {
      const intervals = additions.get(item) ?? []; intervals.push(event); additions.set(item, intervals)
      if (!item.sessionIds.includes(event.sessionId)) item.sessionIds.push(event.sessionId)
      if (!item.bookIds.includes(event.bookId)) item.bookIds.push(event.bookId)
    }
    if (!result.recordingSince || event.day < result.recordingSince) result.recordingSince = event.day
  }
  for (const [day, intervals] of additions) day.seconds += activeSeconds(intervals)
  return result
}

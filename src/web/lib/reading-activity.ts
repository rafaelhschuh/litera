import { api } from './api'
import { claimActivityLease, releaseActivityLease } from './offline-sync'
import { getOfflineUser, offlineContext } from './offline-context'
import { localDate, type ActivityEvent } from '../../shared/reading-activity'

/** Active reading estimate: foreground + focus + recent input, never wall-clock
 * time while a reader is loading, paused, covered by its panels, or suspended. */
export function trackReadingActivity(bookId: number, ready: () => boolean, readerDocument: () => Document | undefined) {
  const userId = getOfflineUser(), generation = offlineContext.generation
  if (!userId || !globalThis.crypto?.getRandomValues) return () => undefined
  const uuid = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  const owner = uuid()
  let eligible = false
  let sessionId = uuid(), lastInput = Date.now(), lastWall = Date.now(), lastMonotonic = performance.now()
  let stopped = false, working = false, observed: Document | undefined
  let buffer: { start: number; end: number; seconds: number; day: string; timeZone: string } | undefined
  const sameAccount = () => getOfflineUser() === userId && offlineContext.generation === generation
  const events = ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const
  const flush = () => {
    const value = buffer; buffer = undefined
    if (!value || value.seconds < 1 || !sameAccount()) return
    const body: ActivityEvent = { eventId: uuid(), sessionId, bookId, startedAt: new Date(value.start).toISOString(), endedAt: new Date(value.end).toISOString(), seconds: Math.min(30, Math.floor(value.seconds)), day: value.day, timeZone: value.timeZone }
    // The existing outbox persists first and replays the immutable event ID.
    void api(`/api/v1/books/${bookId}/activity`, { method: 'POST', body: JSON.stringify(body) }).catch(() => { /* Sync/storage feedback owns operational errors; reading stays usable. */ })
  }
  const input = (event: Event) => {
    if (!event.isTrusted) return
    const now = Date.now()
    if (now - lastInput >= 120_000) pause()
    lastInput = now
  }
  const bind = (target: Document | undefined, add: boolean) => {
    for (const type of events) if (add) target?.addEventListener(type, input, { capture: true, passive: true }); else target?.removeEventListener(type, input, true)
  }
  const pause = () => { eligible = false; flush(); sessionId = uuid(); lastWall = Date.now(); lastMonotonic = performance.now(); void releaseActivityLease(userId, owner).catch(() => undefined) }
  const visibility = () => { if (document.visibilityState === 'hidden') pause(); else { lastInput = Date.now(); lastWall = Date.now(); lastMonotonic = performance.now() } }
  const focus = () => { lastInput = Date.now(); lastWall = Date.now(); lastMonotonic = performance.now() }
  async function tick() {
    if (stopped || working) return
    working = true
    try {
      const now = Date.now(), monotonic = performance.now(), start = lastWall, elapsed = now - start
      lastWall = now
      const clockStable = elapsed > 0 && elapsed <= 10_000 && Math.abs(elapsed - (monotonic - lastMonotonic)) < 2000
      lastMonotonic = monotonic
      const next = readerDocument()
      if (observed !== next) { bind(observed, false); observed = next; bind(observed, true) }
      if (!sameAccount() || !ready() || document.visibilityState !== 'visible' || !document.hasFocus() || !clockStable || now - lastInput >= 120_000) {
        flush()
        if (eligible) sessionId = uuid()
        eligible = false; return
      }
      if (!eligible) { eligible = true; return }
      if (!await claimActivityLease(userId!, owner) || stopped || !sameAccount() || !ready() || document.visibilityState !== 'visible' || !document.hasFocus()) { flush(); eligible = false; return }
      const end = Math.min(now, lastInput + 120_000)
      let cursor = start
      while (cursor < end) {
        const date = new Date(cursor), midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
        const finish = Math.min(end, midnight), day = localDate(date), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        if (buffer && (buffer.day !== day || buffer.timeZone !== timeZone)) flush()
        buffer ??= { start: cursor, end: finish, seconds: 0, day, timeZone }
        buffer.end = finish; buffer.seconds += (finish - cursor) / 1000
        if (buffer.seconds >= 15 || finish === midnight) flush()
        cursor = finish
      }
    } catch { flush() } finally { working = false }
  }
  bind(document, true)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('blur', pause); window.addEventListener('focus', focus); window.addEventListener('pagehide', pause)
  const timer = window.setInterval(() => { void tick() }, 5000)
  return () => {
    stopped = true; window.clearInterval(timer); pause(); bind(document, false); bind(observed, false)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('blur', pause); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', pause)
  }
}

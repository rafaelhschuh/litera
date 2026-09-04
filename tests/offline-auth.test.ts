import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn(async () => undefined), clearReading: vi.fn(async () => undefined), flush: vi.fn(async () => undefined), sync: { online: true } }))
vi.mock('../src/web/lib/pwa', () => ({ setActiveOfflineUser: context.set, clearOfflineUser: context.clear }))
vi.mock('../src/web/lib/offline-sync', () => ({ clearReadingUser: context.clearReading, flushOfflineSync: context.flush, syncState: context.sync }))
const user = { id: 7, username: 'reader', displayName: 'Leitora', role: 'reader' }
let values: Map<string, string>
let request: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  values = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  const events = new EventTarget()
  vi.stubGlobal('window', Object.assign(events, { setTimeout, location: { replace: vi.fn() } }))
  request = vi.fn(); vi.stubGlobal('fetch', request)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('offline authentication boundaries', () => {
  it('does not invent a session when the device has never authenticated', async () => {
    request.mockRejectedValue(new TypeError('Network unavailable'))
    const { loadSession, auth } = await import('../src/web/lib/auth')
    await loadSession()
    expect(auth).toEqual({ user: null, ready: true })
    expect(context.set).toHaveBeenLastCalledWith()
  })

  it('restores only the previously authenticated local context on a network failure', async () => {
    values.set('litera-offline-session', JSON.stringify(user))
    request.mockRejectedValue(new TypeError('Network unavailable'))
    const { loadSession, auth } = await import('../src/web/lib/auth')
    await loadSession()
    expect(auth.user).toEqual(user)
    expect(context.sync.online).toBe(false)
    expect(context.set).toHaveBeenCalledWith(7)
  })

  it('hides rejected sessions without deleting unsent changes before reauthentication', async () => {
    values.set('litera-offline-session', JSON.stringify(user))
    request.mockResolvedValue(new Response('{}', { status: 401 }))
    const { loadSession, auth } = await import('../src/web/lib/auth')
    await loadSession()
    expect(auth.user).toBeNull()
    expect(context.clear).not.toHaveBeenCalled()
    expect(context.clearReading).not.toHaveBeenCalled()
    expect(context.set).toHaveBeenLastCalledWith()
    expect(values.has('litera-offline-session')).toBe(false)
    request.mockResolvedValue(Response.json({ user }))
    await loadSession()
    expect(auth.user).toEqual(user)
    expect(context.set).toHaveBeenLastCalledWith(7)
  })

  it('persists offline logout intent and does not restore an unrevoked HttpOnly session', async () => {
    const { rememberSession, signOut, loadSession, auth } = await import('../src/web/lib/auth')
    await rememberSession(user as any)
    request.mockRejectedValue(new TypeError('Network unavailable'))
    await signOut()
    expect(auth.user).toBeNull()
    expect(values.get('litera-logout-pending')).toBe(JSON.stringify({ userId: 7 }))
    expect(values.has('litera-offline-session')).toBe(false)
    request.mockReset().mockResolvedValue(new Response(null, { status: 204 }))
    await loadSession()
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]![0]).toBe('/api/v1/auth/logout')
    expect(values.has('litera-logout-pending')).toBe(false)
    expect(auth.user).toBeNull()
  })

  it('does not make localStorage a dependency of a successful online login', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new DOMException('denied', 'SecurityError') }, setItem: () => { throw new DOMException('denied', 'SecurityError') }, removeItem: () => { throw new DOMException('denied', 'SecurityError') } })
    request.mockResolvedValue(Response.json({ user }))
    const { loadSession, auth } = await import('../src/web/lib/auth')
    await loadSession()
    expect(auth.user).toEqual(user)
    expect(auth.ready).toBe(true)
  })

  it('retains the logout user id until both revocation and local cleanup succeed', async () => {
    context.clear.mockRejectedValueOnce(new DOMException('blocked', 'UnknownError'))
    request.mockRejectedValueOnce(new TypeError('offline'))
    const { rememberSession, signOut, loadSession } = await import('../src/web/lib/auth')
    await rememberSession(user as any)
    await signOut()
    expect(values.get('litera-logout-pending')).toBe(JSON.stringify({ userId: 7 }))
    context.clear.mockResolvedValue(undefined)
    request.mockResolvedValue(new Response(null, { status: 204 }))
    await loadSession()
    expect(values.has('litera-logout-pending')).toBe(false)
    expect(context.clear).toHaveBeenLastCalledWith(7)
  })

  it('keeps another account data isolated when the cookie identity changes', async () => {
    values.set('litera-offline-session', JSON.stringify(user))
    const second = { ...user, id: 8, username: 'second' }
    request.mockResolvedValue(Response.json({ user: second }))
    const { loadSession, auth } = await import('../src/web/lib/auth')
    await loadSession()
    expect(auth.user).toEqual(second)
    expect(context.clear).not.toHaveBeenCalled()
    expect(context.clearReading).not.toHaveBeenCalled()
  })
})

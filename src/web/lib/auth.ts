import { reactive } from 'vue'
import { clearOfflineUser, setActiveOfflineUser } from './pwa'
import { clearReadingUser, flushOfflineSync, syncState } from './offline-sync'

export type User = { id: number; username: string; displayName: string; role: 'admin' | 'reader' }
export const auth = reactive<{ user: User | null; ready: boolean }>({ user: null, ready: false })
const OFFLINE_SESSION_KEY = 'litera-offline-session'
const LOGOUT_KEY = 'litera-logout-pending'

function stored(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function store(key: string, value?: string): void {
  try { if (value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value) }
  catch { /* Online reading remains usable when local storage is denied. */ }
}

function logoutUser(): number | undefined {
  try { const value = JSON.parse(stored(LOGOUT_KEY) ?? 'null'); return Number.isSafeInteger(value?.userId) && value.userId > 0 ? value.userId : undefined }
  catch { return undefined }
}

export async function rememberSession(user: User): Promise<void> {
  const pendingUser = logoutUser()
  if (stored(LOGOUT_KEY)) {
    if (pendingUser && !await clearUser(pendingUser)) throw new Error('Não foi possível concluir a limpeza do logout anterior. Recarregue e tente novamente.')
    store(LOGOUT_KEY)
  }
  auth.user = user
  store(OFFLINE_SESSION_KEY, JSON.stringify(user))
  setActiveOfflineUser(user.id)
  void flushOfflineSync()
}

function cachedSession(): User | null {
  try {
    const value = JSON.parse(stored(OFFLINE_SESSION_KEY) ?? 'null')
    return value && Number.isInteger(value.id) && value.id > 0 && typeof value.username === 'string' && typeof value.displayName === 'string' && ['admin', 'reader'].includes(value.role) ? value as User : null
  } catch { return null }
}

function forgetSession(): void {
  store(OFFLINE_SESSION_KEY)
  setActiveOfflineUser()
  auth.user = null
}

export async function loadSession(): Promise<void> {
  if (stored(LOGOUT_KEY)) { forgetSession(); await completePendingLogout(); auth.ready = true; return }
  const cached = cachedSession()
  try {
    const response = await sessionRequest('/api/v1/auth/me')
    if (response.status >= 500) throw new TypeError('Servidor indisponível')
    // Expiration hides the context but is not an explicit data deletion. Keep
    // unsent reading changes scoped to that user until authenticated again.
    if (!response.ok) forgetSession()
    else {
      const user = (await response.json()).user as User
      await rememberSession(user)
      syncState.online = true
    }
  } catch {
    syncState.online = false
    if (cached) { auth.user = cached; setActiveOfflineUser(cached.id) }
    else forgetSession()
  }
  auth.ready = true
}

export async function signOut(): Promise<void> {
  const userId = auth.user?.id
  if (userId) store(LOGOUT_KEY, JSON.stringify({ userId }))
  forgetSession()
  await completePendingLogout()
}

async function sessionRequest(url: string, method = 'GET'): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5000)
  try { return await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal }) }
  finally { clearTimeout(timer) }
}
async function clearUser(userId: number): Promise<boolean> {
  const results = await Promise.allSettled([clearOfflineUser(userId), clearReadingUser(userId)])
  return results.every(result => result.status === 'fulfilled')
}
async function revokePendingLogout(): Promise<boolean> {
  if (!stored(LOGOUT_KEY)) return true
  try {
    const response = await sessionRequest('/api/v1/auth/logout', 'POST')
    if (!response.ok) return false
    return true
  } catch { return false }
}
async function completePendingLogout(): Promise<void> {
  const marker = stored(LOGOUT_KEY)
  if (!marker) return
  const userId = logoutUser()
  const [revoked, cleared] = await Promise.all([revokePendingLogout(), userId ? clearUser(userId) : Promise.resolve(true)])
  if (revoked && cleared) store(LOGOUT_KEY)
}
// Cookies are shared between tabs: stop the old account before it can submit another update.
window.addEventListener('storage', event => {
  if (![OFFLINE_SESSION_KEY, LOGOUT_KEY].includes(event.key ?? '')) return
  if (stored(LOGOUT_KEY) || cachedSession()?.id !== auth.user?.id) {
    auth.user = null
    setActiveOfflineUser()
    window.location.replace('/login')
  }
})
window.addEventListener('online', () => { void completePendingLogout() })

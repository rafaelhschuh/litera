import { reactive } from 'vue'
import { ApiError, api } from './api'
import { clearOfflineUser, setActiveOfflineUser } from './pwa'

export type User = { id: number; username: string; displayName: string; role: 'admin' | 'reader' }
export const auth = reactive<{ user: User | null; ready: boolean }>({ user: null, ready: false })
const OFFLINE_SESSION_KEY = 'litera-offline-session'

export function rememberSession(user: User): void {
  auth.user = user
  window.localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(user))
  setActiveOfflineUser(user.id)
}

function cachedSession(): User | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(OFFLINE_SESSION_KEY) ?? 'null')
    return value && Number.isInteger(value.id) && typeof value.username === 'string' ? value as User : null
  } catch { return null }
}

function forgetSession(): void {
  window.localStorage.removeItem(OFFLINE_SESSION_KEY)
  setActiveOfflineUser()
  auth.user = null
}

export async function loadSession(): Promise<void> {
  try { rememberSession((await api<{ user: User }>('/api/v1/auth/me')).user) }
  catch (error) {
    if (error instanceof TypeError) { const cached = cachedSession(); if (cached) rememberSession(cached); else forgetSession() }
    else { if (error instanceof ApiError && error.status === 401) { const cached = cachedSession(); if (cached) void clearOfflineUser(cached.id) }; forgetSession() }
  }
  auth.ready = true
}

export async function signOut(): Promise<void> {
  const userId = auth.user?.id
  try { await api('/api/v1/auth/logout', { method: 'POST' }) } catch (error) { if (!(error instanceof TypeError)) throw error }
  finally { forgetSession(); if (userId) await clearOfflineUser(userId) }
}

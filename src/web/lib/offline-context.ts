import { reactive } from 'vue'

// This identifies an already authenticated local context; it is never a credential.
export const offlineContext = reactive<{ userId?: number; generation: number }>({ generation: 0 })
export function getOfflineUser(): number | undefined { return offlineContext.userId }
export function setOfflineContext(userId?: number): void {
  if (offlineContext.userId === userId) return
  offlineContext.generation++
  offlineContext.userId = userId
  window.dispatchEvent(new Event('litera-account-changed'))
}

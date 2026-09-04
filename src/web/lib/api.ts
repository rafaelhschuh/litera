import { offlineRequest } from './offline-sync'

export { ApiError } from './offline-sync'

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  return offlineRequest<T>(url, options)
}

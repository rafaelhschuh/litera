/** Optional Android integration; the website remains independently usable. */
type AndroidWindow = Window & { LiteraAndroid?: { postMessage: (message: string) => void } }

export function hasAndroidHost(): boolean {
  return typeof window !== 'undefined' && window.top === window && typeof (window as AndroidWindow).LiteraAndroid?.postMessage === 'function'
}

export function openAndroidSettings(): boolean {
  if (!hasAndroidHost()) return false
  try { (window as AndroidWindow).LiteraAndroid!.postMessage(JSON.stringify({ type: 'settings' })); return true }
  catch { return false }
}

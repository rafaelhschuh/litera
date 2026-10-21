import { ref } from 'vue'

export type AppTheme = 'system' | 'light' | 'dark'

export const appTheme = ref<AppTheme>('system')
export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'original'

let media: MediaQueryList | undefined

function resolvedTheme(theme: AppTheme): 'light' | 'dark' {
  return theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme
}

function updateBrowserTheme(): void {
  const root = document.documentElement
  const reader = root.dataset.readerTheme
  const scheme = reader ? (reader === 'dark' || reader === 'original' ? 'dark' : 'light') : resolvedTheme(appTheme.value)
  root.dataset.theme = scheme
  root.style.colorScheme = scheme
  const token = reader === 'original' ? '--reader-canvas' : reader ? '--reader-page' : '--bg'
  const color = getComputedStyle(root).getPropertyValue(token).trim()
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

export function applyReaderTheme(theme?: ReaderTheme): void {
  if (theme) document.documentElement.dataset.readerTheme = theme
  else delete document.documentElement.dataset.readerTheme
  updateBrowserTheme()
}

export function applyTheme(theme: AppTheme): void {
  appTheme.value = theme
  document.documentElement.dataset.themePreference = theme
  updateBrowserTheme()
}

export function initializeTheme(): void {
  media = window.matchMedia('(prefers-color-scheme: dark)')
  let cached: string | null = null
  try { cached = window.localStorage.getItem('litera-theme') } catch { /* Storage is optional for online reading. */ }
  applyTheme(cached === 'light' || cached === 'dark' || cached === 'system' ? cached : 'system')
  media.addEventListener?.('change', () => {
    if (appTheme.value === 'system') applyTheme('system')
  })
}

export function rememberTheme(theme: AppTheme): void {
  try { window.localStorage.setItem('litera-theme', theme) } catch { /* Keep the current visual choice in memory. */ }
  applyTheme(theme)
}

import { ref } from 'vue'

export type AppTheme = 'system' | 'light' | 'dark'

export const appTheme = ref<AppTheme>('system')

let media: MediaQueryList | undefined

function resolvedTheme(theme: AppTheme): 'light' | 'dark' {
  return theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme
}

export function applyTheme(theme: AppTheme): void {
  appTheme.value = theme
  document.documentElement.dataset.theme = resolvedTheme(theme)
  document.documentElement.dataset.themePreference = theme
  document.documentElement.style.colorScheme = resolvedTheme(theme)
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

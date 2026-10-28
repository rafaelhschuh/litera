/** Shared destinations for the desktop/tablet sidebar and the phone's More sheet. */
export const adminNavigation = [
  { label: 'Visão geral', icon: 'home', to: '/admin' },
  { label: 'Bibliotecas', icon: 'library', to: '/admin/libraries' },
  { label: 'Usuários', icon: 'users', to: '/admin/users' },
  { label: 'Metadata', icon: 'sparkles', to: '/admin/metadata' },
  { label: 'Jobs', icon: 'refresh', to: '/admin/jobs' },
  { label: 'Compatibilidade', icon: 'monitor', to: '/admin/compatibility', section: 'Sistema' },
  { label: 'Sistema', icon: 'settings', to: '/admin/system' },
]

export function adminDestinationActive(current: string, destination: string): boolean {
  return current.replace(/\/+$/, '') === destination || (destination !== '/admin' && current.startsWith(destination + '/'))
}

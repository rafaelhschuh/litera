import path from 'node:path'

export type AppConfig = {
  port: number
  dataDir: string
  allowedBookRoots: string[]
  adminUsername?: string
  adminPassword?: string
  secureCookies: boolean
  publicOrigin?: string
  openLibraryEnabled: boolean
  openLibraryContact?: string
  maxBookBytes: number
}

export function loadConfig(env = process.env): AppConfig {
  const roots = (env.LITERA_BOOK_ROOTS ?? '/books').split(',').map((item) => path.resolve(item.trim())).filter(Boolean)
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: path.resolve(env.LITERA_DATA_DIR ?? './data'),
    allowedBookRoots: roots,
    adminUsername: env.LITERA_ADMIN_USERNAME,
    adminPassword: env.LITERA_ADMIN_PASSWORD,
    secureCookies: env.LITERA_SECURE_COOKIES === 'true',
    publicOrigin: env.LITERA_PUBLIC_ORIGIN || undefined,
    openLibraryEnabled: env.LITERA_OPENLIBRARY_ENABLED === 'true',
    openLibraryContact: env.LITERA_OPENLIBRARY_CONTACT || undefined,
    maxBookBytes: Math.max(1, Number(env.LITERA_MAX_BOOK_MB ?? 512)) * 1024 * 1024,
  }
}

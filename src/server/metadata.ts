import { createHash } from 'node:crypto'
import type { AppConfig } from './config.js'
import type { LiteraDatabase } from './database.js'

export type MetadataCriteria = { title: string; author?: string; identifier?: string }
export type MetadataCandidate = {
  provider: string
  key: string
  title: string
  author?: string
  publishedYear?: number
  genres?: string[]
  languages?: string[]
  identifiers?: string[]
  confidence?: number
  provenance?: string
}
export type NormalizedMetadata = MetadataCandidate & { description?: string; series?: string; seriesIndex?: number }

export interface MetadataProvider {
  readonly id: string
  search(criteria: MetadataCriteria): Promise<MetadataCandidate[]>
  getDetails(candidate: MetadataCandidate): Promise<NormalizedMetadata>
}

type OpenLibraryDocument = {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  subject?: string[]
  language?: string[]
  isbn?: string[]
}

function normalized(value?: string): string {
  return (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function metadataConfidence(criteria: MetadataCriteria, candidate: MetadataCandidate): { confidence: number; provenance: string } {
  const wantedIdentifier = criteria.identifier?.replace(/[^0-9X]/gi, '').toUpperCase()
  if (wantedIdentifier && candidate.identifiers?.some((item) => item.replace(/[^0-9X]/gi, '').toUpperCase() === wantedIdentifier)) return { confidence: 0.99, provenance: 'exact-identifier' }
  const titleExact = normalized(criteria.title) === normalized(candidate.title)
  const authorExact = Boolean(criteria.author && candidate.author && normalized(criteria.author) === normalized(candidate.author))
  if (titleExact && authorExact) return { confidence: 0.92, provenance: 'exact-title-author' }
  if (titleExact) return { confidence: 0.78, provenance: 'exact-title' }
  return { confidence: 0.45, provenance: 'provider-ranking' }
}

function cacheKey(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export class OpenLibraryProvider implements MetadataProvider {
  readonly id = 'openlibrary'
  constructor(private readonly contact: string, private readonly db?: LiteraDatabase) {}

  private async getJson(url: URL): Promise<any> {
    const key = cacheKey(url.toString())
    const cached = this.db?.prepare(`SELECT payload FROM metadata_cache WHERE provider=? AND cache_key=? AND expires_at>CURRENT_TIMESTAMP`).get(this.id, key) as { payload: string } | undefined
    if (cached) return JSON.parse(cached.payload)
    let lastError: Error | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': `Litera/0.2 (${this.contact})`, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
        if (!response.ok) {
          const error = new Error(`Open Library returned HTTP ${response.status}`)
          if (response.status !== 429 && response.status < 500) throw error
          lastError = error
          const retryAfter = Math.min(2, Number(response.headers.get('retry-after')) || attempt + 1)
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 250))
          continue
        }
        const data = await response.json()
        this.db?.prepare(`INSERT INTO metadata_cache(provider,cache_key,payload,expires_at) VALUES (?,?,?,datetime('now','+7 days')) ON CONFLICT(provider,cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,created_at=CURRENT_TIMESTAMP`).run(this.id, key, JSON.stringify(data))
        return data
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Metadata provider failed')
        if (attempt < 2 && (lastError.name === 'TimeoutError' || lastError.name === 'AbortError')) continue
        throw lastError
      }
    }
    throw lastError ?? new Error('Metadata provider failed')
  }

  async search(criteria: MetadataCriteria): Promise<MetadataCandidate[]> {
    const url = new URL('https://openlibrary.org/search.json')
    const isbn = criteria.identifier?.replace(/[^0-9X]/gi, '')
    if (isbn && [10, 13].includes(isbn.length)) url.searchParams.set('isbn', isbn)
    else { url.searchParams.set('title', criteria.title); if (criteria.author) url.searchParams.set('author', criteria.author) }
    url.searchParams.set('fields', 'key,title,author_name,first_publish_year,subject,language,isbn')
    url.searchParams.set('limit', '3')
    const data = await this.getJson(url)
    const documents: OpenLibraryDocument[] = Array.isArray(data.docs) ? data.docs : []
    return documents.flatMap((document): MetadataCandidate[] => {
      if (!document.key || !document.title) return []
      const candidate: MetadataCandidate = { provider: this.id, key: document.key, title: document.title, author: document.author_name?.[0], publishedYear: document.first_publish_year, genres: document.subject?.slice(0, 8), languages: document.language?.slice(0, 3), identifiers: document.isbn?.slice(0, 12) }
      return [{ ...candidate, ...metadataConfidence(criteria, candidate) }]
    }).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  }

  async getDetails(candidate: MetadataCandidate): Promise<NormalizedMetadata> {
    if (!candidate.key.startsWith('/works/')) return candidate
    const data = await this.getJson(new URL(`${candidate.key}.json`, 'https://openlibrary.org'))
    const description = typeof data.description === 'string' ? data.description : typeof data.description?.value === 'string' ? data.description.value : undefined
    return { ...candidate, description, genres: Array.isArray(data.subjects) ? data.subjects.slice(0, 8) : candidate.genres }
  }
}

export function configuredMetadataProvider(config: AppConfig, db?: LiteraDatabase): MetadataProvider | undefined {
  const enabledSetting = db?.prepare(`SELECT value FROM system_settings WHERE key='metadata.openlibrary.enabled'`).get() as { value: string } | undefined
  const contactSetting = db?.prepare(`SELECT value FROM system_settings WHERE key='metadata.openlibrary.contact'`).get() as { value: string } | undefined
  const enabled = enabledSetting ? enabledSetting.value === 'true' : config.openLibraryEnabled
  const contact = contactSetting?.value || config.openLibraryContact
  if (!enabled) return undefined
  if (!contact) return undefined
  return new OpenLibraryProvider(contact, db)
}

import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import sanitizeHtml from 'sanitize-html'
import yauzl from 'yauzl'

type ZipEntry = { fileName: string; uncompressedSize: number }
type ManifestItem = { id: string; href: string; mediaType: string; properties?: string }
export type EpubInfo = {
  title: string
  author?: string
  identifier?: string
  language?: string
  genres?: string[]
  series?: string
  seriesIndex?: number
  cover?: { data: Buffer; extension: string }
  chapters: Array<{ id: string; href: string; label: string }>
  opfDirectory: string
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, parseTagValue: false, trimValues: true })

function arrayOf<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value] }
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (value && typeof value === 'object' && '#text' in value) return String((value as { '#text': unknown })['#text']).trim() || undefined
  return undefined
}

async function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => error || !zip ? reject(error ?? new Error('Invalid EPUB archive')) : resolve(zip)))
}

async function readArchiveEntry(filePath: string, target: string, maxBytes: number): Promise<Buffer> {
  const zip = await openZip(filePath)
  try { return await readEntry(zip, target, maxBytes) } finally { zip.close() }
}

async function readEntry(zip: yauzl.ZipFile, target: string, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => { zip.removeListener('entry', onEntry); zip.removeListener('end', onEnd); zip.removeListener('error', onError) }
    const fail = (error: Error) => { if (!settled) { settled = true; cleanup(); reject(error) } }
    const onError = (error: Error) => fail(error)
    const onEnd = () => fail(new Error(`EPUB entry not found: ${target}`))
    const onEntry = (entry: ZipEntry) => {
      if (entry.fileName !== target) { zip.readEntry(); return }
      if (entry.uncompressedSize > maxBytes) { fail(new Error(`EPUB entry exceeds ${maxBytes} bytes`)); return }
      zip.openReadStream(entry as yauzl.Entry, (error, stream) => {
        if (error || !stream) { fail(error ?? new Error('Unable to read EPUB entry')); return }
        const chunks: Buffer[] = []
        let total = 0
        stream.on('data', (chunk: Buffer) => { total += chunk.length; if (total > maxBytes) stream.destroy(new Error('EPUB entry expanded beyond limit')); else chunks.push(chunk) })
        stream.once('error', fail)
        stream.once('end', () => { if (!settled) { settled = true; cleanup(); resolve(Buffer.concat(chunks)) } })
      })
    }
    zip.on('entry', onEntry)
    zip.once('end', onEnd)
    zip.once('error', onError)
    zip.readEntry()
  })
}

async function packagePath(zip: yauzl.ZipFile): Promise<string> {
  const container = parser.parse((await readEntry(zip, 'META-INF/container.xml', 1024 * 1024)).toString('utf8'))
  const rootfile = arrayOf(container?.container?.rootfiles?.rootfile)[0]
  const fullPath = rootfile?.['full-path']
  if (typeof fullPath !== 'string' || fullPath.includes('..')) throw new Error('EPUB container has an invalid package path')
  return fullPath
}

export async function extractEpub(filePath: string): Promise<EpubInfo> {
  const zip = await openZip(filePath)
  try {
    const opfPath = await packagePath(zip)
    const opf = parser.parse((await readEntry(zip, opfPath, 4 * 1024 * 1024)).toString('utf8'))?.package
    if (!opf) throw new Error('EPUB package document is invalid')
    const metadata = opf.metadata ?? {}
    const manifest: ManifestItem[] = arrayOf(opf.manifest?.item).map((item: any) => ({ id: item.id, href: item.href, mediaType: item['media-type'], properties: item.properties }))
    const byId = new Map(manifest.map((item) => [item.id, item]))
    const spine = arrayOf(opf.spine?.itemref).map((item: any) => byId.get(item.idref)).filter((item): item is ManifestItem => Boolean(item))
    const title = textOf(arrayOf(metadata.title)[0]) ?? path.basename(filePath, path.extname(filePath))
    const author = textOf(arrayOf(metadata.creator)[0])
    const identifier = textOf(arrayOf(metadata.identifier)[0])
    const language = textOf(arrayOf(metadata.language)[0])
    const genres = arrayOf(metadata.subject).map(textOf).filter((item): item is string => Boolean(item))
    const series = arrayOf(metadata.meta).find((item: any) => item?.name === 'calibre:series')?.content
    const seriesIndexValue = Number(arrayOf(metadata.meta).find((item: any) => item?.name === 'calibre:series_index')?.content)
    const coverId = arrayOf(metadata.meta).find((item: any) => item?.name === 'cover')?.content
    const coverItem = manifest.find((item) => item.id === coverId || item.properties?.split(/\s+/).includes('cover-image'))
    let cover: EpubInfo['cover']
    if (coverItem) {
      const entryPath = path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), coverItem.href))
      // The cover may appear earlier than the package document in the ZIP. A fresh
      // lazy reader avoids continuing from the package entry and missing it.
      if (!entryPath.startsWith('../')) cover = { data: await readArchiveEntry(filePath, entryPath, 12 * 1024 * 1024), extension: path.extname(coverItem.href) || '.jpg' }
    }
    return {
      title, author, identifier, language, genres, series: typeof series === 'string' ? series : undefined, seriesIndex: Number.isFinite(seriesIndexValue) ? seriesIndexValue : undefined, cover,
      chapters: spine.map((item, index) => ({ id: item.id, href: item.href, label: `Capítulo ${index + 1}` })),
      opfDirectory: path.posix.dirname(opfPath),
    }
  } finally { zip.close() }
}

export async function readEpubChapter(filePath: string, href: string): Promise<string> {
  const info = await extractEpub(filePath)
  if (!info.chapters.some((chapter) => chapter.href === href)) throw new Error('Chapter is not in the EPUB spine')
  const zip = await openZip(filePath)
  try {
    const entryPath = path.posix.normalize(path.posix.join(info.opfDirectory, href))
    const html = (await readEntry(zip, entryPath, 5 * 1024 * 1024)).toString('utf8')
    return sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['html', 'head', 'body', 'title', 'section', 'article', 'figure', 'figcaption', 'img', 'svg', 'path']),
      allowedAttributes: { '*': ['id', 'class', 'title', 'lang', 'dir'], a: ['href', 'target', 'rel', 'data-epub-href'], img: ['src', 'alt', 'width', 'height'], svg: ['viewBox'], path: ['d'] },
      allowedSchemes: ['http', 'https'],
      allowProtocolRelative: false,
      transformTags: {
        a: (_tag, attrs) => {
          const href = attrs.href?.trim() ?? ''
          let attribs: Record<string, string>
          if (/^https?:\/\//i.test(href)) attribs = { href, target: '_blank', rel: 'noopener noreferrer' }
          else if (href.startsWith('#')) attribs = { href }
          else attribs = { href: '#', 'data-epub-href': href }
          return { tagName: 'a', attribs }
        },
      },
    })
  } finally { zip.close() }
}

export async function readEpubAsset(filePath: string, chapterHref: string, source: string): Promise<{ data: Buffer; contentType: string }> {
  const info = await extractEpub(filePath)
  if (!info.chapters.some((chapter) => chapter.href === chapterHref)) throw new Error('Chapter is not in the EPUB spine')
  const cleanSource = decodeURIComponent(source.split('#')[0] ?? '')
  if (!cleanSource || /^[a-z]+:/i.test(cleanSource) || cleanSource.startsWith('//')) throw new Error('Invalid EPUB resource')
  const chapterPath = path.posix.normalize(path.posix.join(info.opfDirectory, chapterHref))
  const entryPath = path.posix.normalize(path.posix.join(path.posix.dirname(chapterPath), cleanSource))
  if (entryPath.startsWith('../') || path.posix.isAbsolute(entryPath)) throw new Error('Invalid EPUB resource path')
  const extension = path.extname(entryPath).toLocaleLowerCase()
  const contentType = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string, string>)[extension]
  if (!contentType) throw new Error('Unsupported EPUB resource type')
  return { data: await readArchiveEntry(filePath, entryPath, 20 * 1024 * 1024), contentType }
}

export async function searchEpub(filePath: string, query: string): Promise<Array<{ href: string; label: string; excerpt: string }>> {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (normalizedQuery.length < 2) return []
  const info = await extractEpub(filePath)
  const results: Array<{ href: string; label: string; excerpt: string }> = []
  for (const chapter of info.chapters.slice(0, 100)) {
    const html = await readEpubChapter(filePath, chapter.href)
    const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim()
    const index = text.toLocaleLowerCase().indexOf(normalizedQuery)
    if (index >= 0) results.push({ href: chapter.href, label: chapter.label, excerpt: text.slice(Math.max(0, index - 60), index + normalizedQuery.length + 100) })
    if (results.length >= 20) break
  }
  return results
}

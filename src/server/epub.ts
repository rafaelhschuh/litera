import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import postcss, { type ChildNode, type Declaration } from 'postcss'
import sanitizeHtml from 'sanitize-html'
import sharp from 'sharp'
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

const assetTypes: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/png', // SVG is sanitized and rasterized, never returned as XML.
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css; charset=utf-8',
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

// Resolve URLs only inside the ZIP, never against the host filesystem. Parent
// segments are needed by real EPUBs (Text/../Fonts), but cannot escape its root.
function resourcePath(base: string, source: string): string {
  const clean = decodeURIComponent(source.split('#')[0] ?? '')
  if (!clean || clean !== clean.trim() || /[\\:%?]/.test(clean) || hasControlCharacters(clean) || clean.startsWith('/')) throw new Error('Invalid EPUB resource path')
  const segments = base === '.' ? [] : base.split('/')
  for (const segment of clean.split('/')) {
    if (segment === '..') {
      if (!segments.length) throw new Error('Invalid EPUB resource path')
      segments.pop()
    } else if (segment && segment !== '.') segments.push(segment)
  }
  if (!segments.length) throw new Error('Invalid EPUB resource path')
  return segments.join('/')
}

type CssContext = { chapterHref: string; chapterPath: string; basePath: string; bookId?: string | number }

function assetUrl(context: CssContext, source: string, kind: 'image' | 'font' | 'css'): string | undefined {
  try {
    const target = resourcePath(path.posix.dirname(context.basePath), source)
    const contentType = assetTypes[path.posix.extname(target).toLowerCase()]
    if (!contentType?.startsWith(kind === 'css' ? 'text/css' : `${kind}/`)) return undefined
    if (context.bookId === undefined) return undefined
    // src always stays relative to the original spine chapter, including inside
    // imported CSS. Percent-encode each path segment for exactly one ZIP decode.
    const relative = path.posix.relative(path.posix.dirname(context.chapterPath), target).split('/').map(encodeURIComponent).join('/')
    return `/api/v1/books/${encodeURIComponent(String(context.bookId))}/epub/asset?chapter=${encodeURIComponent(context.chapterHref)}&src=${encodeURIComponent(relative)}`
  } catch { return undefined }
}

// Editorial allowlist: family, relative size, weight/style/small caps, alignment,
// indentation, bounded paragraph spacing, wrapping, hyphenation, list markers,
// pagination hints and local background illustrations. Colors, line-height,
// absolute font sizes, positioning, display,
// dimensions, columns, generated content, variables, animations and !important
// cannot override the reader's theme, scale, measure or layout. Only simple
// selectors are supported; no attribute selectors, escapes or functional pseudos.
const editorialValues: Record<string, RegExp> = {
  'font-style': /^(normal|italic|oblique)$/i,
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/i,
  'font-variant': /^(normal|small-caps)$/i,
  'text-align': /^(start|end|left|right|center|justify)$/i,
  'text-decoration': /^(none|underline|overline|line-through)$/i,
  'text-transform': /^(none|capitalize|uppercase|lowercase)$/i,
  'white-space': /^(normal|pre-wrap|pre-line)$/i,
  'hyphens': /^(none|manual|auto)$/i,
  'list-style-type': /^(none|disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)$/i,
  'list-style-position': /^(inside|outside)$/i,
  'break-before': /^(auto|avoid|column|page)$/i,
  'break-after': /^(auto|avoid|column|page)$/i,
  'break-inside': /^(auto|avoid|avoid-page|avoid-column)$/i,
  'page-break-before': /^(auto|always|avoid)$/i,
  'page-break-after': /^(auto|always|avoid)$/i,
  'page-break-inside': /^(auto|avoid)$/i,
  'orphans': /^[1-9]$/,
  'widows': /^[1-9]$/,
}

function boundedLength(value: string, maximum: number, negative = false): boolean {
  if (value === '0') return true
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(em|px|pt|%)$/i.exec(value)
  if (!match) return false
  const number = Number(match[1])
  const unit = match[2]!.toLowerCase()
  const em = number / (unit === 'px' ? 18 : unit === 'pt' ? 13.5 : unit === '%' ? 100 : 1)
  return em >= (negative ? -maximum : 0) && em <= maximum
}

// PostCSS parses structure; these are deliberately closed value grammars, not
// substitutions over arbitrary CSS. No CSS escapes or unknown functions survive.
function cssUrl(value: string): { source: string; format?: string } | undefined {
  const match = /^url\(\s*(?:"([^"\\<>\r\n]*)"|'([^'\\<>\r\n]*)'|([^\s"'()\\<>]+))\s*\)(?:\s+format\(["'](woff2?|truetype|opentype)["']\))?$/i.exec(value)
  return match ? { source: match[1] ?? match[2] ?? match[3]!, format: match[4] } : undefined
}

function safeDeclaration(node: Declaration, context: CssContext, fontFace = false): string | undefined {
  const prop = node.prop.toLowerCase()
  const value = node.value.trim()
  if (/[\\<>]/.test(value) || hasControlCharacters(value) || node.important) return undefined
  if (fontFace && !['font-family', 'font-style', 'font-weight', 'src'].includes(prop)) return undefined
  if (prop === 'src' && fontFace) {
    const sources = postcss.list.comma(value).flatMap((part) => {
      const parsed = cssUrl(part)
      const url = parsed && assetUrl(context, parsed.source, 'font')
      return url ? [`url("${url}")${parsed?.format ? ` format("${parsed.format.toLowerCase()}")` : ''}`] : []
    })
    return sources.length ? `${prop}:${sources.join(',')}` : undefined
  }
  if (prop === 'background-image') {
    const parsed = cssUrl(value)
    const url = parsed && !parsed.format && assetUrl(context, parsed.source, 'image')
    return url ? `${prop}:url("${url}")` : undefined
  }
  if (prop === 'font-family') {
    if (!postcss.list.comma(value).every((part) => /^(?:[\w -]+|"[\p{L}\p{N} _-]+"|'[\p{L}\p{N} _-]+')$/u.test(part))) return undefined
  } else if (prop === 'font-size') {
    if (!/^(small|medium|large|smaller|larger)$/i.test(value) && !(/^(?:\d+(?:\.\d+)?|\.\d+)(em|%)$/i.test(value) && boundedLength(value, 3) && !boundedLength(value, .49))) return undefined
  } else if (/^(margin|padding)(-(top|right|bottom|left))?$/.test(prop)) {
    const values = postcss.list.space(value)
    if (!values.length || values.length > (prop === 'margin' || prop === 'padding' ? 4 : 1) || !values.every((part) => boundedLength(part, 4))) return undefined
  } else if (prop === 'text-indent') {
    if (!boundedLength(value, 8, true)) return undefined
  } else if (!editorialValues[prop]?.test(value)) return undefined
  return `${prop}:${value}`
}

function cssDeclarations(nodes: ChildNode[], context: CssContext, fontFace = false): string {
  return nodes.flatMap((node) => node.type === 'decl' ? safeDeclaration(node, context, fontFace) ?? [] : []).join(';')
}

function sanitizeEpubCss(css: string, context: CssContext, inline = false): string {
  if (css.length > 1024 * 1024) return ''
  try {
    const root = postcss.parse(inline ? `epub-inline{${css}}` : css)
    if (inline) {
      if (root.nodes.length !== 1 || root.first?.type !== 'rule' || root.first.selector !== 'epub-inline') return ''
      return cssDeclarations(root.first.nodes, context)
    }
    return root.nodes.flatMap((node) => {
      if (node.type === 'atrule') {
        if (node.name.toLowerCase() === 'font-face' && !node.params && node.nodes) {
          const declarations = cssDeclarations(node.nodes, context, true)
          return /(^|;)src:/.test(declarations) && /(^|;)font-family:/.test(declarations) ? `@font-face{${declarations};font-display:swap}` : []
        }
        // Local imports only, without media/supports qualifiers. All other
        // at-rules (including media, supports, namespace and nesting) are dropped.
        if (node.name.toLowerCase() === 'import' && !node.nodes) {
          const parsed = cssUrl(node.params)
          const quoted = /^(?:"([^"\\<>]+)"|'([^'\\<>]+)')$/.exec(node.params)
          const source = parsed && !parsed.format ? parsed.source : quoted?.[1] ?? quoted?.[2]
          const url = source && assetUrl(context, source, 'css')
          return url ? `@import url("${url}");` : []
        }
        return []
      }
      if (node.type !== 'rule') return []
      const selectors = postcss.list.comma(node.selector)
      // A flat lexical allowlist avoids ambiguous nested repetition on hostile
      // long selectors. Invalid combinations are harmless and ignored by CSS.
      if (!selectors.every((selector) => /^[\w.*#\s>+~-]+$/.test(selector.replace(/::?(?:first-letter|first-line|first-child|last-child|only-child)(?![\w-])/gi, '')))) return []
      const scoped = selectors.map((selector) => `.epub-content ${selector.replace(/(^|[\s>+~])(html|body)(?=[.#:\s>+~]|$)/gi, '$1.epub-$2')}`).join(',')
      const declarations = cssDeclarations(node.nodes, context)
      return declarations ? `${scoped}{${declarations}}` : []
    }).join('\n')
  } catch { return '' }
}

/** Returns sanitized chapter HTML, never the raw EPUB. With bookId, all retained
 * image/stylesheet/font URLs use the authorized asset API. Callers must not
 * rewrite them again. The surrounding reader owns CSP, theme and page layout. */
export async function readEpubChapter(filePath: string, href: string, bookId?: string | number): Promise<string> {
  const info = await extractEpub(filePath)
  if (!info.chapters.some((chapter) => chapter.href === href)) throw new Error('Chapter is not in the EPUB spine')
  const zip = await openZip(filePath)
  try {
    const entryPath = resourcePath(info.opfDirectory, href)
    const html = (await readEntry(zip, entryPath, 5 * 1024 * 1024)).toString('utf8')
    const context: CssContext = { chapterHref: href, chapterPath: entryPath, basePath: entryPath, bookId }
    const styles: string[] = []
    // Collect complete raw-text style nodes with the HTML parser, not regex.
    // This pass is discarded; only our freshly serialized CSS is ever emitted.
    sanitizeHtml(html, {
      allowedTags: ['style', 'link'], allowVulnerableTags: true,
      allowedAttributes: { link: ['href', 'rel', 'media'], style: ['media', 'type'] },
      exclusiveFilter: (frame) => {
        if (frame.tag === 'style' && (!frame.attribs.media || frame.attribs.media === 'all') && (!frame.attribs.type || frame.attribs.type === 'text/css')) {
          const css = sanitizeEpubCss(frame.text, context)
          if (css) styles.push(`<style>${css}</style>`)
        } else if (frame.tag === 'link' && frame.attribs.rel?.toLowerCase() === 'stylesheet' && (!frame.attribs.media || frame.attribs.media === 'all')) {
          const url = assetUrl(context, frame.attribs.href ?? '', 'css')
          if (url) styles.push(`<link rel="stylesheet" href="${url.replaceAll('&', '&amp;')}">`)
        }
        return true
      },
    })
    const content = sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['section', 'article', 'figure', 'figcaption', 'img', 'svg', 'path']),
      allowedAttributes: { '*': ['id', 'class', 'title', 'lang', 'dir', 'style'], a: ['href', 'target', 'rel', 'data-epub-href'], img: ['src', 'alt', 'width', 'height'], svg: ['viewBox'], path: ['d'] },
      parseStyleAttributes: false,
      allowedSchemes: ['http', 'https'],
      allowProtocolRelative: false,
      transformTags: {
        '*': (tagName, attrs) => {
          if (attrs.style) attrs.style = sanitizeEpubCss(attrs.style, context, true)
          if (tagName === 'html' || tagName === 'body') return { tagName: 'div', attribs: { ...attrs, class: `epub-${tagName} ${attrs.class ?? ''}`.trim() } }
          if (tagName === 'img') {
            const source = attrs.src ?? ''
            if (bookId !== undefined) {
              const url = assetUrl(context, source, 'image')
              if (url) attrs.src = url
              else delete attrs.src
            } else {
              try {
                const target = resourcePath(path.posix.dirname(entryPath), source)
                if (!assetTypes[path.posix.extname(target).toLowerCase()]?.startsWith('image/')) delete attrs.src
              } catch { delete attrs.src }
            }
          }
          return { tagName, attribs: attrs }
        },
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
    return `<div class="epub-content">${styles.join('')}${content}</div>`
  } finally { zip.close() }
}

// Rasterization is a second boundary, not a substitute for sanitization. The
// renderer only receives SVG geometry/text, local fragments, embedded raster
// bytes and closed presentation values. No DTD, script, foreignObject, CSS sheet,
// external image, font, or stylesheet reaches librsvg. Bound input and processing.
async function rasterizeEpubSvg(filePath: string, entryPath: string, data: Buffer): Promise<Buffer> {
  const xml = data.toString('utf8')
  const parserOptions = { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false }
  const images = new Map<string, string>()
  sanitizeHtml(xml, { parser: parserOptions, onOpenTag: (tag, attrs) => {
    const source = attrs.href ?? attrs['xlink:href']
    if (tag === 'image' && source && images.size < 16) images.set(source, '')
  } })
  let remainingBytes = 20 * 1024 * 1024
  for (const source of images.keys()) {
    try {
      const embedded = /^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(source)
      const target = embedded ? '' : resourcePath(path.posix.dirname(entryPath), source)
      if (!embedded && !/^\.(png|jpe?g|gif|webp)$/i.test(path.posix.extname(target))) continue
      const bytes = embedded ? Buffer.from(embedded[2]!, 'base64') : await readArchiveEntry(filePath, target, remainingBytes)
      if (bytes.length > remainingBytes) continue
      remainingBytes -= bytes.length
      // Do not let SVG/HTML disguised with a raster filename reach librsvg.
      const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
        : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpeg'
          : /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()) ? 'gif'
            : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : undefined
      if (!type) continue
      const raster = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, pages: 1 })
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).timeout({ seconds: 5 }).png().toBuffer()
      images.set(source, `data:image/png;base64,${raster.toString('base64')}`)
    } catch { /* A missing/unsafe illustration must not expose a raw URL. */ }
  }
  const presentation = ['fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'clip-path', 'clip-rule']
  const safeValue = (value: string) => /^[\w\s.,%#()+-]+$/.test(value) && !hasControlCharacters(value) && (!/url/i.test(value) || /^url\(#[\w.-]+\)$/.test(value))
  const svg = sanitizeHtml(xml, {
    parser: parserOptions,
    allowedTags: ['svg', 'g', 'defs', 'symbol', 'use', 'image', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath'],
    allowedAttributes: { '*': ['id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'd', 'points', 'transform', 'gradientTransform', 'gradientUnits', 'offset', ...presentation], svg: ['xmlns'], use: ['href'], image: ['href'] },
    allowedSchemesByTag: { image: ['data'] },
    disallowedTagsMode: 'completelyDiscard',
    nonTextTags: ['script', 'style', 'foreignObject', 'iframe', 'object'],
    transformTags: { '*': (tagName, attrs) => {
      const image = tagName === 'image' ? images.get(attrs.href ?? attrs['xlink:href'] ?? '') : undefined
      // Preserve simple inline SVG paint styles as presentation attributes. Class
      // stylesheets and URL-bearing properties outside local paint are omitted.
      if (attrs.style) {
        try {
          const root = postcss.parse(`svg-paint{${attrs.style}}`)
          if (root.nodes.length === 1 && root.first?.type === 'rule') {
            for (const node of root.first.nodes) {
              if (node.type === 'decl' && presentation.includes(node.prop) && safeValue(node.value)) attrs[node.prop] = node.value
            }
          }
        } catch { /* malformed paint styles are ignored */ }
      }
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'href' || name === 'xlink:href') {
          if (!/^#[\w.-]+$/.test(value)) delete attrs[name]
          else { attrs.href = value; delete attrs['xlink:href'] }
        } else if (!safeValue(value)) delete attrs[name]
      }
      if (tagName === 'svg') attrs.xmlns = 'http://www.w3.org/2000/svg'
      if (image) attrs.href = image
      return { tagName, attribs: attrs }
    } },
  })
  return sharp(Buffer.from(svg), { failOn: 'error', limitInputPixels: 40_000_000, pages: 1 })
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .timeout({ seconds: 5 }).png().toBuffer()
}

/** CSS resolves its dependencies relative to its own ZIP entry, but emits src
 * relative to chapterHref. Pass the same bookId as readEpubChapter. Without an
 * ID, CSS is still sanitized, but resource-bearing declarations are omitted.
 * SVG assets are sanitized then rasterized to PNG, never served as XML/HTML. */
export async function readEpubAsset(filePath: string, chapterHref: string, source: string, bookId?: string | number): Promise<{ data: Buffer; contentType: string }> {
  const info = await extractEpub(filePath)
  if (!info.chapters.some((chapter) => chapter.href === chapterHref)) throw new Error('Chapter is not in the EPUB spine')
  const chapterPath = resourcePath(info.opfDirectory, chapterHref)
  const entryPath = resourcePath(path.posix.dirname(chapterPath), source)
  const extension = path.posix.extname(entryPath).toLowerCase()
  const contentType = assetTypes[extension]
  if (!contentType) throw new Error('Unsupported EPUB resource type')
  const data = await readArchiveEntry(filePath, entryPath, extension === '.css' || extension === '.svg' ? 1024 * 1024 : 20 * 1024 * 1024)
  if (extension === '.svg') return { data: await rasterizeEpubSvg(filePath, entryPath, data), contentType }
  return { data: extension === '.css' ? Buffer.from(sanitizeEpubCss(data.toString('utf8'), { chapterHref, chapterPath, basePath: entryPath, bookId })) : data, contentType }
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

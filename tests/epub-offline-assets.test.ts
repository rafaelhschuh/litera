import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import postcss from 'postcss'
import sanitizeHtml from 'sanitize-html'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readEpubAsset, readEpubChapter, searchEpub } from '../src/server/epub.js'

const chapters = ['Text/one.xhtml', 'Text/Part Two/two.xhtml']
const bookId = 42
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAIAAABrW6giAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR4nGMosfSGIwZKOQCPExdB3MAPCgAAAABJRU5ErkJggg==', 'base64')
const fonts: Record<string, Buffer> = {
  woff: Buffer.from('wOFF font fixture'), woff2: Buffer.from('wOF2 font fixture'),
  ttf: Buffer.from([0, 1, 0, 0, 0, 0, 0, 0]), otf: Buffer.from('OTTO font fixture'),
}

function htmlReferences(html: string): string[] {
  const references: string[] = []
  sanitizeHtml(html, { onOpenTag: (tag, attrs) => {
    if (tag === 'link' && attrs.href) references.push(attrs.href)
    if (tag === 'img' && attrs.src) references.push(attrs.src)
  } })
  return references
}

function cssReferences(css: string): string[] {
  return [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]!)
}

describe('sanitized EPUB assets for online and offline reading', () => {
  let directory: string
  let file: string
  let zip: JSZip
  const save = async () => fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  const assetFromUrl = async (reference: string) => {
    const url = new URL(reference, 'https://litera.invalid')
    expect(url.origin).toBe('https://litera.invalid')
    expect(url.pathname).toBe(`/api/v1/books/${bookId}/epub/asset`)
    return readEpubAsset(file, url.searchParams.get('chapter')!, url.searchParams.get('src')!, bookId)
  }

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-epub-assets-'))
    file = path.join(directory, 'book.epub')
    zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>')
    zip.file('OPS/content.opf', `<package><metadata><title>Offline test</title></metadata><manifest>${chapters.map((href, index) => `<item id="c${index}" href="${href}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine><itemref idref="c0"/><itemref idref="c1"/></spine></package>`)
    chapters.forEach((href, index) => {
      const prefix = index ? '../..' : '..'
      zip.file(`OPS/${href}`, `<html><head><title>Chapter ${index}</title>
        <link rel="stylesheet" href="${prefix}/Styles/book.css"/>
        <style>p.emphasis { font-style: italic; text-indent: 1.5em } body {font-family: 'Book Face', serif}</style>
        </head><body class="chapter"><h1>Chapter ${index}</h1>
        <p id="paragraph-${index}" class="emphasis" style="text-align: justify; margin-bottom: 1em; position: fixed; color: red; font-size: 200px; line-height: 0">Readable chapter ${index}</p>
        <img src="${prefix}/Images/plate%20one.png" alt="Illustration" onerror="alert(1)"/>
        <a href="#paragraph-${index}">Note</a><a href="${index ? '../one.xhtml' : 'Part Two/two.xhtml'}">Next chapter</a>
        <script>alert('unsafe')</script></body></html>`)
    })
    zip.file('OPS/Styles/book.css', `@import "nested/notes.css";
      @font-face {font-family: 'Book Face'; src: url('../Fonts/book.woff2') format('woff2'), url('../Fonts/book.ttf') format('truetype'); font-weight: normal}
      body.chapter p, h1 {font-family: 'Book Face', serif; font-size: 1.2em; text-align: justify; margin: 1em 0; color: red; column-count: 9; position: fixed}
      .illustration {background-image: url('../Images/plate%20one.png')}
      /* no source comments, including sourceMappingURL, may survive */`)
    zip.file('OPS/Styles/nested/notes.css', '@font-face {font-family: Notes; src: url("../../Fonts/book.otf") format("opentype")} blockquote {font-style: italic; padding-left: 1em}')
    zip.file('OPS/Images/plate one.png', png)
    Object.entries(fonts).forEach(([extension, data]) => zip.file(`OPS/Fonts/book.${extension}`, data))
    zip.file('OPS/Images/evil.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>')
    zip.file('OPS/evil.html', '<script>alert(1)</script>')
    await save()
  })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

  it('preserves editorial CSS, fonts and images through a fully local dependency graph for every chapter', async () => {
    const original = await fs.readFile(file)
    const before = await fs.stat(file)
    for (const chapter of chapters) {
      const html = await readEpubChapter(file, chapter, bookId)
      expect(html).toContain('class="epub-content"')
      expect(html).toContain('class="epub-body chapter"')
      expect(html).toContain('.epub-content p.emphasis{font-style:italic;text-indent:1.5em}')
      expect(html).toContain('style="text-align:justify;margin-bottom:1em"')
      expect(html).not.toMatch(/<script|onerror|position:|color:|line-height:|200px/)
      expect(html).toContain('data-epub-href=')
      const references = htmlReferences(html)
      expect(references).toHaveLength(2)
      const seen = new Set<string>()
      const types = new Set<string>()
      while (references.length) {
        const reference = references.shift()!
        if (seen.has(reference)) continue
        seen.add(reference)
        expect(new URL(reference, 'https://litera.invalid').searchParams.get('chapter')).toBe(chapter)
        const asset = await assetFromUrl(reference)
        types.add(asset.contentType)
        if (asset.contentType.startsWith('text/css')) {
          const css = asset.data.toString()
          expect(css).not.toMatch(/color:|column-count|position:|sourceMappingURL/)
          expect(() => postcss.parse(css)).not.toThrow()
          references.push(...cssReferences(css))
          if (css.includes('Book Face')) {
            expect(css).toContain('.epub-content .epub-body.chapter p,.epub-content h1')
            expect(css).toContain('font-display:swap')
          }
        } else if (asset.contentType === 'image/png') expect(asset.data).toEqual(png)
      }
      expect(types).toEqual(new Set(['text/css; charset=utf-8', 'image/png', 'font/woff2', 'font/ttf', 'font/otf']))
      expect(seen.size).toBe(6)
    }
    expect(await fs.readFile(file)).toEqual(original)
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs)
  })

  it.each(Object.keys(fonts))('serves %s fonts with explicit non-document MIME types', async (extension) => {
    const asset = await readEpubAsset(file, chapters[0]!, `../Fonts/book.${extension}`, bookId)
    expect(asset.contentType).toBe(`font/${extension}`)
    expect(asset.data).toEqual(fonts[extension])
  })

  it.each([
    '../../../outside.png', '../../../../OPS/Images/plate%20one.png', '%2e%2e/%2e%2e/%2e%2e/secret.png',
    '%252e%252e%252fsecret.png', '/OPS/Images/plate%20one.png', '%2fOPS/Images/plate%20one.png',
    '//evil.invalid/x.png', 'https://evil.invalid/x.png', 'data:image/png;base64,a', 'javascript:alert(1)',
    '..\\Images\\plate.png', '..%5cImages%5cplate.png', '../Images/a%00.png', '../Images/a%0a.png',
    ' ../Images/plate%20one.png', '../Images/plate%20one.png?tracking=1', '%zz.png',
    '../evil.html', 'one.xhtml', '../content.opf',
  ])('rejects unsafe or executable asset reference %s', async (source) => {
    await expect(readEpubAsset(file, chapters[0]!, source, bookId)).rejects.toThrow()
  })

  it('validates spine membership for both HTML and assets', async () => {
    await expect(readEpubChapter(file, '../evil.html', bookId)).rejects.toThrow('spine')
    await expect(readEpubAsset(file, '../evil.html', '../Fonts/book.woff', bookId)).rejects.toThrow('spine')
  })

  it('strips malicious CSS, external fetches and reader-layout overrides, including obfuscation', async () => {
    zip.file('OPS/Styles/book.css', String.raw`
      @import 'https://evil.invalid/style.css';
      @import url('//evil.invalid/style.css');
      @import url('../../../outside.css');
      @import url('../evil.html');
      @import '\68 ttps://evil.invalid/escaped.css';
      @namespace x url('https://evil.invalid/ns');
      @media screen {p{position:fixed;background-image:url('https://evil.invalid/media.png')}}
      @supports (display:grid) {p {color:red}}
      @font-face {font-family: Evil; src: local('InstalledFont'), url('https://evil.invalid/font.woff2'), url('../Images/evil.svg')}
      @font-face {font-family: Good; src: url('../Fonts/book.woff'), url('https://evil.invalid/font.woff')}
      p {font-style:italic; position:fixed; z-index:9999; display:none; opacity:0; width:999vw; height:0; overflow:hidden;
         font-size:0; margin:-100em; padding:900px; line-height:0; column-count:8; color:transparent;
         behavior:url('x.htc'); -moz-binding:url('x.xml'); background-image:url('https://evil.invalid/pixel.png');
         background:image-set(url('https://evil.invalid/pixel.png') 1x); cursor:url('https://evil.invalid/cursor.png'),auto;
         content:attr(title); font-family:var(--secret); --secret:url('https://evil.invalid/var.png');
         text-indent:expression(alert(1)); font-weight:bold!important; font-\73tyle:oblique;
         text-align: center; nested {font-style:oblique} }
      p[data-secret] {background-image:url('../Images/plate%20one.png')}
      p:has(a), :root {font-style:oblique}
      p {background-image:u\72l('https://evil.invalid/escaped.png')}
      p {background-image:url('data:image/png;base64,evil')}
      p {background-image:url('%252e%252e/evil.png')}
      p {font-family:'</style><script>alert(1)</script>'}
    `)
    await save()
    const css = (await readEpubAsset(file, chapters[0]!, '../Styles/book.css', bookId)).data.toString()
    expect(css).toContain('.epub-content p{font-style:italic;text-align:center}')
    expect(css).toContain('font-family:Good')
    expect(css).not.toMatch(/evil|Evil|InstalledFont|https:|data:|javascript:|expression|!important|\\|<|>|@import|@media|@supports|@namespace|position|column|opacity|oblique|nested/)
    const refs = cssReferences(css)
    expect(refs).toHaveLength(1)
    expect((await assetFromUrl(refs[0]!)).data).toEqual(fonts.woff)
  })

  it('handles inline styles and HTML style-breakout attempts without emitting executable markup', async () => {
    zip.file('OPS/Text/one.xhtml', `<html><head><base href="https://evil.invalid/"/>
      <link rel="stylesheet" href="https://evil.invalid/style.css"/>
      <link rel="preload" as="script" href="../evil.html"/>
      <style>p{font-family:"</style><script>alert(1)</script><style>p{font-style:italic}</style>
      <style>p { background-image: url(https://evil.invalid/pixel.png); text-align: center }</style>
      </head><body onload="alert(1)"><p style="font-style:italic; background-image:url('https://evil.invalid/i.png'); behavior:url(x)">Safe text</p>
      <p style="font-weight:bold;} evil{font-style:italic">Untrusted inline</p>
      <iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe><object data="../evil.html"></object>
      <img src="https://evil.invalid/pixel.png"/><img src="../../../outside.png"/>
      <svg onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://evil.invalid/"></iframe></foreignObject><path d="M0 0"/></svg>
      </body></html>`)
    await save()
    const html = await readEpubChapter(file, chapters[0]!, bookId)
    expect(html).toContain('Safe text')
    expect(html).toContain('style="font-style:italic"')
    expect(html).toContain('.epub-content p{font-style:italic}')
    expect(html).not.toMatch(/<script|<iframe|<object|<base|onload|foreignobject|https:|evil\{|background-image|behavior/)
    expect(htmlReferences(html)).toEqual([])
  })

  it('fails closed on malformed or oversized CSS while retaining readable chapter text', async () => {
    zip.file('OPS/Styles/book.css', 'p { font-style: italic; /* unterminated')
    zip.file('OPS/Text/one.xhtml', '<style>p { font-style:italic; /* unterminated</style><p>Still readable</p>')
    await save()
    expect((await readEpubAsset(file, chapters[0]!, '../Styles/book.css', bookId)).data.toString()).toBe('')
    expect(await readEpubChapter(file, chapters[0]!, bookId)).toContain('<p>Still readable</p>')
    zip.file('OPS/Styles/book.css', ' '.repeat(1024 * 1024 + 1))
    await save()
    await expect(readEpubAsset(file, chapters[0]!, '../Styles/book.css', bookId)).rejects.toThrow('exceeds')
  })

  it('rejects long invalid selectors and numeric values without ambiguous regex backtracking', async () => {
    zip.file('OPS/Styles/book.css', `${'a'.repeat(100_000)}? {font-style:italic} p {font-size:${'1'.repeat(100_000)}oops; margin:${'1'.repeat(100_000)}oops; font-style:italic}`)
    await save()
    const css = (await readEpubAsset(file, chapters[0]!, '../Styles/book.css', bookId)).data.toString()
    expect(css).toBe('.epub-content p{font-style:italic}')
  })

  it('supports callers without bookId safely and keeps CSS out of chapter search', async () => {
    const html = await readEpubChapter(file, chapters[0]!)
    expect(html).toContain('src="../Images/plate%20one.png"')
    expect(html).not.toContain('/api/v1/')
    expect(html).not.toContain('<link')
    const css = (await readEpubAsset(file, chapters[0]!, '../Styles/book.css')).data.toString()
    expect(css).toContain('font-family:')
    expect(css).not.toContain('url(')
    expect(css).not.toContain('@font-face')
    expect(await searchEpub(file, 'Readable chapter')).toHaveLength(2)
    expect(await searchEpub(file, 'font-style')).toEqual([])
  })

  it('uses stable chapter-specific URLs and resolves percent-encoded spaces only once', async () => {
    const first = htmlReferences(await readEpubChapter(file, chapters[0]!, bookId))[0]!
    expect(first).toBe(htmlReferences(await readEpubChapter(file, chapters[0]!, bookId))[0])
    expect(first).not.toBe(htmlReferences(await readEpubChapter(file, chapters[1]!, bookId))[0])
    const image = await readEpubAsset(file, chapters[1]!, '../../Images/plate%20one.png#figure', bookId)
    expect(image.data).toEqual(png)
  })

  it('preserves SVG illustrations as bounded PNGs and blocks scripts, external resources and XML entities', async () => {
    const safe = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="60" height="40" style="fill:url(#paint)"/></svg>'
    zip.file('OPS/Images/illustration.svg', safe)
    zip.file('OPS/Images/evil.svg', `<?xml version="1.0"?><?xml-stylesheet href="https://evil.invalid/style.css"?>
      <!DOCTYPE svg [<!ENTITY secret SYSTEM "file:///etc/passwd">]>
      ${safe.replace('<defs>', `<script>alert(1)</script><foreignObject><p>&secret;</p></foreignObject>
        <style>@import 'https://evil.invalid/style.css'; rect {fill: url('file:///etc/passwd')}</style>
        <image href="https://evil.invalid/pixel.png"/>
        <use href="https://evil.invalid/other.svg#shape"/>
        <defs>`).replace('viewBox=', 'onload="alert(1)" viewBox=')}`)
    zip.file('OPS/Text/one.xhtml', '<p>SVG illustration</p><img src="../Images/evil.svg" alt="Diagram"/>')
    await save()
    const safeImage = await readEpubAsset(file, chapters[0]!, '../Images/illustration.svg', bookId)
    const html = await readEpubChapter(file, chapters[0]!, bookId)
    const refs = htmlReferences(html)
    expect(refs).toHaveLength(1)
    const image = await assetFromUrl(refs[0]!)
    expect(image.contentType).toBe('image/png')
    expect(image.data).toEqual(safeImage.data)
    expect(await sharp(image.data).metadata()).toMatchObject({ format: 'png', width: 60, height: 40 })
    const pixels = await sharp(image.data).raw().toBuffer()
    expect(pixels[0]).toBeGreaterThan(200)
    expect(pixels[3]).toBe(255)
  })

  it('rejects SVG pixel bombs and non-SVG documents without ever returning the raw source', async () => {
    zip.file('OPS/Images/huge.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="100000" height="100000"/></svg>')
    zip.file('OPS/Images/html.svg', '<html><script>alert(1)</script></html>')
    await save()
    await expect(readEpubAsset(file, chapters[0]!, '../Images/huge.svg', bookId)).rejects.toThrow()
    await expect(readEpubAsset(file, chapters[0]!, '../Images/html.svg', bookId)).rejects.toThrow()
  })

  it('preserves local and embedded raster illustrations in SVG wrappers without permitting file/network references', async () => {
    const svg = (href: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="4" height="6"><image xlink:href="${href}" width="4" height="6"/></svg>`
    zip.file('OPS/Images/local.svg', svg('plate%20one.png'))
    zip.file('OPS/Images/embedded.svg', svg(`data:image/png;base64,${png.toString('base64')}`))
    zip.file('OPS/Images/fake.png', '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>')
    zip.file('OPS/Images/forged.svg', svg('fake.png'))
    zip.file('OPS/Images/empty.svg', svg('https://evil.invalid/pixel.png'))
    await save()
    const local = await readEpubAsset(file, chapters[0]!, '../Images/local.svg', bookId)
    const embedded = await readEpubAsset(file, chapters[0]!, '../Images/embedded.svg', bookId)
    expect(local.data).toEqual(embedded.data)
    expect(await sharp(local.data).ensureAlpha().raw().toBuffer()).toEqual(await sharp(png).ensureAlpha().raw().toBuffer())
    const forged = await readEpubAsset(file, chapters[0]!, '../Images/forged.svg', bookId)
    const empty = await readEpubAsset(file, chapters[0]!, '../Images/empty.svg', bookId)
    expect(forged.data).toEqual(empty.data)
  })
})

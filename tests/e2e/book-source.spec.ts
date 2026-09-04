import { test as base, expect } from '@playwright/test'
import fs from 'node:fs'
import ts from 'typescript'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const test = base.extend({
  context: async ({ browser, browserName, playwright, launchOptions, contextOptions, baseURL, viewport, hasTouch, isMobile }, use) => {
    const options = { ...contextOptions, baseURL, viewport, hasTouch, isMobile, serviceWorkers: 'allow' as const }
    // This Linux WebKit runtime cannot read even a plain Blob URL in ephemeral
    // offline contexts. A fresh persistent profile exercises the PWA storage
    // model without changing offline mode, CSP or resource assertions.
    const profile = browserName === 'webkit' ? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'litera-source-webkit-')) : undefined
    const context = profile ? await playwright.webkit.launchPersistentContext(profile, { ...launchOptions, ...options, headless: true }) : await browser.newContext(options)
    try { await use(context) }
    finally { await context.close(); if (profile) await fs.promises.rm(profile, { recursive: true, force: true }) }
  },
})

// Exercise the actual source transformation in both browser engines without
// depending on a rebuilt application bundle or a second test server.
const documentModule = ts.transpileModule(fs.readFileSync(new URL('../../src/shared/epub-document.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

test.beforeEach(async ({ page }) => {
  await page.addScriptTag({ content: `{const exports={};${documentModule};window.epubDocument=exports;}` })
})

test('local EPUB document keeps semantic nodes and applies appearance offline', async ({ page, context }) => {
  await context.setOffline(true)
  const result = await page.evaluate(async () => {
    const transform = (window as any).epubDocument.prepareEpubDocument
    const html = await transform('<html><head><style>.reader-document{font-size:18px;line-height:1.65;width:56rem}body{background:white}</style></head><body><main class="reader-document"><h1 id="chapter">Chapter</h1><p id="position">Saved position <em>retained</em>.</p><a href="#position">Note</a></main></body></html>', { fontScale: 110, theme: 'sepia', lineHeight: 'relaxed', margins: 'wide' })
    const frame = document.createElement('iframe'); frame.sandbox.add('allow-same-origin', 'allow-scripts')
    const loaded = new Promise<void>(resolve => { frame.onload = () => resolve() })
    frame.srcdoc = html; document.body.append(frame); await loaded
    const doc = frame.contentDocument!, style = frame.contentWindow!.getComputedStyle(doc.querySelector('.reader-document')!)
    return { fontSize: style.fontSize, lineHeight: style.lineHeight, background: frame.contentWindow!.getComputedStyle(doc.body).backgroundColor, paragraph: doc.querySelector('#position')?.textContent, href: doc.querySelector('a')?.getAttribute('href') }
  })
  expect(result).toMatchObject({ background: 'rgb(244, 234, 214)', paragraph: 'Saved position retained.', href: '#position' })
  expect(parseFloat(result.fontSize)).toBeCloseTo(19.8, 3)
  expect(parseFloat(result.lineHeight)).toBeCloseTo(19.8 * 1.85, 2)
})

test('local EPUB rewrites images, styles and font references without network', async ({ page, context }) => {
  await context.setOffline(true)
  const result = await page.evaluate(async () => {
    const module = (window as any).epubDocument, seen: string[] = [], objectUrls: string[] = []
    const resolve = async (url: string) => {
      seen.push(url)
      const value = URL.createObjectURL(new Blob(['resource'], { type: url.endsWith('.woff') ? 'font/woff' : 'image/png' })); objectUrls.push(value); return value
    }
    const html = await module.prepareEpubDocument('<main class="reader-document"><style>@font-face{font-family:Book;src:url("/font.woff")}</style><link rel="stylesheet" href="/book.css"><p style="background-image:url(/background.png)">Text</p><img src="/image.png"></main>', { fontScale: 100, theme: 'light', lineHeight: 'normal', margins: 'normal' }, resolve, async (url: string) => { seen.push(url); return module.rewriteCssResources('p{font-style:italic;background:url(/linked.png)}', resolve) })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const result = { seen, img: doc.querySelector('img')?.getAttribute('src'), style: doc.querySelector('p')?.getAttribute('style'), links: doc.querySelectorAll('link').length, css: [...doc.querySelectorAll('style')].map(style => style.textContent).join('') }
    objectUrls.forEach(url => URL.revokeObjectURL(url))
    return result
  })
  expect(result.seen.sort()).toEqual(['/background.png', '/book.css', '/font.woff', '/image.png', '/linked.png'])
  expect(result.img).toMatch(/^blob:/); expect(result.style).toContain('blob:'); expect(result.links).toBe(0)
  expect(result.css).toContain('font-style:italic'); expect(result.css).toContain('src:url("blob:')
})

test('transformed EPUB keeps CSP and rejects executable elements and handlers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const html = await (window as any).epubDocument.prepareEpubDocument('<main class="reader-document"><p onclick="window.unsafe=true">Safe</p><script>window.unsafe=true</script><iframe src="https://example.invalid"></iframe></main>', { fontScale: 100, theme: 'light', lineHeight: 'normal', margins: 'normal' })
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return { policy: doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'), scripts: doc.querySelectorAll('script,iframe').length, handler: doc.querySelector('p')?.getAttribute('onclick'), text: doc.querySelector('.reader-document')?.textContent }
  })
  expect(result).toMatchObject({ scripts: 0, handler: null, text: 'Safe' })
  expect(result.policy).toContain("script-src 'none'")
})

test('server CSP permits nested local EPUB styles without allowing book scripts', async ({ page, context }) => {
  await page.addInitScript({ content: `{const exports={};${documentModule};window.epubDocument=exports;}` })
  const response = await page.goto('/login')
  const policy = response!.headers()['content-security-policy'] ?? ''
  expect(policy.match(/(?:^|;)\s*style-src\s+([^;]+)/)?.[1]).toContain('blob:')
  await context.setOffline(true)
  const result = await page.evaluate(async () => {
    const nested = URL.createObjectURL(new Blob(['.offline-caption{font-weight:700}'], { type: 'text/css' }))
    const imported = URL.createObjectURL(new Blob([`@import url("${nested}");.offline-caption{font-style:italic}`], { type: 'text/css' }))
    try {
      const html = await (window as any).epubDocument.prepareEpubDocument('<main class="reader-document"><style>@import url("/api/v1/books/1/epub/asset?chapter=one.xhtml&src=book.css");</style><p class="offline-caption">Offline caption</p></main>', { fontScale: 100, theme: 'light', lineHeight: 'normal', margins: 'normal' }, async () => imported)
      const frame = document.createElement('iframe'); frame.sandbox.add('allow-same-origin', 'allow-scripts')
      const loaded = new Promise<void>(resolve => { frame.onload = () => resolve() })
      // A malicious script inserted after transformation still cannot execute.
      frame.srcdoc = html.replace('</body>', '<script>document.body.dataset.unsafe="executed"</script></body>')
      document.body.replaceChildren(frame); await loaded
      const documentInFrame = frame.contentDocument!, computed = frame.contentWindow!.getComputedStyle(documentInFrame.querySelector('.offline-caption')!)
      return { weight: computed.fontWeight, style: computed.fontStyle, scriptRan: documentInFrame.body.dataset.unsafe ?? null }
    } finally { URL.revokeObjectURL(imported); URL.revokeObjectURL(nested) }
  })
  expect(result).toEqual({ weight: '700', style: 'italic', scriptRan: null })
})

test('saved PDF uses local binary and prepared assets through original/adapted switches', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const password = 'test-password-strong-123', username = `pdf-source-${randomUUID()}`
  expect((await request.post('/api/v1/auth/login', { data: { username: 'admin', password } })).ok()).toBe(true)
  const libraries = (await (await request.get('/api/v1/admin/libraries')).json()).libraries
  expect((await request.post('/api/v1/admin/users', { data: { username, password, displayName: 'PDF source test', role: 'reader', libraryIds: libraries.map((item: { id: number }) => item.id) } })).status()).toBe(201)
  await page.goto('/login')
  await page.getByLabel('Usuário', { exact: true }).fill(username)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('/')
  const book = (await (await page.request.get('/api/v1/books')).json()).books.find((item: { title: string }) => item.title === 'Fidelidade PDF')
  expect(book).toBeDefined()
  await page.goto(`/books/${book.id}`)
  await page.getByRole('button', { name: 'Salvar para offline', exact: true }).click()
  await expect(page.getByText('Disponível offline.', { exact: true })).toBeVisible({ timeout: 90_000 })
  const contentRequests: string[] = [], errors: string[] = []
  context.on('request', request => { if (new URL(request.url()).pathname.startsWith(`/api/v1/books/${book.id}/`) && /\/(content|pdf\/)/.test(new URL(request.url()).pathname)) contentRequests.push(request.url()) })
  context.on('weberror', error => errors.push(error.error().message))
  await page.goto(`/read/${book.id}?mode=pdf`)
  await expect(page.locator('.pdf-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Avançar na leitura', exact: true }).click()
  await expect(page.locator('.pdf-page')).toHaveAttribute('data-page', '2')
  await context.setOffline(true)
  for (let iteration = 0; iteration < 3; iteration++) {
    await page.getByRole('button', { name: 'Configurações de leitura', exact: true }).click()
    await page.getByRole('button', { name: 'Texto adaptado', exact: true }).click()
    await expect(page.locator('.reader-document')).toContainText('Pagina com imagem preservada')
    await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
    const figure = page.getByAltText('Ilustração da página')
    await expect(figure).toHaveAttribute('src', /^blob:/)
    expect(await figure.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    const nativeFont = page.locator('.reader-document span[style*="litera-pdf-"]').first()
    expect(await nativeFont.evaluate(async element => {
      const loaded = await document.fonts.load(`18px ${getComputedStyle(element).fontFamily}`)
      return loaded.length > 0 && loaded.every(font => font.status === 'loaded')
    })).toBe(true)
    if (iteration === 2) break
    await page.getByRole('button', { name: 'Configurações de leitura', exact: true }).click()
    await page.getByRole('button', { name: 'Documento original', exact: true }).click()
    await expect(page.locator('.pdf-page')).toHaveAttribute('data-page', '2')
  }
  await page.reload()
  await expect(page.locator('.reader-document')).toContainText('Pagina com imagem preservada')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  expect(contentRequests).toEqual([])
  expect(errors).toEqual([])
})

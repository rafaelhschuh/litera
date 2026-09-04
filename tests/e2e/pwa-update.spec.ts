import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { login, testContext } from '../setup'

type SavedPackage = {
  book: { bookId: number; userId: number; generation: string; revision: string; bytes: number }
  resources: Array<{ url: string; bytes: number; sha256: string }>
}

// Inspect real committed IDB records, without creating or repairing any storage.
async function packageSnapshot(page: Page, bookId: number): Promise<SavedPackage> {
  return page.evaluate(async id => {
    type Resource = { bookId: number; generation: string; url: string; blob: Blob | ArrayBuffer }
    const stored = await new Promise<{ books: SavedPackage['book'][]; resources: Resource[] }>((resolve, reject) => {
      const opening = indexedDB.open('litera-offline-books')
      opening.onupgradeneeded = () => opening.transaction!.abort()
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result
        const transaction = db.transaction(['books', 'resources'], 'readonly')
        const books = transaction.objectStore('books').getAll()
        const resources = transaction.objectStore('resources').getAll()
        transaction.oncomplete = () => { db.close(); resolve({ books: books.result, resources: resources.result }) }
        transaction.onabort = () => { db.close(); reject(transaction.error) }
      }
    })
    const book = stored.books.find(item => item.bookId === id)
    if (!book) throw new Error('Committed offline package missing')
    // Hash after the read transaction completes (safe across Safari IDB lifetimes).
    const resources = await Promise.all(stored.resources.filter(item => item.bookId === id && item.generation === book.generation).map(async item => {
      const binary = item.blob instanceof Blob ? await item.blob.arrayBuffer() : item.blob
      return {
        url: item.url,
        bytes: binary.byteLength,
        sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', binary)), byte => byte.toString(16).padStart(2, '0')).join(''),
      }
    }))
    return { book: { bookId: book.bookId, userId: book.userId, generation: book.generation, revision: book.revision, bytes: book.bytes }, resources: resources.sort((a, b) => a.url.localeCompare(b.url)) }
  }, bookId)
}

async function activeBuild(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const worker = navigator.serviceWorker.controller
    if (!worker) { reject(new Error('No controlling service worker')); return }
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Service worker did not answer status')) }, 5_000)
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close()
      if (event.data.type !== 'LITERA_SHELL_STATUS' || event.data.protocol !== 1) reject(new Error('Unexpected shell protocol'))
      else resolve(event.data.build)
    }
    worker.postMessage({ type: 'LITERA_SHELL_STATUS' }, [channel.port2])
  }))
}

async function shellReady(page: Page): Promise<boolean> {
  return page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const worker = navigator.serviceWorker.controller
    if (!worker) { reject(new Error('No controlling service worker')); return }
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Service worker shell readiness timed out')) }, 30_000)
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close()
      if (event.data.type !== 'LITERA_SHELL_READY') reject(new Error('Unexpected shell readiness protocol'))
      else resolve(event.data.ready === true)
    }
    worker.postMessage({ type: 'LITERA_ENSURE_SHELL' }, [channel.port2])
  }))
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
}

test('production SW update waits for consent and preserves EPUB through offline browser restart', async ({ playwright, browserName }, info) => {
  test.setTimeout(180_000)
  test.skip(browserName === 'webkit', 'Playwright WebKit does not implement service-worker update/unregister; WebKit offline flows run in offline.spec.ts')
  const source = await fs.readFile(path.join(process.cwd(), 'dist/web/sw.js'), 'utf8')
  const oldBuild = source.match(/const BUILD = "([a-f0-9]+)"/)?.[1]
  expect(oldBuild, 'Run the production build before the PWA lifecycle gate').toBeTruthy()
  const nextBuild = createHash('sha256').update(source + '\nE2E next release').digest('hex').slice(0, 24)
  let servedWorker = source
  let updateScriptRequests = 0
  const fixture = await testContext()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-pwa-update-'))
  let context: BrowserContext | undefined
  // A real HTTP endpoint, not Playwright routing: browsers fetch SW update scripts
  // outside normal page routing. Each test uses port 0, never the shared 3107.
  const server = createServer((request, response) => {
    if (request.url?.split('?')[0] === '/sw.js') {
      if (servedWorker !== source) updateScriptRequests++
      response.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store', 'service-worker-allowed': '/' })
      response.end(servedWorker)
    } else fixture.app(request, response)
  })
  try {
    await login(fixture.agent)
    const library = await fixture.agent.post('/api/v1/admin/libraries').send({ name: 'PWA lifecycle fixtures', path: fixture.books })
    expect(library.status).toBe(201)
    expect((await fixture.agent.post(`/api/v1/admin/libraries/${library.body.library.id}/scan`)).status).toBe(200)
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address')
    const baseURL = `http://127.0.0.1:${address.port}`
    const use = info.project.use
    const options = { ...use.launchOptions, headless: true, baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, serviceWorkers: 'allow' as const }
    context = await playwright[browserName].launchPersistentContext(profile, options)
    const page = await context.newPage()
    await page.goto('/login')
    await page.getByLabel('Usuário', { exact: true }).fill('admin')
    await page.getByLabel('Senha', { exact: true }).fill('test-password-strong-123')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('/')
    const catalog = await (await page.request.get('/api/v1/books')).json()
    const epub = catalog.books.find((book: { format: string }) => book.format === 'epub') as { id: number; title: string }
    expect(epub).toBeDefined()
    await page.goto(`/books/${epub.id}`)
    // This gate starts with an installed old shell, not a first-install race.
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60_000 }).toBe(true)
    expect(await activeBuild(page)).toBe(oldBuild)
    expect(await shellReady(page)).toBe(true)
    await page.getByRole('button', { name: 'Salvar para offline', exact: true }).click()
    await expect(page.getByText('Disponível offline.', { exact: true })).toBeVisible({ timeout: 90_000 })
    const saved = await packageSnapshot(page, epub.id)
    expect(saved.book.bytes).toBeGreaterThan(0)
    expect(saved.resources.length).toBeGreaterThan(0)
    expect(await activeBuild(page)).toBe(oldBuild)

    await page.goto(`/read/${epub.id}`)
    const document = page.frameLocator('.epub-stage:not(.epub-stage--preparing)').locator('.reader-document')
    await expect(document).toContainText('Conteúdo real do primeiro capítulo.')
    await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
    const documentToken = await page.evaluate(() => {
      const token = crypto.randomUUID()
      ;(window as Window & { pwaUpdateDocumentToken?: string }).pwaUpdateDocumentToken = token
      return token
    })

    // Only the build identity changes. Precache URLs and all production assets
    // remain real and identical, isolating lifecycle from unrelated UI changes.
    servedWorker = source.replace(`const BUILD = "${oldBuild}"`, `const BUILD = "${nextBuild}"`)
    await page.evaluate(() => { void navigator.serviceWorker.getRegistration('/').then(value => value!.update()).catch(() => undefined) })
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting?.state), { timeout: 90_000 }).toBe('installed')
    expect(updateScriptRequests).toBeGreaterThan(0)
    expect(await activeBuild(page)).toBe(oldBuild)
    expect(await page.evaluate(() => (window as Window & { pwaUpdateDocumentToken?: string }).pwaUpdateDocumentToken)).toBe(documentToken)
    await expect(document).toContainText('Conteúdo real do primeiro capítulo.')
    expect(await packageSnapshot(page, epub.id)).toEqual(saved)

    // Leave the reader through its real SPA link, then accept via the actual UI.
    await page.getByRole('link', { name: 'Voltar ao livro', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Atualizar aplicativo', exact: true })).toBeVisible()
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Atualizar aplicativo', exact: true }).click(),
    ])
    await expect(page.getByRole('heading', { name: epub.title, exact: true })).toBeVisible()
    await expect.poll(() => activeBuild(page)).toBe(nextBuild)
    expect(await page.evaluate(() => (window as Window & { pwaUpdateDocumentToken?: string }).pwaUpdateDocumentToken)).toBeUndefined()
    expect(await packageSnapshot(page, epub.id)).toEqual(saved)
    await expect(page.getByRole('button', { name: 'Remover download', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Atualizar aplicativo', exact: true })).toHaveCount(0)

    await context.close(); context = undefined
    // The server is also stopped: this proves cold start without any possible
    // network fallback, not just an already-loaded tab or page.route simulation.
    await closeServer(server)
    context = await playwright[browserName].launchPersistentContext(profile, { ...options, offline: true })
    const cold = await context.newPage()
    await cold.goto(`/read/${epub.id}`)
    await expect(cold.frameLocator('.epub-stage:not(.epub-stage--preparing)').locator('.reader-document')).toContainText('Conteúdo real do primeiro capítulo.')
    await expect(cold.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
    expect(await activeBuild(cold)).toBe(nextBuild)
    expect(await packageSnapshot(cold, epub.id)).toEqual(saved)
  } finally {
    if (context) await context.close()
    await closeServer(server)
    await fixture.cleanup()
    await fs.rm(profile, { recursive: true, force: true })
  }
})

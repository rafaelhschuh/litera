import { test, expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const password = 'test-password-strong-123'
const booksDatabase = 'litera-offline-books'
const readingDatabase = 'litera-reading'
type Book = { id: number; title: string; format: 'epub' | 'pdf'; fileRevision: string }
type StoredBook = { userId: number; bookId: number; generation: string; revision: string; bytes: number }
type OwnedRecord = { userId: number; bookId: number }
const active = (page: Page) => page.frameLocator('.epub-stage:not(.epub-stage--preparing)')

// Each test gets a real, independent reader account; no seeded local state and
// no shared admin progress/highlights leaking between projects or retries.
async function createReader(request: APIRequestContext) {
  expect((await request.post('/api/v1/auth/login', { data: { username: 'admin', password } })).ok()).toBe(true)
  const libraries = await (await request.get('/api/v1/admin/libraries')).json()
  const username = `offline-${randomUUID()}`
  const response = await request.post('/api/v1/admin/users', { data: {
    username, password, displayName: 'Offline E2E', role: 'reader',
    libraryIds: libraries.libraries.map((library: { id: number }) => library.id),
  } })
  expect(response.status()).toBe(201)
  return (await response.json()).user as { id: number; username: string }
}

async function signIn(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Usuário', { exact: true }).fill(username)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('/')
}

async function fixtureBooks(page: Page) {
  const response = await page.request.get('/api/v1/books')
  expect(response.ok()).toBe(true)
  const books: Book[] = (await response.json()).books
  const epub = books.find(book => book.title === 'A Ilha de Teste')!
  const pdf = books.find(book => book.title === 'Fidelidade PDF')!
  expect(epub).toBeDefined(); expect(pdf).toBeDefined()
  return { epub, pdf }
}

// Read-only inspection of the public storage contract. Abort on a missing DB
// instead of accidentally creating it and making a broken app appear healthy.
async function records<T>(page: Page, database: string, store: string): Promise<T[]> {
  return page.evaluate(({ database, store }) => new Promise<T[]>((resolve, reject) => {
    const opening = indexedDB.open(database)
    opening.onupgradeneeded = () => opening.transaction!.abort()
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const db = opening.result
      if (!db.objectStoreNames.contains(store)) { db.close(); reject(new Error(`Missing store ${store}`)); return }
      const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).getAll()
      tx.oncomplete = () => { db.close(); resolve(request.result) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  }), { database, store })
}

async function storedBook(page: Page, userId: number, bookId: number) {
  return (await records<StoredBook>(page, booksDatabase, 'books')).find(book => book.userId === userId && book.bookId === bookId)
}

async function pending(page: Page, userId: number) {
  return (await records<OwnedRecord>(page, readingDatabase, 'pendingOperations')).filter(operation => operation.userId === userId)
}

async function localLocator(page: Page, userId: number, bookId: number) {
  const state = await records<{ userId: number; key: string; value: { progress?: { locator: unknown } } }>(page, readingDatabase, 'state')
  return state.find(row => row.userId === userId && row.key === `/api/v1/books/${bookId}/progress`)?.value.progress?.locator
}

async function markedText(marks: Locator, quote: string) {
  // PDF paragraphs can span several text nodes/native fonts and therefore marks.
  await expect.poll(async () => (await marks.allTextContents()).join('')).toContain(quote)
}

async function saveBook(page: Page, book: Book, userId: number) {
  await page.goto(`/books/${book.id}`)
  await expect(page.getByRole('heading', { name: book.title, exact: true })).toBeVisible()
  // The detail endpoint uses live stat; catalog revisions may come from scan.
  const detail = await page.request.get(`/api/v1/books/${book.id}`)
  expect(detail.ok()).toBe(true)
  const revision = (await detail.json()).book.fileRevision
  await page.getByRole('button', { name: 'Salvar para offline', exact: true }).click()
  await expect(page.getByText('Disponível offline.', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: 'Remover download', exact: true })).toBeVisible()
  await expect.poll(() => storedBook(page, userId, book.id)).toMatchObject({ userId, bookId: book.id, revision })
  expect((await storedBook(page, userId, book.id))!.generation).toBeTruthy()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

function observeContent(context: BrowserContext) {
  const requests: string[] = []
  context.on('request', request => {
    if (/^\/api\/v1\/books\/\d+\/(?:content(?:$|\/)|epub\/|pdf\/)/.test(new URL(request.url()).pathname)) requests.push(request.url())
  })
  return requests
}

async function ready(page: Page) {
  await expect(page.locator('.reader-stage')).toBeVisible()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
}

async function epubChapter(page: Page, chapter: number) {
  await page.getByRole('button', { name: 'Abrir sumário', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: `Capítulo ${chapter}`, exact: true }).click()
  await expect(active(page).locator('h1')).toHaveText(chapter === 1 ? 'Chegada' : 'Travessia')
  await ready(page)
}

async function epubAssets(page: Page, chapter: number) {
  const image = active(page).getByAltText(`Ilustração offline ${chapter}`)
  await expect(image).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const caption = active(page).locator('.offline-caption')
  await expect(caption).toHaveCSS('font-style', 'italic')
  await expect(caption).toHaveCSS('font-weight', '700') // imported CSS, not just the top-level sheet
  expect(await caption.evaluate(async element => {
    const loaded = await element.ownerDocument.fonts.load('16px OfflineFixture')
    return loaded.length > 0 && loaded.every(font => font.status === 'loaded')
  })).toBe(true)
}

async function epubPosition(page: Page) {
  return active(page).locator('body').evaluate(() => {
    const elements = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,figure,img')]
    const elementIndex = elements.findIndex(element => element.getBoundingClientRect().bottom > Math.min(48, innerHeight * .1))
    return { elementIndex, offset: Math.round(-elements[elementIndex]!.getBoundingClientRect().top) }
  })
}

async function highlight(page: Page, paragraphs: Locator) {
  const quote = await paragraphs.evaluateAll(elements => {
    const element = elements.find(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom < element.ownerDocument.defaultView!.innerHeight && element.textContent!.trim().length > 10 })
    if (!element) throw new Error('Fixture has no visible paragraph to select')
    const document = element.ownerDocument, selection = document.defaultView!.getSelection()!, range = document.createRange()
    document.defaultView!.focus(); range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range)
    return selection.toString().trim()
  })
  await page.getByRole('toolbar', { name: 'Ações do trecho selecionado' }).getByRole('button', { name: 'Destacar', exact: true }).click()
  await expect(page.getByRole('toolbar', { name: 'Ações do trecho selecionado' })).toHaveCount(0)
  return quote
}

async function pdfPage(page: Page, number: number) {
  // PDF has neither TOC nor page input. One-page viewport avoids spread skips;
  // PageDown also exercises incremental reflow instead of jumping via search.
  await page.setViewportSize({ width: 390, height: 844 })
  const navigation = page.getByRole('navigation', { name: 'Navegação da leitura' })
  for (let turns = 0; turns < 50; turns++) {
    await ready(page)
    const current = Number((await navigation.innerText()).match(/Páginas? (\d+)/)?.[1])
    expect(Number.isInteger(current) && current > 0).toBe(true)
    if (current === number) return
    const before = await page.locator('.reader-stage').evaluate(el => ({ scroll: el.scrollTop, content: el.innerHTML }))
    await page.keyboard.press(current < number ? 'PageDown' : 'PageUp')
    await ready(page)
    await expect.poll(() => page.locator('.reader-stage').evaluate(el => ({ scroll: el.scrollTop, content: el.innerHTML }))).not.toEqual(before)
  }
  throw new Error(`PDF did not reach page ${number} within 50 navigation steps`)
}

test('offline EPUB + PDF: deep reload, new tab, assets, annotations and library-wide synchronization', async ({ page, context, request }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  context.on('weberror', error => errors.push(error.error().message))
  const user = await createReader(request)
  await signIn(page, user.username)
  const { epub, pdf } = await fixtureBooks(page)
  await saveBook(page, epub, user.id)
  await saveBook(page, pdf, user.id)
  expect((await storedBook(page, user.id, pdf.id))!.bytes).toBeGreaterThan(8 * 1024 * 1024)
  const contentRequests = observeContent(context)
  await context.setOffline(true)
  await page.goto('/library')
  await expect(page.getByText('Offline · livros deste dispositivo', { exact: true })).toBeVisible()
  await expect(page.locator(`a[href="/books/${epub.id}"]`).first()).toBeVisible()
  await expect(page.locator(`a[href="/books/${pdf.id}"]`).first()).toBeVisible()
  await page.goto(`/read/${epub.id}`)
  await ready(page)
  await page.reload()
  await ready(page)
  await epubAssets(page, 1)
  await epubChapter(page, 2)
  await epubAssets(page, 2)
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '+', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sépia', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  await ready(page)
  await expect(active(page).locator('.reader-document')).toHaveCSS('font-size', '19.8px')
  await expect(active(page).locator('body')).toHaveCSS('background-color', 'rgb(244, 234, 214)')
  await epubAssets(page, 2)
  await page.getByRole('button', { name: 'Avançar na leitura' }).click()
  await ready(page)
  await expect.poll(async () => (await epubPosition(page)).elementIndex).toBeGreaterThan(0)
  const epubLocator = await epubPosition(page)
  const epubQuote = await highlight(page, active(page).locator('p'))
  await expect.poll(async () => (await pending(page, user.id)).filter(operation => operation.bookId === epub.id).length).toBeGreaterThanOrEqual(2)
  await expect.poll(() => localLocator(page, user.id, epub.id)).toMatchObject(epubLocator)
  await page.reload()
  await ready(page)
  await expect.poll(async () => (await epubPosition(page)).elementIndex).toBe(epubLocator.elementIndex)
  await markedText(active(page).locator('mark[data-litera-highlight]'), epubQuote)

  await page.goto(`/read/${pdf.id}`)
  await expect(page.locator('.pdf-canvas').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('.pdf-canvas').first()).toBeVisible()
  await pdfPage(page, 2)
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-page', '2')
  await page.goto(`/read/${pdf.id}?mode=epub`)
  await ready(page)
  await pdfPage(page, 2)
  const figure = page.getByAltText('Ilustração da página')
  await expect(figure).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => figure.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const nativeFont = page.locator('.reader-document span[style*="litera-pdf-"]').first()
  await expect(nativeFont).toBeVisible()
  expect(await nativeFont.evaluate(async element => {
    const loaded = await document.fonts.load(`18px ${getComputedStyle(element).fontFamily}`)
    return loaded.length > 0 && loaded.every(font => font.status === 'loaded')
  })).toBe(true)
  await pdfPage(page, 3)
  await expect(page.locator('.reader-document')).toContainText('FINAL: capacidade de continuar o paragrafo completo.')
  await page.locator('.reader-document p').last().scrollIntoViewIfNeeded()
  const pdfQuote = await highlight(page, page.locator('.reader-document p'))
  await expect.poll(async () => (await pending(page, user.id)).filter(operation => operation.bookId === pdf.id).length).toBeGreaterThanOrEqual(2)
  await expect.poll(() => localLocator(page, user.id, pdf.id)).toMatchObject({ type: 'pdf-reflow', page: 3 })
  await page.reload()
  await ready(page)
  await expect(page.getByRole('navigation', { name: 'Navegação da leitura' })).toContainText('Página 3 de 3')
  await markedText(page.locator('mark[data-litera-highlight]'), pdfQuote)

  // Closing every page removes in-memory sources, Blob URLs and reader modules.
  // This is deliberately distinct from the browser-process restart test below.
  await page.close()
  const cold = await context.newPage()
  await cold.goto(`/read/${epub.id}`)
  await ready(cold)
  await expect(active(cold).locator('h1')).toHaveText('Travessia')
  await markedText(active(cold).locator('mark[data-litera-highlight]'), epubQuote)
  await epubAssets(cold, 2)
  await cold.goto(`/read/${pdf.id}?mode=epub`)
  await ready(cold)
  await markedText(cold.locator('mark[data-litera-highlight]'), pdfQuote)
  await cold.goto('/settings')
  await expect(cold.getByRole('heading', { name: 'Offline', exact: true })).toBeVisible()
  await cold.goto('/library')
  await expect(cold.getByText('Offline · livros deste dispositivo', { exact: true })).toBeVisible()
  expect(contentRequests).toEqual([]) // includes failed requests and SW-originated requests

  const submissions: Array<{ url: string; body: string; operation: string; user: string }> = []
  context.on('request', request => {
    if (request.method() === 'POST' && /\/books\/\d+\/highlights$/.test(request.url())) submissions.push({
      url: request.url(), body: request.postData()!, operation: request.headers()['x-litera-operation']!, user: request.headers()['x-litera-user']!,
    })
  })
  await context.setOffline(false) // Must drain ALL books without mounting a reader.
  await expect.poll(async () => (await pending(cold, user.id)).length, { timeout: 30_000 }).toBe(0)
  expect(new URL(cold.url()).pathname).toBe('/library')
  for (const [book, quote] of [[epub, epubQuote], [pdf, pdfQuote]] as const) {
    const response = await cold.request.get(`/api/v1/books/${book.id}/highlights`)
    expect(response.ok()).toBe(true)
    expect((await response.json()).highlights).toMatchObject([{ quoteText: quote }])
  }
  const epubProgress = (await (await cold.request.get(`/api/v1/books/${epub.id}/progress`)).json()).progress
  expect(epubProgress.locator).toMatchObject({ type: 'epub-cfi', chapterHref: 'chapter-2.xhtml', elementIndex: epubLocator.elementIndex })
  const pdfProgress = (await (await cold.request.get(`/api/v1/books/${pdf.id}/progress`)).json()).progress
  expect(pdfProgress.locator).toMatchObject({ type: 'pdf-reflow', page: 3 })
  expect(submissions).toHaveLength(2)
  // Replay the exact real operation as if the successful response had been lost.
  for (const submission of submissions) {
    expect(submission.operation).toMatch(/^[a-zA-Z0-9_-]{16,128}$/)
    expect(submission.user).toBe(String(user.id))
    const replay = await cold.request.post(submission.url, { data: JSON.parse(submission.body), headers: { 'x-litera-operation': submission.operation, 'x-litera-user': submission.user } })
    expect(replay.status()).toBe(201)
    expect((await (await cold.request.get(submission.url)).json()).highlights).toHaveLength(1)
  }
  expect(errors).toEqual([])
})

test('offline package survives a real persistent browser close/relaunch', async ({ playwright, browserName, baseURL, request }, info) => {
  test.setTimeout(180_000)
  test.skip(browserName === 'webkit', 'Playwright WebKit cannot navigate an offline persistent profile after relaunch; same-context WebKit offline flows remain mandatory')
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-offline-profile-'))
  const use = info.project.use
  const options = { ...use.launchOptions, headless: true, baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, serviceWorkers: 'allow' as const }
  let persistent: BrowserContext | undefined
  try {
    const user = await createReader(request)
    persistent = await playwright[browserName].launchPersistentContext(profile, options)
    const page = await persistent.newPage()
    await signIn(page, user.username)
    const { epub, pdf } = await fixtureBooks(page)
    await saveBook(page, epub, user.id)
    await saveBook(page, pdf, user.id)
    await persistent.close(); persistent = undefined
    // No online navigation after reopening; storageState is not a substitute for
    // persisted IDB + shell caches + SW registration. WebKit is not skipped.
    persistent = await playwright[browserName].launchPersistentContext(profile, { ...options, offline: true })
    const requests = observeContent(persistent)
    const cold = await persistent.newPage()
    await cold.goto(`/read/${epub.id}`)
    await ready(cold)
    await epubChapter(cold, 2)
    await epubAssets(cold, 2)
    await cold.goto(`/read/${pdf.id}`)
    await expect(cold.locator('.pdf-canvas').first()).toBeVisible()
    await cold.goto(`/read/${pdf.id}?mode=epub`)
    await ready(cold)
    await pdfPage(cold, 2)
    await expect(cold.getByAltText('Ilustração da página')).toHaveAttribute('src', /^blob:/)
    expect(requests).toEqual([])
  } finally {
    if (persistent) await persistent.close()
    await fs.rm(profile, { recursive: true, force: true })
  }
})

test('cancelling an in-flight download never publishes a partial package', async ({ page, context, request }) => {
  const user = await createReader(request)
  await signIn(page, user.username)
  const { epub } = await fixtureBooks(page)
  let reached = false, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await context.route(`**/books/${epub.id}/epub/chapter?**`, async route => { reached = true; await held; await route.abort('failed') })
  try {
    await page.goto(`/books/${epub.id}`)
    await page.getByRole('button', { name: 'Salvar para offline', exact: true }).click()
    await expect.poll(() => reached).toBe(true)
    await page.getByRole('button', { name: 'Cancelar download', exact: true }).click()
    release()
    await expect(page.getByRole('button', { name: 'Salvar para offline', exact: true })).toBeEnabled()
    expect(await storedBook(page, user.id, epub.id)).toBeUndefined()
    await expect.poll(async () => (await records<OwnedRecord>(page, booksDatabase, 'stages')).length).toBe(0)
    expect(await records(page, booksDatabase, 'resources')).toEqual([])
    await page.reload()
    await expect(page.getByRole('button', { name: 'Salvar para offline', exact: true })).toBeEnabled()
    await expect(page.getByText('Disponível offline.', { exact: true })).toHaveCount(0)
  } finally { release(); await context.unrouteAll({ behavior: 'wait' }) }
})

test('download interrupted after partial bytes is not available and can be retried', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const user = await createReader(request)
  await signIn(page, user.username)
  const { pdf } = await fixtureBooks(page)
  let transferred = 0
  await context.route(`**/books/${pdf.id}/content`, async route => {
    const response = await route.fetch()
    const complete = await response.body()
    const partial = complete.subarray(0, Math.floor(complete.length / 2))
    transferred = partial.length
    await route.fulfill({ response, body: partial, headers: { ...response.headers(), 'content-length': String(complete.length) } })
  })
  await page.goto(`/books/${pdf.id}`)
  await page.getByRole('button', { name: 'Salvar para offline', exact: true }).click()
  await expect.poll(() => transferred).toBeGreaterThan(4 * 1024 * 1024)
  await expect(page.getByRole('button', { name: 'Salvar para offline', exact: true })).toBeEnabled()
  expect(await storedBook(page, user.id, pdf.id)).toBeUndefined()
  await expect(page.getByText('Disponível offline.', { exact: true })).toHaveCount(0)
  await expect.poll(async () => (await records(page, booksDatabase, 'stages')).length).toBe(0)
  expect(await records(page, booksDatabase, 'resources')).toEqual([])
  await context.unrouteAll({ behavior: 'wait' })
  await saveBook(page, pdf, user.id)
})

test('removing the download preserves queued progress, highlight and favorite', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const user = await createReader(request)
  await signIn(page, user.username)
  const { epub } = await fixtureBooks(page)
  await saveBook(page, epub, user.id)
  await context.setOffline(true)
  await page.goto(`/read/${epub.id}`)
  await ready(page)
  await epubChapter(page, 2)
  const quote = await highlight(page, active(page).locator('p'))
  await expect.poll(async () => (await pending(page, user.id)).length).toBeGreaterThanOrEqual(2)
  await expect.poll(() => localLocator(page, user.id, epub.id)).toMatchObject({ chapterHref: 'chapter-2.xhtml' })
  await page.goto(`/books/${epub.id}`)
  await page.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remover dos favoritos', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remover download', exact: true }).click()
  await expect.poll(() => storedBook(page, user.id, epub.id)).toBeUndefined()
  expect(await records(page, booksDatabase, 'resources')).toEqual([])
  expect((await pending(page, user.id)).length).toBeGreaterThanOrEqual(3)
  await page.reload()
  await expect(page.locator('.highlight-card blockquote')).toContainText([quote])
  await expect(page.getByRole('button', { name: 'Remover dos favoritos', exact: true })).toBeVisible()
  await page.goto('/library')
  await context.setOffline(false)
  await expect.poll(async () => (await pending(page, user.id)).length, { timeout: 30_000 }).toBe(0)
  expect((await (await page.request.get(`/api/v1/books/${epub.id}`)).json()).book.favorite).toBe(true)
  expect((await (await page.request.get(`/api/v1/books/${epub.id}/highlights`)).json()).highlights).toMatchObject([{ quoteText: quote }])
  expect((await (await page.request.get(`/api/v1/books/${epub.id}/progress`)).json()).progress.locator).toMatchObject({ type: 'epub-cfi', chapterHref: 'chapter-2.xhtml' })
})

test('quota failure leaves no partial package and does not damage an existing book', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const user = await createReader(request)
  await signIn(page, user.username)
  const { epub, pdf } = await fixtureBooks(page)
  await saveBook(page, epub, user.id)
  const committed = await storedBook(page, user.id, epub.id)
  // Real IDB writes fail only for PDF resources. No quota estimate spoof and no
  // successful offline responses fabricated by the test.
  await page.goto(`/books/${pdf.id}`)
  await page.evaluate(bookId => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.transaction.db.name === 'litera-offline-books' && this.name === 'resources' && value.bookId === bookId) throw new DOMException('E2E quota exhausted', 'QuotaExceededError')
      return key === undefined ? original.call(this, value) : original.call(this, value, key)
    }
  }, pdf.id)
  await page.getByRole('button', { name: 'Salvar para offline', exact: true }).click()
  await expect(page.getByText(/espaço.*(?:suficiente|dispositivo)|armazenamento.*(?:cheio|insuficiente)/i)).toBeVisible()
  expect(await storedBook(page, user.id, pdf.id)).toBeUndefined()
  expect(await storedBook(page, user.id, epub.id)).toEqual(committed)
  await expect.poll(async () => (await records(page, booksDatabase, 'stages')).length).toBe(0)
  expect((await records<OwnedRecord>(page, booksDatabase, 'resources')).every(resource => resource.bookId === epub.id)).toBe(true)
  await page.reload() // Remove the fault injection without touching application state.
  await context.setOffline(true)
  await page.goto(`/read/${epub.id}`)
  await ready(page)
  await epubAssets(page, 1)
})

test('a changed source revision is replaced atomically by Atualizar download', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const user = await createReader(request)
  await signIn(page, user.username)
  const { epub } = await fixtureBooks(page)
  await saveBook(page, epub, user.id)
  const previous = (await storedBook(page, user.id, epub.id))!
  const existingReader = await context.newPage()
  await existingReader.goto(`/read/${epub.id}`)
  await ready(existingReader)
  await epubAssets(existingReader, 1)
  const changed = await request.post('/__e2e/revise-epub')
  expect(changed.ok()).toBe(true)
  const { libraryId } = await changed.json()
  expect((await request.post(`/api/v1/admin/libraries/${libraryId}/scan`)).ok()).toBe(true)
  await expect.poll(async () => (await (await page.request.get(`/api/v1/books/${epub.id}`)).json()).book.fileRevision).not.toBe(previous.revision)
  await page.reload()
  await page.getByRole('button', { name: 'Atualizar download', exact: true }).click()
  await expect(page.getByText('Disponível offline.', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => (await storedBook(page, user.id, epub.id))?.generation).not.toBe(previous.generation)
  const current = (await storedBook(page, user.id, epub.id))!
  expect(current.revision).not.toBe(previous.revision)
  const generations = new Set((await records<StoredBook>(page, booksDatabase, 'resources')).map(resource => resource.generation))
  expect(generations.has(current.generation)).toBe(true)
  expect(generations.has(previous.generation)).toBe(true)
  await context.setOffline(true)
  // A reader opened before the update still owns its old-generation snapshot.
  await epubChapter(existingReader, 2)
  await epubAssets(existingReader, 2)
  await expect(active(existingReader).locator('.reader-document')).toContainText('Conteúdo real do segundo capítulo.')
  await expect.poll(() => localLocator(existingReader, user.id, epub.id)).toMatchObject({ chapterHref: 'chapter-2.xhtml' })
  await existingReader.close()
  await page.goto(`/read/${epub.id}`)
  await ready(page)
  await expect(active(page).locator('h1')).toHaveText('Travessia')
  await epubAssets(page, 2)
})

test('offline logout purges account A; account B cannot see or synchronize its books', async ({ page, context, request }) => {
  test.setTimeout(120_000)
  const first = await createReader(request), second = await createReader(request)
  await signIn(page, first.username)
  const { epub } = await fixtureBooks(page)
  await saveBook(page, epub, first.id)
  await context.setOffline(true)
  await page.goto(`/read/${epub.id}`)
  await ready(page)
  const quote = await highlight(page, active(page).locator('p'))
  await expect.poll(async () => (await pending(page, first.id)).length).toBeGreaterThan(0)
  await page.goto('/library')
  const menu = page.getByRole('button', { name: 'Abrir navegação', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  for (const store of ['books', 'resources', 'stages', 'snapshots']) expect((await records<OwnedRecord>(page, booksDatabase, store)).filter(row => row.userId === first.id)).toEqual([])
  for (const store of ['pendingOperations', 'state']) expect((await records<OwnedRecord>(page, readingDatabase, store)).filter(row => row.userId === first.id)).toEqual([])
  expect(await page.evaluate(() => localStorage.getItem('litera-offline-session'))).toBeNull()
  await page.goto(`/read/${epub.id}`)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await context.setOffline(false)
  await signIn(page, second.username)
  expect((await (await page.request.get(`/api/v1/books/${epub.id}/highlights`)).json()).highlights).toEqual([])
  expect((await (await page.request.get(`/api/v1/books/${epub.id}/progress`)).json()).progress).toBeNull()
  await context.setOffline(true)
  await page.goto('/library')
  await expect(page.getByText('Offline · livros deste dispositivo', { exact: true })).toBeVisible()
  await expect(page.locator(`a[href="/books/${epub.id}"]`)).toHaveCount(0)
  await page.goto(`/read/${epub.id}`)
  await expect(page.getByRole('heading', { name: 'Não foi possível abrir este livro', exact: true })).toBeVisible()
  await expect(page.locator('mark[data-litera-highlight]')).toHaveCount(0)
  await expect(page.getByText(quote, { exact: true })).toHaveCount(0)
})

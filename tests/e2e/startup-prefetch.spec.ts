import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { writeEpub } from '../fixtures.js'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário', { exact: true }).fill('admin')
  await page.getByLabel('Senha', { exact: true }).fill('test-password-strong-123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('/')
}

test.describe('startup and progressive preparation', () => {
  test.use({ serviceWorkers: 'block' })

  test('animates startup before the main JavaScript has loaded', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route(/\/assets\/index-[^/]+\.js$/, async route => { await held; await route.continue() })
    try {
      await page.goto('/login', { waitUntil: 'commit' })
      await expect(page.locator('.app-start')).toContainText('Abrindo sua biblioteca')
      const spinner = page.locator('.app-start .loading-spinner')
      await expect(spinner).toBeVisible()
      await expect(spinner).toHaveCSS('animation-name', 'loading-spin')
      const before = await spinner.evaluate(el => getComputedStyle(el).transform)
      await expect.poll(() => spinner.evaluate(el => getComputedStyle(el).transform)).not.toBe(before)
    } finally { release() }
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
  })

  test('shows login preparation and opens a warmed book while its refresh is still pending', async ({ page }) => {
    let releaseLogin!: () => void, releaseHome!: () => void, releaseDetail!: () => void
    const loginHeld = new Promise<void>(resolve => { releaseLogin = resolve })
    const homeHeld = new Promise<void>(resolve => { releaseHome = resolve })
    const detailHeld = new Promise<void>(resolve => { releaseDetail = resolve })
    let first: any
    const wholeBooks: string[] = []
    page.on('request', request => { if (/\/api\/v1\/books\/\d+\/content$/.test(request.url())) wholeBooks.push(request.url()) })
    await page.route('**/api/v1/auth/login', async route => { const response = await route.fetch(); await loginHeld; await route.fulfill({ response }) })
    await page.route('**/api/v1/home', async route => {
      const response = await route.fetch()
      const home = await response.json()
      first = [...home.continueReading, ...home.recentlyAdded][0]
      await homeHeld; await route.fulfill({ response })
    })
    try {
      await page.goto('/login')
      await page.getByLabel('Usuário', { exact: true }).fill('admin')
      await page.getByLabel('Senha', { exact: true }).fill('test-password-strong-123')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(page.locator('.auth-form .loading-spinner')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Entrando…', exact: true })).toBeDisabled()
      await expect(page.locator('.login-progress')).toHaveText('Conectando…')
      releaseLogin()
      await expect(page.locator('.login-progress')).toHaveText('Preparando sua biblioteca…')
      releaseHome()
      await page.waitForURL('/')
      await expect(page.locator('.state--loading')).toHaveCount(0)
      await page.route(new RegExp(`/api/v1/books/${first.id}$`), async route => { const response = await route.fetch(); await detailHeld; await route.fulfill({ response }) })
      await page.locator(`.book-card h3 a[href="/books/${first.id}"]`).first().click()
      await expect(page.locator('.book-detail h1')).toHaveText(first.title)
      await expect(page.locator('.book-detail')).toHaveAttribute('aria-busy', 'true')
      await expect(page.locator('.state--loading')).toHaveCount(0)
      expect(wholeBooks).toEqual([])
    } finally { releaseLogin(); releaseHome(); releaseDetail() }
  })

  test('prepares later books when scrolling without loading entire books', async ({ page, request }) => {
    expect((await request.post('/api/v1/auth/login', { data: { username: 'admin', password: 'test-password-strong-123' } })).ok()).toBe(true)
    const library = (await (await request.get('/api/v1/admin/libraries')).json()).libraries[0]
    const folder = await fs.mkdtemp(path.join(library.path, 'viewport-'))
    const seen = new Set<number>(), wholeBooks: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      const detail = url.pathname.match(/^\/api\/v1\/books\/(\d+)$/)
      if (detail) seen.add(Number(detail[1]))
      if (/\/api\/v1\/books\/\d+\/content$/.test(url.pathname)) wholeBooks.push(url.pathname)
    })
    try {
      for (let index = 0; index < 18; index++) await writeEpub(path.join(folder, `${index}.epub`), `Livro para rolagem ${index}`)
      expect((await request.post(`/api/v1/admin/libraries/${library.id}/scan`)).ok()).toBe(true)
      await page.setViewportSize({ width: 390, height: 600 })
      await signIn(page)
      const home = await (await page.request.get('/api/v1/home')).json()
      const last = home.recentlyAdded.at(-1)
      expect(last).toBeDefined()
      await expect(page.locator('.catalog-section .book-grid').last()).toBeVisible()
      expect(seen.has(last.id)).toBe(false)
      await page.locator(`.book-card h3 a[href="/books/${last.id}"]`).last().scrollIntoViewIfNeeded()
      await expect.poll(() => seen.has(last.id)).toBe(true)
      expect(wholeBooks).toEqual([])
    } finally {
      await fs.rm(folder, { recursive: true, force: true })
      await request.post(`/api/v1/admin/libraries/${library.id}/scan`)
    }
  })
})

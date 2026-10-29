import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeEpub, writePdf } from '../fixtures.js'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário', { exact: true }).fill('admin')
  await page.getByLabel('Senha', { exact: true }).fill('test-password-strong-123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('/')
}

test.describe('screen continuity and book upload', () => {
  test.use({ serviceWorkers: 'block' })

  test('keeps the catalog, filters and scroll through detail/reader and refresh failures', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 780, height: 450 })
    await signIn(page)
    await page.goto('/library')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toBeVisible()
    await page.locator('#library-sort').selectOption('recent')
    await expect(page.locator('#main > div[aria-busy]')).toHaveAttribute('aria-busy', 'false')
    await page.locator('.book-grid:not(.skeleton-grid):visible').evaluate(el => { (el as HTMLElement).dataset.retained = 'yes' })
    await page.evaluate(() => window.scrollTo(0, 300))
    const link = page.getByRole('link', { name: 'A Ilha de Teste', exact: true })
    await link.scrollIntoViewIfNeeded()
    const scroll = await page.evaluate(() => window.scrollY)
    await link.click()
    await expect(page.locator('.book-detail')).toBeVisible()
    await expect(page.locator('.page-enter-active,.surface-enter-active')).toHaveCount(0)
    const titleY = (await page.locator('.book-detail h1').boundingBox())!.y + await page.evaluate(() => window.scrollY)
    await page.getByRole('link', { name: /Começar leitura|Continuar leitura/ }).click()
    await expect(page.frameLocator('.epub-stage:not(.epub-stage--preparing)').locator('.reader-document')).toBeVisible()
    let detailRelease: (() => void) | undefined
    const detailHeld = new Promise<void>(resolve => { detailRelease = resolve })
    await page.route(/\/api\/v1\/books\/\d+$/, async route => { const response = await route.fetch(); await detailHeld; await route.fulfill({ response }) })
    await page.getByRole('link', { name: 'Voltar ao livro', exact: true }).click()
    await expect(page.locator('.book-detail')).toBeVisible()
    const title = page.locator('.book-detail h1')
    await expect(page.locator('.page-refresh__activity')).toBeVisible()
    await expect(page.locator('.page-enter-active,.surface-enter-active')).toHaveCount(0)
    expect((await title.boundingBox())!.y + await page.evaluate(() => window.scrollY)).toBeCloseTo(titleY, 0)
    detailRelease!()
    await page.unroute(/\/api\/v1\/books\/\d+$/, { behavior: 'wait' })
    await page.getByRole('link', { name: '← Biblioteca', exact: true }).click()
    await expect(page.locator('#library-sort')).toHaveValue('recent')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toHaveAttribute('data-retained', 'yes')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll)

    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/v1/books?**', async route => { await held; await route.fulfill({ status: 422, json: { error: { message: 'Falha temporária de teste' } } }) })
    await page.locator('#library-sort').selectOption('title')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toBeVisible()
    await expect(page.locator('.state--loading')).toHaveCount(0)
    release!()
    await expect(page.locator('.page-refresh .alert')).toContainText('Falha temporária')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toHaveAttribute('data-retained', 'yes')
    await page.unroute('**/api/v1/books?**')
    await page.locator('.page-refresh').getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(page.locator('.page-refresh .alert')).toHaveCount(0)
    await page.screenshot({ path: `test-results/navigation-${test.info().project.name}.png`, fullPage: true })
    expect(errors).toEqual([])
  })

  test('keeps the latest filter response and respects reduced motion', async ({ page }) => {
    await signIn(page)
    await page.goto('/library')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toBeVisible()
    let release: (() => void) | undefined
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/v1/books?**', async route => {
      const response = await route.fetch()
      if (new URL(route.request().url()).searchParams.get('format') === 'epub') await held
      await route.fulfill({ response })
    })
    await page.locator('#library-format').selectOption('epub')
    await page.locator('#library-format').selectOption('pdf')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toContainText('Caderno PDF')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).not.toContainText('A Ilha de Teste')
    release!()
    await page.unroute('**/api/v1/books?**', { behavior: 'wait' })
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).not.toContainText('A Ilha de Teste')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => page.locator('.book-card').first().evaluate(el => Number.parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001)
  })

  test('destroys retained screens on logout and a different account login', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await signIn(page)
    const libraries = (await (await page.request.get('/api/v1/admin/libraries')).json()).libraries
    const username = `reader-${Date.now()}`
    expect((await page.request.post('/api/v1/admin/users', { data: { username, displayName: 'Outro leitor', password: 'reader-password-123', role: 'reader', libraryIds: [libraries[0].id] } })).status()).toBe(201)
    const navigation = page.getByRole('navigation', { name: 'Principal', exact: true })
    await navigation.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.waitForURL('/library')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toBeVisible()
    await page.locator('.book-grid:not(.skeleton-grid):visible').evaluate(el => { (el as HTMLElement).dataset.privateScreen = 'admin' })
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    await page.waitForURL('/login')
    await page.getByLabel('Usuário', { exact: true }).fill(username)
    await page.getByLabel('Senha', { exact: true }).fill('reader-password-123')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('/')
    await navigation.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.waitForURL('/library')
    await expect(page.locator('.book-grid:not(.skeleton-grid):visible')).toBeVisible()
    await expect(page.locator('[data-private-screen="admin"]')).toHaveCount(0)
    await expect(page.locator('.sidebar')).not.toContainText('Administração')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('navigation', { name: 'Navegação inferior', exact: true }).getByRole('button', { name: 'Outros', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Outros', exact: true }).getByRole('button', { name: 'Administração', exact: true })).toHaveCount(0)
  })

  test('uploads real EPUB/PDF files from a library detail and reads the new EPUB', async ({ page }) => {
    await signIn(page)
    const libraries = (await (await page.request.get('/api/v1/admin/libraries')).json()).libraries
    await page.goto(`/admin/libraries/${libraries[0].id}`)
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'litera-upload-e2e-'))
    const title = `Envio ${Date.now()}`
    try {
      const epub = path.join(temp, `${title}.epub`), pdf = path.join(temp, `${title}.pdf`)
      await writeEpub(epub, title); await writePdf(pdf, `${title} PDF`)
      await page.getByLabel('Arquivos EPUB ou PDF').setInputFiles([epub, pdf])
      await page.getByRole('button', { name: 'Enviar para esta biblioteca' }).click()
      await expect(page.getByText('Disponível na biblioteca.', { exact: true })).toHaveCount(2, { timeout: 30000 })
      await expect(page.getByRole('heading', { name: 'Enviar livros', exact: true })).toBeVisible()
      await page.screenshot({ path: `test-results/upload-${test.info().project.name}.png`, fullPage: true })
      await page.goto(`/search?q=${encodeURIComponent(title)}`)
      await page.getByRole('link', { name: title, exact: true }).click()
      await page.getByRole('link', { name: /Começar leitura|Continuar leitura/ }).click()
      await expect(page.frameLocator('.epub-stage:not(.epub-stage--preparing)').locator('.reader-document')).toContainText('Conteúdo real')
    } finally { await fs.rm(temp, { recursive: true, force: true }) }
  })
})

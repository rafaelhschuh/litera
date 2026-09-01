import { test, expect, type Page } from '@playwright/test'

async function openBook(page: Page, title: string) {
  await page.goto('/login')
  await page.getByLabel('Usuário', { exact: true }).fill('admin')
  await page.getByLabel('Senha', { exact: true }).fill('test-password-strong-123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('/')
  await page.request.put('/api/v1/settings', { data: { theme: 'light', fontScale: 100, lineHeight: 'normal', margins: 'normal', appTheme: 'system', reducedMotion: false, pdfInvert: false } })
  await page.goto('/library')
  await page.getByRole('link', { name: new RegExp(title) }).first().click()
  await page.waitForURL(/\/books\/\d+$/)
  const id = page.url().split('/').pop()
  const detail = await (await page.request.get(`/api/v1/books/${id}`)).json()
  const locator = detail.book.format === 'epub' ? { type: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2)', chapterHref: 'chapter-1.xhtml', elementIndex: 0, offset: 0 } : { type: 'pdf-page', page: 1 }
  await page.request.put(`/api/v1/books/${id}/progress`, { data: { format: detail.book.format, progressRatio: 0, locator } })
  await page.getByRole('link', { name: /Começar leitura|Continuar leitura/ }).click()
}
const active = (page: Page) => page.frameLocator('.epub-stage:not(.epub-stage--preparing)')
async function position(page: Page) {
  return page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('.epub-stage:not(.epub-stage--preparing)')!; return { y: frame.contentWindow!.scrollY, text: frame.contentDocument!.body.textContent } })
}

test('EPUB: real opening, 20 turns, settings, rotate, restore and selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openBook(page, 'A Ilha de Teste')
  await expect(active(page).locator('.reader-document')).toContainText('Conteúdo real')
  for (let turn = 0; turn < 20; turn++) {
    const before = await position(page)
    await page.keyboard.press(turn % 4 === 3 ? 'ArrowLeft' : 'ArrowRight')
    await expect.poll(async () => JSON.stringify(await position(page))).not.toBe(JSON.stringify(before))
    await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
    await expect(active(page).locator('.reader-document')).toBeVisible()
    expect(await page.locator('.epub-stage:not(.epub-stage--preparing)').evaluate(el => getComputedStyle(el).transform)).toBe('none')
  }
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  if ((await position(page)).y === 0) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await position(page)).y).toBeGreaterThan(0)
  const beforeRotate = await position(page)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(active(page).locator('.reader-document')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await position(page)).y).toBeGreaterThan(0)
  expect(beforeRotate.y).toBeGreaterThan(0)
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  // Selection wins over navigation, including keys.
  await active(page).locator('body').evaluate(() => { window.focus(); const el = [...document.querySelectorAll('p')].find(p => p.getBoundingClientRect().top > 0)!; const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range) })
  await expect(page.getByRole('toolbar', { name: 'Ações do trecho selecionado' })).toBeVisible()
  const selectedPosition = await position(page)
  await page.keyboard.press('ArrowRight')
  expect(await position(page)).toEqual(selectedPosition)
  await page.getByRole('button', { name: 'Fechar ações do trecho' }).click()
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: '+', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  await expect.poll(async () => active(page).locator('.reader-document').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(19.8, 2)
  await page.keyboard.press('ArrowRight')
  const savedUrl = page.url()
  const bookId = new URL(savedUrl).pathname.split('/').pop()
  await expect.poll(async () => (await (await page.request.get(`/api/v1/books/${bookId}/progress`)).json()).progress.locator.elementIndex).toBeGreaterThan(0)
  const saved = (await (await page.request.get(`/api/v1/books/${bookId}/progress`)).json()).progress.locator
  await page.reload()
  await expect(active(page).locator('.reader-document')).toBeVisible()
  await expect.poll(async () => active(page).locator('body').evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,figure,img')].findIndex(el => el.getBoundingClientRect().bottom > 48))).toBe(saved.elementIndex)
  await page.screenshot({ path: `test-results/epub-${test.info().project.name}.png` })
  expect(errors).toEqual([])
})

test('PDF: complete adapted text and graphic fallback', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openBook(page, 'Fidelidade PDF')
  await expect(page.locator('.pdf-canvas').first()).toBeVisible()
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Texto adaptado', exact: true }).click()
  await expect(page.locator('.reader-document')).toContainText('INICIO:')
  await expect(page.locator('.reader-document')).toContainText('MEIO:')
  await expect(page.locator('.reader-document')).toContainText('FINAL: capacidade de continuar o paragrafo completo.')
  await page.locator('.reader-document p').last().scrollIntoViewIfNeeded()
  await expect(page.locator('.reader-document p').last()).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('status')).toContainText('formato original')
  await expect(page.locator('.pdf-canvas')).toBeVisible()
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.locator('.pdf-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Documento original', exact: true }).click()
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-page', '2')
  expect(await page.locator('.pdf-canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * .3), Math.floor(canvas.height * .5), 1, 1).data])).toEqual([194, 123, 144, 255])
  await page.locator('.reader-stage').evaluate(el => { el.scrollTop = 350 })
  await page.screenshot({ path: `test-results/pdf-${test.info().project.name}.png` })
  expect(errors).toEqual([])
})

test('touch, footnotes, responsive viewports and PWA metadata', async ({ page }, info) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(active(page).locator('.reader-document')).toBeVisible()
  await active(page).getByRole('link', { name: 'Nota', exact: true }).click()
  await expect(active(page).locator('.reader-document')).toContainText('Texto da nota.')
  for (const [width, height] of [[360, 800], [390, 844], [393, 852], [430, 932], [768, 1024], [1024, 768]]) {
    await page.setViewportSize({ width, height })
    await expect.poll(async () => page.locator('.reader-shell').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(height)
    await expect(active(page).locator('.reader-document')).toBeVisible()
    const before = await position(page)
    if (info.project.name === 'webkit') await page.touchscreen.tap(width - 30, height / 2)
    else await page.mouse.click(width - 30, height / 2)
    await expect.poll(async () => (await position(page)).y).toBeGreaterThan(before.y)
    // Native click must not execute a second reader command after pointerup.
    const after = await position(page)
    await expect.poll(async () => (await position(page)).y).toBe(after.y)
  }
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone')
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true)
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png')
  expect(await page.getByRole('button', { name: 'Configurações de leitura' }).evaluate(el => getComputedStyle(el).webkitTapHighlightColor)).toBe('rgba(0, 0, 0, 0)')
})

test('EPUB document policy blocks book scripts while reader listeners work', async ({ page }) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(active(page).locator('.reader-document')).toBeVisible()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  const result = await page.evaluate(async () => {
    const frame = document.querySelector<HTMLIFrameElement>('.epub-stage:not(.epub-stage--preparing)')!
    const doc = frame.contentDocument!
    const blocked = new Promise<string>(resolve => doc.addEventListener('securitypolicyviolation', event => resolve(event.violatedDirective), { once: true }))
    const script = doc.createElement('script'); script.textContent = 'document.body.dataset.unsafeBookScript="ran"'; doc.body.append(script)
    const directive = await blocked
    return { directive, executed: doc.body.dataset.unsafeBookScript, policy: doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') }
  })
  expect(result.executed).toBeUndefined(); expect(result.directive).toContain('script-src'); expect(result.policy).toContain("script-src 'none'")
})

test('EPUB chapter commit keeps an outgoing presentation and reverses correctly', async ({ page }, info) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: 'Abrir sumário' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Capítulo 2' }).click()
  await expect(active(page).locator('h1')).toHaveText('Travessia')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('ArrowLeft')
  await expect(active(page).locator('h1')).toHaveText('Chegada')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => (await position(page)).y).toBeGreaterThan(0)
  const animation = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    const animation = document.getAnimations().find(item => (item.effect as KeyframeEffect)?.target instanceof HTMLElement && ((item.effect as KeyframeEffect).target as HTMLElement).classList.contains('reader-presentation'))!
    animation.pause(); animation.currentTime = 120
    return { duration: animation.effect!.getTiming().duration, iframeTransform: getComputedStyle(document.querySelector('.epub-stage:not(.epub-stage--preparing)')!).transform }
  })
  expect(animation).toEqual({ duration: 240, iframeTransform: 'none' })
  await page.screenshot({ path: `test-results/transition-${info.project.name}.png` })
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()))
})

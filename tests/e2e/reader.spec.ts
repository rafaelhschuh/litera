import { test, expect, type Page } from '@playwright/test'

async function openBook(page: Page, title: string, adapted = false) {
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
  const readerLink = page.getByRole('link', { name: /Começar leitura|Continuar leitura|Reler/ })
  if (adapted) await page.goto((await readerLink.getAttribute('href'))!.split('?')[0] + '?mode=epub')
  else await readerLink.click()
}
const active = (page: Page) => page.frameLocator('.epub-stage:not(.epub-stage--preparing)')
async function position(page: Page) {
  return page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('.epub-stage:not(.epub-stage--preparing)')!; return { y: frame.contentWindow!.scrollY, text: frame.contentDocument!.body.textContent } })
}

test('EPUB: real opening, 20 turns, settings, rotate, restore and selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await openBook(page, 'A Ilha de Teste')
  await expect(active(page).locator('.reader-document')).toContainText('Conteúdo real')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
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
  await page.getByRole('button', { name: 'Aumentar texto', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  await expect.poll(async () => active(page).locator('.reader-document').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(19.8, 2)
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  const savedUrl = page.url()
  const bookId = new URL(savedUrl).pathname.split('/').pop()
  const visibleLocator = await active(page).locator('body').evaluate(() => {
    const elements = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,figure,img')]
    const visible = elements.filter(el => [...el.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight))
    const element = visible.find(el => !visible.some(child => child !== el && el.contains(child)))!
    return { elementIndex: elements.indexOf(element), offset: -element.getBoundingClientRect().top }
  })
  expect(visibleLocator.elementIndex).toBeGreaterThan(0)
  // Wait for this exact viewport, not any earlier nonzero debounced save.
  await expect.poll(async () => (await (await page.request.get(`/api/v1/books/${bookId}/progress`)).json()).progress.locator).toMatchObject(visibleLocator)
  const saved = (await (await page.request.get(`/api/v1/books/${bookId}/progress`)).json()).progress.locator
  expect(saved.textOffset).toBeGreaterThan(0)
  expect(Number.isFinite(saved.textOffsetY)).toBe(true)
  const textTop = () => active(page).locator('.reader-document').evaluate((root, offset) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null, remaining = offset
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('style,script,noscript')) continue
      if (remaining < node.textContent!.length) {
        const range = document.createRange()
        range.setStart(node, remaining); range.setEnd(node, remaining + 1)
        return range.getBoundingClientRect().top
      }
      remaining -= node.textContent!.length
    }
    return -Infinity
  }, saved.textOffset)
  await expect.poll(async () => Math.abs(await textTop() - saved.textOffsetY)).toBeLessThan(2)
  await page.reload()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect(active(page).locator('.reader-document')).toBeVisible()
  // Restore the same character at the same viewport Y, including partial lines.
  await expect.poll(async () => Math.abs(await textTop() - saved.textOffsetY)).toBeLessThan(2)
  await page.screenshot({ path: `test-results/epub-${test.info().project.name}.png` })
  expect(errors).toEqual([])
})

test.describe('PDF adaptation', () => {
// Fault injection must reach the page request instead of an existing service worker.
test.use({ serviceWorkers: 'block' })
test('PDF falls back to adapted reading when the visual engine is unavailable', async ({ page }) => {
  await page.route(/\/api\/v1\/books\/\d+\/content$/, route => route.fulfill({ status: 200, contentType: 'application/pdf', body: 'invalid PDF for visual-engine fault injection' }))
  await openBook(page, 'Fidelidade PDF')
  await expect(page.locator('.reader-document')).toContainText('INICIO:')
  await expect(page.getByText('Não foi possível abrir este livro')).toHaveCount(0)
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await expect(page.getByRole('button', { name: 'Texto adaptado' })).toHaveAttribute('aria-pressed', 'true')
})

test('PDF: direct adapted opening, readable paragraphs, restore and extracted illustrations', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  const pdfRequests: string[] = []
  page.on('request', request => { if (/\/books\/\d+\/(?:content|pdf\/page-image)(?:\?|$)/.test(request.url())) pdfRequests.push(request.url()) })
  await openBook(page, 'Fidelidade PDF', true)
  // Deny the neighbor before page 2 can prepare it; otherwise a successful
  // cached page 3 correctly survives the later transport failure.
  await page.route('**/pdf/reflow?page=3', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Falha de teste' } }) }))
  await expect(page.locator('.reader-document')).toContainText('INICIO:')
  await expect(page.locator('.reader-document')).toContainText('MEIO:')
  await expect(page.locator('.reader-document')).toContainText('FINAL: capacidade de continuar o paragrafo completo.')
  await expect(page.locator('.reader-document')).toContainText('A mãe aprendeu: atenção, ação e coração.')
  await expect(page.locator('.reader-document img')).toHaveCount(0)
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  expect(pdfRequests).toEqual([])
  await page.screenshot({ path: `test-results/pdf-adapted-text-${test.info().project.name}.png` })
  const stage = page.locator('.reader-stage')
  const scroll = () => stage.evaluate(el => el.scrollTop)
  await page.keyboard.press('PageDown')
  await expect.poll(scroll).toBeGreaterThan(0)
  await expect(page.locator('.reader-document')).toContainText('INICIO:')
  const id = new URL(page.url()).pathname.split('/').pop()
  await expect.poll(async () => (await (await page.request.get('/api/v1/books/' + id + '/progress')).json()).progress.locator.offset).toBeGreaterThan(0)
  const savedScroll = await scroll()
  await page.reload()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => Math.abs(await scroll() - savedScroll)).toBeLessThan(4)
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Aumentar texto', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  await expect.poll(scroll).toBeGreaterThan(0)
  let screens = 0
  while (await stage.evaluate(el => el.scrollTop < el.scrollHeight - el.clientHeight - 2)) {
    await page.keyboard.press('PageDown'); screens++
    expect(screens).toBeLessThan(30)
    await expect(page.locator('.reader-document')).toContainText('INICIO:')
  }
  expect(screens).toBeGreaterThan(0)
  await expect(page.locator('.reader-document p').last()).toBeInViewport()
  await page.keyboard.press('PageDown')
  await expect(page.locator('.reader-document')).toContainText('Pagina com imagem preservada')
  await expect(page.getByAltText('Ilustração da página')).toBeVisible()
  await expect(page.locator('.pdf-canvas')).toHaveCount(0)
  await expect(page.getByAltText('Ilustração da página')).toHaveAttribute('src', /\/pdf\/figure\?page=2&asset=/)
  await expect(page.getByAltText('Conteúdo visual preservado desta página')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/pdf-adapted-figure-' + test.info().project.name + '.png' })
  while (await stage.evaluate(el => el.scrollTop < el.scrollHeight - el.clientHeight - 2)) await page.keyboard.press('PageDown')
  await page.keyboard.press('PageDown')
  await expect(page.locator('.reader-shell')).toContainText('Falha de teste')
  await expect(page.getByRole('navigation', { name: 'Navegação da leitura' })).toContainText('Página 2 de 3')
  await expect(page.getByAltText('Ilustração da página')).toBeVisible()
  await expect.poll(async () => (await (await page.request.get('/api/v1/books/' + id + '/progress')).json()).progress.locator.page).toBe(2)
  await page.unroute('**/pdf/reflow?page=3')
  await page.keyboard.press('PageDown')
  await expect(page.locator('.reader-document')).toContainText('FINAL: capacidade de continuar o paragrafo completo.')
  await expect(stage).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: 'Avançar na leitura' })).toBeEnabled()
  await page.keyboard.press('PageDown')
  await expect.poll(scroll).toBeGreaterThan(0)
  await expect(page.getByRole('navigation', { name: 'Navegação da leitura' })).toContainText('Página 3 de 3')
  while (await stage.evaluate(el => el.scrollTop > 2)) await page.keyboard.press('PageUp')
  await page.keyboard.press('PageUp')
  await expect(page.getByAltText('Ilustração da página')).toBeVisible()
  await expect(page.locator('.reader-document')).not.toContainText('FINAL:')
  await page.setViewportSize({ width: 844, height: 390 })
  await expect.poll(async () => page.locator('.reader-shell').evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(390)
  await expect(page.getByAltText('Ilustração da página')).toBeVisible()
  await expect(stage).toHaveAttribute('aria-busy', 'false')
  const figureBlock = await stage.evaluate(el => {
    const image = el.querySelector('img')!, figure = image.closest('.reader-document__visual')!
    const anchors = [...el.querySelectorAll('[data-reflow-block], .reader-document__visual')]
    el.scrollTop += image.getBoundingClientRect().top - el.getBoundingClientRect().top + image.height * .25
    return anchors.indexOf(figure)
  })
  await expect.poll(async () => (await (await page.request.get('/api/v1/books/' + id + '/progress')).json()).progress.locator).toMatchObject({ page: 2, blockIndex: figureBlock })
  await expect.poll(async () => (await (await page.request.get('/api/v1/books/' + id + '/progress')).json()).progress.locator.offset).toBeCloseTo(.25, 2)
  const figureScroll = await scroll()
  await page.reload()
  await expect(stage).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => Math.abs(await scroll() - figureScroll)).toBeLessThan(4)
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  expect(pdfRequests).toEqual([])
  await page.getByRole('button', { name: 'Documento original', exact: true }).click()
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-page', '2')
  expect(pdfRequests.some(url => url.includes('/content'))).toBe(true)
  expect(pdfRequests.some(url => url.includes('/pdf/page-image'))).toBe(false)
  expect(await page.locator('.pdf-canvas').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * .3), Math.floor(canvas.height * .5), 1, 1).data])).toEqual([194, 123, 144, 255])
  await page.locator('.reader-stage').evaluate(el => { el.scrollTop = 350 })
  await page.screenshot({ path: `test-results/pdf-${test.info().project.name}.png` })
  expect(errors).toEqual([])
})

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

test.describe('progress sync feedback', () => {
test.use({ serviceWorkers: 'block' })
test('automatic progress sync stays silent while pending and after confirmation', async ({ page }) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/books/*/progress', async route => {
    if (route.request().method() === 'PUT') await held
    await route.continue()
  })
  const progressUrl = `/api/v1/books/${new URL(page.url()).pathname.split('/').pop()}/progress`
  const before = (await (await page.request.get(progressUrl)).json()).progress.revision
  const sending = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith('/progress'))
  await page.keyboard.press('ArrowRight')
  const request = await sending
  await expect(page.locator('.reader-sync')).toHaveCount(0)
  const sent = request.postDataJSON()
  release()
  // WebKit service-worker traffic may have no page response event. Verify the
  // committed API state rather than relying on a browser event/object identity.
  await expect.poll(async () => (await (await page.request.get(new URL(request.url()).pathname)).json()).progress.revision).toBeGreaterThan(before)
  await expect.poll(async () => (await (await page.request.get(new URL(request.url()).pathname)).json()).progress.locator).toEqual(sent.locator)
  await expect(page.locator('.reader-sync')).toHaveCount(0)
  await page.getByRole('link', { name: 'Voltar ao livro' }).focus()
  await page.getByRole('link', { name: 'Voltar ao livro' }).click()
  await expect(page.locator('.offline-status')).not.toContainText(/Sincronizando|Sincronizado|aguardando envio/)
})

})

test('Chrome theme color follows system, reading theme and leaving the reader', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/login')
  const color = page.locator('meta[name="theme-color"]')
  await expect(color).toHaveAttribute('content', '#191918')
  await openBook(page, 'A Ilha de Teste')
  await expect(color).toHaveAttribute('content', '#fff')
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  const dialog = page.getByRole('dialog', { name: 'Leitura' })
  for (const [label, value, scheme] of [['Escuro', '#20201e', 'dark'], ['Sépia', '#f4ead6', 'light'], ['Claro', '#fff', 'light']]) {
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await expect(color).toHaveAttribute('content', value)
    await expect(page.locator('html')).toHaveCSS('color-scheme', scheme!)
    await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  }
  await dialog.getByRole('button', { name: 'Fechar painel' }).click()
  await page.getByRole('link', { name: 'Voltar ao livro' }).click()
  await expect(color).toHaveAttribute('content', '#191918')
  await expect(page.locator('html')).not.toHaveAttribute('data-reader-theme')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(color).toHaveAttribute('content', '#f5f4f1')
})

test('reader controls fit narrow screens and dialogs contain keyboard navigation', async ({ page }, info) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  const settings = page.getByRole('button', { name: 'Configurações de leitura' })
  await settings.focus()
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const bounds = await page.locator('.reader-toolbar').evaluate(toolbar => {
      const rect = toolbar.getBoundingClientRect()
      return [...toolbar.querySelectorAll('button,a')].filter(el => el.getBoundingClientRect().width).every(el => {
        const button = el.getBoundingClientRect()
        return button.left >= rect.left && button.right <= rect.right && button.width >= 44
      })
    })
    expect(bounds).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await settings.click()
  const dialog = page.getByRole('dialog', { name: 'Leitura' })
  await expect(dialog).toBeVisible()
  const before = await position(page)
  await page.keyboard.press('ArrowRight')
  expect(await position(page)).toEqual(before)
  await dialog.getByRole('button', { name: 'Alternar tela cheia' }).focus()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.screenshot({ path: `test-results/reader-settings-${info.project.name}.png` })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(settings).toBeFocused()
  await settings.click()
  await page.getByRole('button', { name: 'Buscar no livro', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Buscar no livro' })).toBeVisible()
  await page.keyboard.press('Escape')
  await active(page).locator('body').evaluate(() => { window.focus() })
  await expect(page.locator('.reader-toolbar')).toBeHidden()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Voltar ao livro' })).toBeFocused()
})

test('a real progress conflict still offers the server position', async ({ page }) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  const id = new URL(page.url()).pathname.split('/').pop()
  const endpoint = `/api/v1/books/${id}/progress`
  const before = (await (await page.request.get(endpoint)).json()).progress
  const locator = { type: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/62)', chapterHref: 'chapter-1.xhtml', elementIndex: 30, offset: 0 }
  expect((await page.request.put(endpoint, { data: { format: 'epub', progressRatio: .4, locator, revision: before.revision } })).ok()).toBe(true)
  await page.keyboard.press('ArrowRight')
  const conflict = page.getByRole('alert')
  await expect(conflict).toContainText('Sua posição mudou em outro dispositivo')
  await conflict.getByRole('button', { name: 'Usar posição do servidor' }).click()
  await expect(active(page).locator('.reader-document')).toBeVisible()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect((await (await page.request.get(endpoint)).json()).progress.locator).toMatchObject(locator)
})

test('PDF original and adapted modes use the same themed controls', async ({ page }) => {
  await openBook(page, 'Fidelidade PDF')
  await expect(page.locator('.pdf-canvas').first()).toBeVisible()
  const color = page.locator('meta[name="theme-color"]')
  await expect(color).toHaveAttribute('content', '#121211')
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Texto adaptado', exact: true }).click()
  await expect(page.locator('.reader-document')).toBeVisible()
  await expect(color).toHaveAttribute('content', '#fff')
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Documento original', exact: true }).click()
  await expect(page.locator('.pdf-canvas').first()).toBeVisible()
  await expect(color).toHaveAttribute('content', '#121211')
})

test('EPUB: chapter changes always start at the top and exact repeated highlights survive reloads', async ({ page }) => {
  await openBook(page, 'A Ilha de Teste')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  const id = new URL(page.url()).pathname.split('/').pop()
  const existing = (await (await page.request.get(`/api/v1/books/${id}/highlights`)).json()).highlights
  for (const item of existing) await page.request.delete(`/api/v1/highlights/${item.id}`)
  // Refresh the reader's local highlight list after clearing previous fixtures.
  await page.reload()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  for (const chapter of [2, 1, 2, 1]) {
    await active(page).locator('body').evaluate(() => window.scrollTo(0, 2400))
    await expect.poll(async () => (await position(page)).y).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Abrir sumário' }).click()
    await page.getByRole('dialog').getByRole('button', { name: `Capítulo ${chapter}`, exact: true }).click()
    await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
    await expect.poll(async () => (await position(page)).y).toBe(0)
    expect(await page.locator('.reader-stage').evaluate(el => el.scrollTop)).toBe(0)
  }
  await active(page).locator('body').evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.reader-progress')).toHaveAttribute('aria-label', 'Capítulo 2 de 2')
  await expect.poll(async () => (await position(page)).y).toBe(0)
  await page.getByRole('button', { name: 'Abrir sumário' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Capítulo 1', exact: true }).click()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  // A backward selection of the second occurrence in the SAME text node.
  await active(page).locator('#repeated-1').evaluate(el => {
    const node = el.firstChild!, start = node.textContent!.indexOf('Eunice', 6)
    window.getSelection()!.setBaseAndExtent(node, start + 6, node, start)
  })
  await expect(page.getByRole('toolbar', { name: 'Ações do trecho selecionado' })).toBeVisible()
  await page.getByRole('button', { name: 'Destacar', exact: true }).click()
  await expect(active(page).locator('#repeated-1 mark')).toHaveText('Eunice')
  const placement = () => active(page).locator('#repeated-1').evaluate(el => [...el.childNodes].map(node => node.nodeType === 1 ? `<mark>${node.textContent}</mark>` : node.textContent).join(''))
  await expect.poll(placement).toBe('Eunice chegou. <mark>Eunice</mark> ficou. Eunice saiu.')
  await expect.poll(async () => (await (await page.request.get(`/api/v1/books/${id}/highlights`)).json()).highlights.length).toBe(1)
  const saved = (await (await page.request.get(`/api/v1/books/${id}/highlights`)).json()).highlights
  expect(saved[0].locator.textAnchor).toMatchObject({ version: 1, scope: 'epub', exact: 'Eunice' })
  await page.reload()
  await expect.poll(placement).toBe('Eunice chegou. <mark>Eunice</mark> ficou. Eunice saiu.')
  // Split over nested inline nodes, after a mark already split another text node.
  await active(page).locator('#nested-1 em').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
  })
  await page.getByRole('button', { name: 'Destacar', exact: true }).click()
  await expect(active(page).locator('#nested-1 em mark')).toHaveCount(2)
  expect(await active(page).locator('#nested-1 > mark').count()).toBe(0)
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Sépia', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  await expect.poll(placement).toBe('Eunice chegou. <mark>Eunice</mark> ficou. Eunice saiu.')
  await expect(active(page).locator('#nested-1 em mark')).toHaveCount(2)
})

test('EPUB: viewport pages, chapter navigation, rotation and saved mode retain text position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openBook(page, 'A Ilha de Teste')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  const id = new URL(page.url()).pathname.split('/').pop()
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Páginas pela tela', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  const metrics = () => active(page).locator('.reader-pages').evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop, width: el.clientWidth, height: el.clientHeight, scrollHeight: el.scrollHeight, total: Math.ceil((el.scrollWidth - 1) / el.clientWidth) }))
  await expect(active(page).locator('.reader-pages')).toBeVisible()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  expect((await metrics()).total).toBeGreaterThan(10)
  expect((await metrics()).width).toBe(390)
  for (let turn = 0; turn < 5; turn++) {
    const before = await metrics()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await metrics()).x).toBe(before.x + before.width)
    expect((await metrics()).scrollHeight).toBeLessThanOrEqual((await metrics()).height + 1)
    expect((await metrics()).y).toBe(0)
    expect((await position(page)).y).toBe(0)
  }
  await expect(page.locator('.reader-progress')).toHaveAttribute('aria-label', /Capítulo 1 de 2 · Página 6 de/)
  await expect.poll(async () => (await (await page.request.get(`/api/v1/settings`)).json()).preferences.epubFlow).toBe('paginated')
  await expect.poll(async () => (await (await page.request.get(`/api/v1/books/${id}/progress`)).json()).progress.locator.textOffset).toBeGreaterThan(100)
  const saved = (await (await page.request.get(`/api/v1/books/${id}/progress`)).json()).progress.locator
  await page.reload()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => (await metrics()).x).toBe((await metrics()).width * 5)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => (await metrics()).x).toBeGreaterThan(0)
  // Re-layout must keep the same passage visible rather than reverting to chapter start.
  const delta = await active(page).locator('.reader-document').evaluate((root, offset) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node: Node | null, remaining = offset
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('style,script')) continue
      if (remaining < node.textContent!.length) { const range = document.createRange(); range.setStart(node, remaining); range.setEnd(node, remaining + 1); return range.getBoundingClientRect().left }
      remaining -= node.textContent!.length
    }
    return -999
  }, saved.textOffset)
  expect(delta).toBeGreaterThanOrEqual(0); expect(delta).toBeLessThan(844)
  await page.getByRole('button', { name: 'Abrir sumário' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Capítulo 2', exact: true }).click()
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(async () => (await metrics()).x).toBe(0)
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.reader-progress')).toHaveAttribute('aria-label', /Capítulo 1 de 2/)
  await expect.poll(async () => (await metrics()).x).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Configurações de leitura' }).click()
  await page.getByRole('button', { name: 'Rolagem por capítulo', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel' }).click()
  await expect(active(page).locator('.reader-pages')).toHaveCount(0)
  await expect.poll(async () => (await position(page)).y).toBeGreaterThan(0)
})

import { test, expect, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Usuário', { exact: true }).fill('admin')
  await page.getByLabel('Senha', { exact: true }).fill('test-password-strong-123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL('/')
  await page.request.put('/api/v1/settings', { data: { theme: 'light', fontScale: 100, lineHeight: 'normal', margins: 'normal', appTheme: 'system', reducedMotion: false, pdfInvert: false, epubFlow: 'scroll' } })
}
const active = (page: Page) => page.frameLocator('.epub-stage:not(.epub-stage--preparing)')
const ready = (page: Page) => expect(page.locator('.reader-stage')).toHaveAttribute('aria-busy', 'false')

test.describe('mobile navigation and reader preparation', () => {
  test.use({ serviceWorkers: 'block' })

  test('solid bar moves its selection, More traps focus, desktop and reader keep their own shells', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    const bar = page.getByRole('navigation', { name: 'Navegação inferior', exact: true })
    await expect(bar).toBeVisible()
    expect(await bar.locator('a,button').allTextContents()).toEqual(['Favoritos', 'Biblioteca', 'Início', 'Busca', 'Outros'])
    await expect(bar.getByRole('link', { name: 'Início', exact: true })).toHaveAttribute('aria-current', 'page')
    const before = await bar.locator('.mobile-navigation__selection').evaluate(el => getComputedStyle(el).transform)
    await bar.getByRole('link', { name: 'Favoritos', exact: true }).click()
    await expect(bar.getByRole('link', { name: 'Favoritos', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect.poll(() => bar.locator('.mobile-navigation__selection').evaluate(el => getComputedStyle(el).transform)).not.toBe(before)
    expect(await bar.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none')
    await bar.getByRole('button', { name: 'Outros', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Outros', exact: true })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('link')).toHaveText(['Autores', 'Séries', 'Gêneros', 'Configurações'])
    await sheet.getByRole('button', { name: 'Sair', exact: true }).focus()
    await page.keyboard.press('Tab')
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(sheet).not.toBeVisible()
    await expect(bar.getByRole('button', { name: 'Outros', exact: true })).toBeFocused()
    await bar.getByRole('button', { name: 'Outros', exact: true }).click()
    await sheet.getByRole('link', { name: 'Configurações', exact: true }).click()
    await expect(bar.getByRole('button', { name: 'Outros', exact: true })).toHaveAttribute('aria-current', 'page')
    await bar.getByRole('button', { name: 'Outros', exact: true }).click()
    await expect(sheet.getByRole('link', { name: 'Configurações', exact: true })).toHaveAttribute('aria-current', 'page')
    await sheet.getByRole('button', { name: 'Administração', exact: true }).click()
    const administration = page.getByRole('dialog', { name: 'Administração', exact: true })
    await expect(administration).toBeVisible()
    await expect(administration.getByRole('link')).toHaveText(['Visão geral', 'Bibliotecas', 'Usuários', 'Metadata', 'Jobs', 'Compatibilidade', 'Sistema'])
    await administration.getByRole('link', { name: 'Visão geral', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await expect(bar.getByRole('button', { name: 'Outros', exact: true })).toHaveAttribute('aria-current', 'page')
    await bar.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByRole('link', { name: 'A Ilha de Teste', exact: true }).click()
    await page.getByRole('link', { name: /Começar leitura|Continuar leitura/ }).click()
    await ready(page)
    await expect(bar).toHaveCount(0)
    await page.getByRole('link', { name: 'Voltar ao livro', exact: true }).click()
    await page.setViewportSize({ width: 320, height: 740 })
    expect(await bar.evaluate(el => [...el.querySelectorAll('a,button')].every(item => item.getBoundingClientRect().width >= 44))).toBe(true)
    await page.screenshot({ path: `test-results/mobile-bar-${info.project.name}.png` })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(bar).not.toBeVisible()
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await bar.locator('.mobile-navigation__selection').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.001)
  })

  test('EPUB preloads the next chapter once and slides screens in both directions without fade', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    const books = (await (await page.request.get('/api/v1/books?limit=100')).json()).books
    const book = books.find((item: any) => item.title === 'A Ilha de Teste')
    await page.request.put(`/api/v1/books/${book.id}/progress`, { data: { format: 'epub', progressRatio: 0, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2)', chapterHref: 'chapter-1.xhtml', elementIndex: 0, offset: 0 } } })
    let nextRequests = 0
    page.on('request', request => { if (request.url().includes('/epub/chapter?') && request.url().includes('chapter-2')) nextRequests++ })
    await page.goto(`/read/${book.id}`)
    await ready(page)
    await expect.poll(() => nextRequests).toBe(1)
    await page.getByRole('button', { name: 'Abrir sumário' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Capítulo 2', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await ready(page)
    await expect(active(page).locator('h1')).toHaveText('Travessia')
    expect(nextRequests).toBe(1)
    await page.getByRole('button', { name: 'Configurações de leitura' }).click()
    await page.getByRole('button', { name: 'Páginas pela tela', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar painel', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await ready(page)
    for (const key of ['ArrowRight', 'ArrowLeft']) {
      const native = await page.evaluate(() => typeof document.startViewTransition === 'function')
      if (native) await page.evaluate(() => {
        const start = document.startViewTransition.bind(document)
        document.startViewTransition = update => {
          document.startViewTransition = start
          const transition = start(update)
          void transition.ready.then(() => {
            for (const animation of document.getAnimations()) if (['reader-in', 'reader-out'].includes((animation as CSSAnimation).animationName)) { animation.pause(); animation.currentTime = 120 }
          })
          return transition
        }
      })
      await page.keyboard.press(key)
      if (native) {
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => ['reader-in', 'reader-out'].includes((animation as CSSAnimation).animationName) && animation.playState === 'paused').length)).toBe(2)
        const result = await page.evaluate(() => {
          const animations = document.getAnimations().filter(animation => ['reader-in', 'reader-out'].includes((animation as CSSAnimation).animationName))
          return { durations: animations.map(animation => animation.effect!.getTiming().duration), names: animations.map(animation => (animation as CSSAnimation).animationName).sort(), frames: animations.map(animation => (animation.effect as KeyframeEffect).getKeyframes()), direction: document.documentElement.style.getPropertyValue('--reader-direction'), live: getComputedStyle(document.querySelector('.epub-stage:not(.epub-stage--preparing)')!).transform, width: document.querySelector('.reader-stage')!.scrollWidth }
        })
        expect(result.names).toEqual(['reader-in', 'reader-out'])
        expect(result.durations).toEqual([240, 240]); expect(result.live).toBe('none'); expect(result.width).toBe(390)
        expect(result.direction).toBe(key === 'ArrowRight' ? '1' : '-1')
        for (const frames of result.frames) expect(frames.every(frame => frame.opacity === undefined || frame.opacity === '1')).toBe(true)
        await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()))
        await expect(page.locator('html')).not.toHaveAttribute('data-reader-turn')
      }
    }
    await active(page).locator('.reader-document').evaluate(el => {
      const doc = el.ownerDocument, target = el.querySelector('p')!
      for (const [type, x] of [['pointerdown', 300], ['pointermove', 180], ['pointerup', 80]] as const) target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: 300, button: 0 }))
      doc.defaultView?.focus()
    })
    await expect.poll(() => active(page).locator('.reader-pages').evaluate(el => el.scrollLeft)).toBe(390)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.reader-presentation')).toHaveCount(0)
  })

  test('PDF pre-renders a neighboring canvas and reuses it when advancing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      const original = document.createElement.bind(document), canvases: HTMLCanvasElement[] = []
      ;(window as any).__preparedCanvases = canvases
      document.createElement = ((...args: Parameters<typeof document.createElement>) => { const el = original(...args); if (args[0] === 'canvas') canvases.push(el as HTMLCanvasElement); return el }) as typeof document.createElement
    })
    await signIn(page)
    const books = (await (await page.request.get('/api/v1/books?limit=100')).json()).books
    const book = books.find((item: any) => item.title === 'Fidelidade PDF') ?? books.find((item: any) => item.title === 'Caderno PDF')
    await page.request.put(`/api/v1/books/${book.id}/progress`, { data: { format: 'pdf', progressRatio: 0, locator: { type: 'pdf-page', page: 1 } } })
    await page.goto(`/read/${book.id}?mode=pdf`)
    await expect(page.locator('.pdf-page')).toHaveAttribute('data-page', '1')
    await expect.poll(() => page.evaluate(() => (window as any).__preparedCanvases.some((canvas: HTMLCanvasElement) => canvas.getAttribute('aria-label') === 'Página 2 do PDF' && canvas.width > 0 && !canvas.isConnected))).toBe(true)
    await page.evaluate(() => { (window as any).__neighborCanvas = (window as any).__preparedCanvases.find((canvas: HTMLCanvasElement) => canvas.getAttribute('aria-label') === 'Página 2 do PDF' && canvas.width > 0 && !canvas.isConnected) })
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.pdf-page')).toHaveAttribute('data-page', '2')
    expect(await page.locator('.pdf-page canvas').evaluate(canvas => canvas === (window as any).__neighborCanvas)).toBe(true)
  })
  test('adapted PDF prepares the following page without opening the original PDF', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    const books = (await (await page.request.get('/api/v1/books?limit=100')).json()).books
    const book = books.find((item: any) => item.title === 'Fidelidade PDF')
    await page.request.put(`/api/v1/books/${book.id}/progress`, { data: { format: 'pdf', progressRatio: 0, locator: { type: 'pdf-reflow', page: 1 } } })
    let nextRequests = 0, binaryRequests = 0
    page.on('request', request => {
      if (request.url().includes('/pdf/reflow?page=2')) nextRequests++
      if (request.url().includes(`/books/${book.id}/content`)) binaryRequests++
    })
    await page.goto(`/read/${book.id}?mode=epub`)
    await ready(page)
    await expect.poll(() => nextRequests).toBe(1)
    await page.locator('.reader-stage').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(page.locator('.reader-document p').last()).toBeInViewport()
    await page.keyboard.press('ArrowRight')
    await ready(page)
    await expect(page.locator('.reader-progress')).toHaveAttribute('aria-label', 'Página 2 de 3')
    expect(nextRequests).toBe(1)
    expect(binaryRequests).toBe(0)
  })

  test('reading remains usable without optional presentation APIs', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: undefined })
      Object.defineProperty(Element.prototype, 'attachShadow', { configurable: true, value: undefined })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page)
    const books = (await (await page.request.get('/api/v1/books?limit=100')).json()).books
    const epub = books.find((item: any) => item.title === 'A Ilha de Teste')
    const pdf = books.find((item: any) => item.title === 'Fidelidade PDF')
    await page.request.put(`/api/v1/books/${epub.id}/progress`, { data: { format: 'epub', progressRatio: 0, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2!/4/2)', chapterHref: 'chapter-1.xhtml', elementIndex: 0, offset: 0 } } })
    await page.goto(`/read/${epub.id}`)
    await ready(page)
    await page.keyboard.press('PageDown')
    await expect.poll(() => active(page).locator('body').evaluate(el => el.ownerDocument.defaultView!.scrollY)).toBeGreaterThan(0)
    await expect(page.locator('.reader-presentation')).toHaveCount(0)
    await page.request.put(`/api/v1/books/${pdf.id}/progress`, { data: { format: 'pdf', progressRatio: 0, locator: { type: 'pdf-reflow', page: 1 } } })
    await page.goto(`/read/${pdf.id}?mode=epub`)
    await ready(page)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => page.locator('.reader-stage').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    await expect(page.locator('.reader-presentation')).toHaveCount(0)
  })

})

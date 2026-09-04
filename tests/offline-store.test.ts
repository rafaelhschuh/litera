import fs from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test'
import ts from 'typescript'

// Real browser IndexedDB/Blob/transactions, without a server or application build.
// Run either engine explicitly: LITERA_STORAGE_BROWSER=webkit npm test -- tests/offline-store.test.ts
const engine = process.env.LITERA_STORAGE_BROWSER === 'webkit' ? webkit : chromium
const origin = 'http://127.0.0.1'
const modules = new Map<string, string>()
for (const name of ['offline-store', 'offline-context', 'pwa']) {
  const source = fs.readFileSync(new URL(`../src/web/lib/${name}.ts`, import.meta.url), 'utf8')
  modules.set(`/${name}.js`, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll("from 'vue'", "from '/vue.js'").replaceAll("from '../../shared/epub-document'", "from '/shared/epub-document.js'").replace(/from '\.\/([^']+)'/g, "from '/$1.js'"))
}
modules.set('/shared/epub-document.js', ts.transpileModule(fs.readFileSync(new URL('../src/shared/epub-document.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
modules.set('/vue.js', fs.readFileSync(new URL('../node_modules/vue/dist/vue.runtime.esm-browser.js', import.meta.url), 'utf8'))
modules.set('/pwa-shell.js', `export const offlineSupport={available:true,message:''};export const pwaInstall={};export const pwaUpdate={};export async function ensureOfflineShell(){if(window.failShell)throw Error('Shell indisponível');if(window.waitShell){window.shellStarted=true;await new Promise(resolve=>window.finishShell=resolve);window.shellFinished=true}};export function initializePwa(){};export function installPwa(){};export function applyPwaUpdate(){}`)

describe(`offline storage in ${engine.name()}`, () => {
  let browser: Browser, context: BrowserContext, page: Page
  beforeAll(async () => { browser = await engine.launch(engine === webkit && process.env.LITERA_WEBKIT_EXECUTABLE ? { executablePath: process.env.LITERA_WEBKIT_EXECUTABLE } : {}) })
  afterAll(async () => { await browser?.close() })
  beforeEach(async () => {
    context = await browser.newContext()
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (modules.has(url.pathname)) { await route.fulfill({ contentType: 'text/javascript', body: modules.get(url.pathname)! }); return }
      if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage test</title>' }); return }
      const book = { id: 1, title: 'Offline', format: 'pdf', fileRevision: 'r1', fileSize: 30, hasCover: true }
      const data: Record<string, unknown> = {
        '/api/v1/books/1': { book }, '/api/v1/settings': { preferences: {} }, '/api/v1/books/1/progress': { progress: { revision: 3 } }, '/api/v1/books/1/highlights': { highlights: [] },
      }
      if (url.pathname.endsWith('/pdf/reflow')) {
        await route.fulfill({ json: { page: Number(url.searchParams.get('page')), pageCount: 2, blocks: [{ spans: [{ text: 'Hello', fontAsset: 'font-ab12.ttf' }] }], figures: [{ asset: `${url.searchParams.get('page')}-1.png` }] } }); return
      }
      if (url.pathname.endsWith('/content')) { await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7\nminimal fixture\n%%EOF' }); return }
      if (url.pathname.endsWith('/cover') || url.pathname.endsWith('/pdf/figure')) { await route.fulfill({ contentType: 'application/octet-stream', body: 'asset' }); return }
      if (data[url.pathname]) { await route.fulfill({ json: data[url.pathname] }); return }
      await route.fulfill({ status: 404, body: 'Not found' })
    })
    page = await context.newPage()
    await load(page)
  })
  afterEach(async () => { await context?.close() })

  async function load(target: Page) {
    await target.goto(origin)
    await target.evaluate(async () => {
      const scope = window as any
      scope.store = await new Function('return import("/offline-store.js")')()
      scope.pwa = await new Function('return import("/pwa.js")')()
      scope.context = await new Function('return import("/offline-context.js")')()
      scope.publish = async (userId = 1, bookId = 1, body = 'old') => {
        const stage = await scope.store.beginOfflineDownload(userId, bookId)
        const base = `/api/v1/books/${bookId}`
        const required = [base + '/content', base + '/progress']
        await scope.store.putOfflineResource(stage, required[0], new Blob([body]))
        await scope.store.putOfflineResource(stage, required[1], new Blob(['{"progress":{"revision":3}}'], { type: 'application/json' }))
        const book = { ...stage, format: 'pdf', metadata: { title: body }, revision: body, downloadedAt: new Date().toISOString(), bytes: body.length }
        await scope.store.commitOfflineDownload(stage, book, required)
        return book
      }
    })
  }

  it('hides staging and publishes only after all required resources are persisted', async () => {
    const result = await page.evaluate(async () => {
      const s = (window as any).store, stage = await s.beginOfflineDownload(1, 1)
      await s.putOfflineResource(stage, '/api/v1/books/1/content', new Blob(['binary']))
      const before = await s.getOfflineBook(1, 1)
      const hidden = await s.getOfflineResource(1, 1, '/api/v1/books/1/content', stage.generation)
      let rejected = false
      try { await s.commitOfflineDownload(stage, { ...stage, format: 'pdf', bytes: 6 }, ['/api/v1/books/1/content', '/api/v1/books/1/cover']) } catch { rejected = true }
      await s.discardOfflineDownload(stage)
      const book = await (window as any).publish()
      return { before, hidden: Boolean(hidden), rejected, generation: (await s.getOfflineBook(1, 1)).generation === book.generation, text: await (await s.getOfflineResource(1, 1, '/api/v1/books/1/content')).text() }
    })
    expect(result).toEqual({ before: undefined, hidden: false, rejected: true, generation: true, text: 'old' })
  })

  it('preserves an old download after interrupted update and keeps captured generations readable', async () => {
    expect(await page.evaluate(async () => {
      const scope = window as any, s = scope.store, old = await scope.publish()
      const stage = await s.beginOfflineDownload(1, 1)
      await s.putOfflineResource(stage, '/api/v1/books/1/content', new Blob(['partial']))
      await s.discardOfflineDownload(stage)
      const interrupted = (await s.getOfflineBook(1, 1)).generation === old.generation
      await scope.publish(1, 1, 'new')
      await s.discardOfflineDownload(old)
      await s.cleanupOfflineOrphans()
      return { interrupted, old: await (await s.getOfflineResource(1, 1, '/api/v1/books/1/content', old.generation)).text(), current: await (await s.getOfflineResource(1, 1, '/api/v1/books/1/content')).text() }
    })).toEqual({ interrupted: true, old: 'old', current: 'new' })
  })

  it('preserves captured reader generations across tabs and reclaims them on explicit removal', async () => {
    const old = await page.evaluate(async () => { const w = window as any; const old = await w.publish(); await w.publish(1, 1, 'new'); return old.generation })
    const other = await context.newPage(); await load(other)
    expect(await other.evaluate(async generation => { const s = (window as any).store; return (await s.getOfflineResource(1, 1, '/api/v1/books/1/content', generation))?.text() }, old)).toBe('old')
    await page.close(); await other.close()
    page = await context.newPage(); await load(page)
    const result = await page.evaluate(async generation => {
      const s = (window as any).store
      const value = { old: Boolean(await s.getOfflineResource(1, 1, '/api/v1/books/1/content', generation)), current: await (await s.getOfflineResource(1, 1, '/api/v1/books/1/content')).text() }
      await s.removeOfflineBook(1, 1)
      return { ...value, removed: !await s.getOfflineResource(1, 1, '/api/v1/books/1/content', generation) }
    }, old)
    expect(result).toEqual({ old: true, current: 'new', removed: true })
  })

  it('isolates users and removes binaries without losing personal snapshots', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any, s = w.store
      await w.publish(1); await w.publish(2, 1, 'other')
      await s.removeOfflineBook(1, 1)
      return { books: (await s.listOfflineBooks(1)).length, binary: Boolean(await s.getOfflineResource(1, 1, '/api/v1/books/1/content')), snapshot: JSON.parse(await (await s.getOfflineResource(1, 1, '/api/v1/books/1/progress')).text()).progress.revision, other: await (await s.getOfflineResource(2, 1, '/api/v1/books/1/content')).text() }
    })).toEqual({ books: 0, binary: false, snapshot: 3, other: 'other' })
  })

  it('invalidates in-flight writes and commits on logout, without clearing another account', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any, s = w.store
      await w.publish(1); await w.publish(2)
      const stage = await s.beginOfflineDownload(1, 2)
      await s.clearOfflineUser(1)
      let rejected = false
      try { await s.putOfflineResource(stage, '/api/v1/books/2/content', new Blob(['late'])) } catch { rejected = true }
      return { rejected, own: (await s.listOfflineBooks(1)).length, other: (await s.listOfflineBooks(2)).length, progress: Boolean(await s.getOfflineResource(1, 1, '/api/v1/books/1/progress')) }
    })).toEqual({ rejected: true, own: 0, other: 1, progress: false })
  })

  it('serializes concurrent downloads and refuses stale session publication', async () => {
    expect(await page.evaluate(async () => {
      const s = (window as any).store, stage = await s.beginOfflineDownload(1, 1)
      let busy = false, stale = false
      try { await s.beginOfflineDownload(1, 1) } catch { busy = true }
      await s.putOfflineResource(stage, '/api/v1/books/1/content', new Blob(['binary']))
      try { await s.commitOfflineDownload(stage, { ...stage, format: 'pdf' }, ['/api/v1/books/1/content'], () => false) } catch { stale = true }
      return { busy, stale, published: Boolean(await s.getOfflineBook(1, 1)) }
    })).toEqual({ busy: true, stale: true, published: false })
  })

  it('cleans expired staging, but keeps live downloads', async () => {
    expect(await page.evaluate(async () => {
      const s = (window as any).store
      const old = await s.beginOfflineDownload(1, 1), live = await s.beginOfflineDownload(1, 2)
      await s.putOfflineResource(old, '/api/v1/books/1/content', new Blob(['orphan']))
      await s.putOfflineResource(live, '/api/v1/books/2/content', new Blob(['active']))
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('litera-offline-books'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('stages', 'readwrite'); tx.objectStore('stages').put({ ...old, expiresAt: 0 }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error) })
      await s.cleanupOfflineOrphans()
      const count = await new Promise<number>(resolve => { const r = db.transaction('resources').objectStore('resources').count(); r.onsuccess = () => resolve(r.result) })
      db.close()
      await s.renewOfflineDownload(live)
      return count
    })).toBe(1)
  })

  it('normalizes only appearance and server-ignored parameters', async () => {
    expect(await page.evaluate(() => {
      const s = (window as any).store
      return [s.normalizeOfflineUrl('/api/v1/books/2/epub/chapter?theme=dark&href=one.xhtml&scale=120#line'), s.normalizeOfflineUrl('/api/v1/books/2/pdf/figure?page=2&asset=font-ab.ttf')]
    })).toEqual(['/api/v1/books/2/epub/chapter?href=one.xhtml', '/api/v1/books/2/pdf/figure?asset=font-ab.ttf'])
  })

  it('falls back from rejected Blob serialization to ArrayBuffer and restores MIME after reload', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any, original = IDBObjectStore.prototype.put
      let rejectedBlobs = 0
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
        if (this.name === 'resources' && args[0]?.blob instanceof Blob) {
          rejectedBlobs++
          throw new DOMException('Cannot prepare Blob', 'UnknownError')
        }
        return original.apply(this, args)
      }
      await w.publish()
      IDBObjectStore.prototype.put = original
      return rejectedBlobs
    })).toBe(1)
    await page.reload()
    await load(page)
    expect(await page.evaluate(async () => {
      const s = (window as any).store
      const binary = await s.getOfflineResource(1, 1, '/api/v1/books/1/content')
      await s.removeOfflineBook(1, 1)
      const snapshot = await s.getOfflineResource(1, 1, '/api/v1/books/1/progress')
      return { blob: binary instanceof Blob, text: await binary.text(), mime: snapshot.type, revision: JSON.parse(await snapshot.text()).progress.revision }
    })).toEqual({ blob: true, text: 'old', mime: 'application/json', revision: 3 })
  })

  it('retains v1 data and offers exact/canonical fallback without claiming a complete new package', async () => {
    expect(await page.evaluate(async () => {
      const s = (window as any).store, cache = await caches.open('litera-books-u1-b1-v1')
      await cache.put('/_litera/offline/books/1', new Response('{}'))
      await cache.put('/api/v1/books/1/epub/chapter?href=c.xhtml&theme=dark&scale=120', new Response('legacy'))
      return { old: await (await s.getOfflineResource(1, 1, '/api/v1/books/1/epub/chapter?href=c.xhtml')).text(), retained: (await caches.keys()).includes('litera-books-u1-b1-v1'), listed: (await s.listOfflineBooks(1)).length }
    })).toEqual({ old: 'legacy', retained: true, listed: 0 })
  })

  it('downloads complete PDF, reflow, deduplicated fonts and snapshots, emitting inventory updates', async () => {
    const requests: Array<{ url: string; user?: string }> = []
    page.on('request', req => { if (req.url().includes('/api/')) requests.push({ url: req.url(), user: req.headers()['x-litera-user'] }) })
    const result = await page.evaluate(async () => {
      const w = window as any, progress: any[] = []; let events = 0
      window.addEventListener('litera-downloads-changed', () => events++)
      w.pwa.setActiveOfflineUser(1)
      await w.pwa.saveBookOffline(1, 'pdf', (value: any) => progress.push(value))
      const book = await w.store.getOfflineBook(1, 1)
      const font = await w.store.getOfflineResource(1, 1, '/api/v1/books/1/pdf/figure?page=2&asset=font-ab12.ttf')
      const state = { ...w.pwa.downloadStates[1] }
      await w.pwa.removeBookOffline(1)
      return { state: state.status, bytes: book.bytes > 0, font: await font.text(), events, progress: progress.some(p => p.total > 0 && p.completed === p.total), removed: w.pwa.downloadStates[1].status }
    })
    expect(result).toEqual({ state: 'downloaded', bytes: true, font: 'asset', events: 2, progress: true, removed: 'not-downloaded' })
    expect(requests.every(req => req.user === '1')).toBe(true)
    expect(requests.filter(req => req.url.includes('font-ab12.ttf'))).toHaveLength(1)
    expect(requests.filter(req => req.url.includes('/pdf/reflow'))).toHaveLength(2)
  })

  it('downloads canonical EPUB chapters, nested CSS, fonts and images without the raw archive', async () => {
    const base = '/api/v1/books/1', chapter = 'Text/chapter.xhtml'
    const resource = (src: string) => `${base}/epub/asset?chapter=${encodeURIComponent(chapter)}&src=${encodeURIComponent(src)}`
    const imageUrl = resource('../Images/image.png'), cssUrl = resource('../Styles/main.css'), fontUrl = resource('../Fonts/book.woff2'), nestedUrl = resource('../Styles/nested.css')
    const requests: string[] = []
    page.on('request', req => requests.push(req.url()))
    await page.route('**/api/v1/books/1', route => route.fulfill({ json: { book: { id: 1, format: 'epub', fileRevision: 'e1', fileSize: 100, hasCover: true } } }))
    await page.route('**/epub/manifest', route => route.fulfill({ json: { chapters: [{ href: chapter }] } }))
    await page.route('**/epub/chapter?*', route => route.fulfill({ contentType: 'text/html', body: `<html><head><link rel="stylesheet" href="${cssUrl}"></head><body><img src="${imageUrl}"></body></html>` }))
    await page.route('**/epub/asset?*', route => {
      const src = new URL(route.request().url()).searchParams.get('src')
      if (src === '../Styles/main.css') return route.fulfill({ contentType: 'text/css', body: `@import "${nestedUrl}";@font-face{font-family:Book;src:url("${fontUrl}")}` })
      if (src === '../Styles/nested.css') return route.fulfill({ contentType: 'text/css', body: `.chapter{background-image:url("${imageUrl}")}` })
      return route.fulfill({ contentType: 'application/octet-stream', body: src === '../Fonts/book.woff2' ? 'font' : 'image' })
    })
    expect(await page.evaluate(async ({ fontUrl, imageUrl }) => {
      const w = window as any; w.pwa.setActiveOfflineUser(1); await w.pwa.saveBookOffline(1, 'epub')
      return { state: w.pwa.downloadStates[1].status, chapter: Boolean(await w.store.getOfflineResource(1, 1, '/api/v1/books/1/epub/chapter?href=Text%2Fchapter.xhtml&scale=120&theme=dark')), font: await (await w.store.getOfflineResource(1, 1, fontUrl)).text(), image: await (await w.store.getOfflineResource(1, 1, imageUrl)).text() }
    }, { fontUrl, imageUrl })).toEqual({ state: 'downloaded', chapter: true, font: 'font', image: 'image' })
    expect(requests.some(url => url.endsWith('/content'))).toBe(false)
    expect(requests.filter(url => new URL(url).searchParams.get('src') === '../Images/image.png')).toHaveLength(1)
  })

  it('does not publish when a mandatory cover is missing or IndexedDB rejects a resource', async () => {
    await page.route('**/api/v1/books/1/cover', route => route.fulfill({ status: 404, body: 'missing' }))
    expect(await page.evaluate(async () => {
      const w = window as any; w.pwa.setActiveOfflineUser(1)
      let missing = ''
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch (error) { missing = String(error) }
      const original = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
        if (this.name === 'resources') throw new DOMException('No space', 'QuotaExceededError')
        return original.apply(this, args)
      }
      let quota = ''
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch (error) { quota = String(error) }
      IDBObjectStore.prototype.put = original
      return { missing, quota, books: (await w.store.listOfflineBooks(1)).length }
    })).toMatchObject({ missing: expect.stringContaining('disponível'), quota: expect.stringContaining('espaço'), books: 0 })
  })

  it('supports missing Content-Length with indeterminate progress', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any; w.pwa.setActiveOfflineUser(1)
      const original = window.fetch, progress: any[] = []
      window.fetch = async (url, options) => String(url).endsWith('/content') ? new Response('%PDF-1.7\n%%EOF', { headers: { 'Content-Type': 'application/pdf' } }) : original(url, options)
      await w.pwa.saveBookOffline(1, 'pdf', (value: any) => progress.push(value))
      return { status: w.pwa.downloadStates[1].status, indeterminate: progress.some(value => value.label === 'Baixando PDF…' && value.completed > 0 && value.total === 0) }
    })).toEqual({ status: 'downloaded', indeterminate: true })
  })

  it('preserves old content when a server revision changes during update', async () => {
    let revision = 0
    await page.route('**/api/v1/books/1', route => route.fulfill({ json: { book: { id: 1, format: 'pdf', fileRevision: `r${++revision}`, fileSize: 30 } } }))
    expect(await page.evaluate(async () => {
      const w = window as any; await w.publish(); w.pwa.setActiveOfflineUser(1)
      let error = ''
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch (reason) { error = String(reason) }
      return { error, state: w.pwa.downloadStates[1].status, old: await (await w.store.getOfflineResource(1, 1, '/api/v1/books/1/content')).text() }
    })).toMatchObject({ error: expect.stringContaining('mudou'), state: 'error', old: 'old' })
  })

  it('reports insufficient quota before downloading the binary', async () => {
    let binaryRequests = 0
    page.on('request', req => { if (req.url().endsWith('/content')) binaryRequests++ })
    expect(await page.evaluate(async () => {
      const w = window as any; w.pwa.setActiveOfflineUser(1)
      Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ quota: 10, usage: 5 }) } })
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch { /* Expected quota failure. */ }
      return { error: w.pwa.downloadStates[1].error, book: Boolean(await w.store.getOfflineBook(1, 1)) }
    })).toMatchObject({ error: expect.stringContaining('espaço'), book: false })
    expect(binaryRequests).toBe(0)
  })

  it('rejects truncation and a failed shell barrier without publishing', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any; w.pwa.setActiveOfflineUser(1)
      const original = window.fetch
      window.fetch = async (url, options) => String(url).endsWith('/content') ? new Response('%PDF-1.7\n%%EOF', { headers: { 'Content-Length': '1000' } }) : original(url, options)
      let truncated = ''
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch (error) { truncated = String(error) }
      w.failShell = true
      let shell = ''
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch (error) { shell = String(error) }
      return { truncated, shell, books: (await w.store.listOfflineBooks(1)).length }
    })).toMatchObject({ truncated: expect.stringContaining('incompleto'), shell: expect.stringContaining('Shell'), books: 0 })
  })

  it('cancels a download on user request and account change', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any; w.pwa.setActiveOfflineUser(1)
      const original = window.fetch
      window.fetch = async (url, options) => {
        if (!String(url).endsWith('/content')) return original(url, options)
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')))
          setTimeout(() => w.pwa.cancelBookDownload(1), 10)
        })
      }
      try { await w.pwa.saveBookOffline(1, 'pdf') } catch { /* Expected cancellation. */ }
      const cancelled = w.pwa.downloadStates[1].status
      const saving = w.pwa.saveBookOffline(1, 'pdf'); w.context.setOfflineContext(2)
      await saving.catch(() => undefined)
      return { cancelled, own: (await w.store.listOfflineBooks(1)).length, other: (await w.store.listOfflineBooks(2)).length, stateLeaked: Boolean(w.pwa.downloadStates[1]) }
    })).toEqual({ cancelled: 'not-downloaded', own: 0, other: 0, stateLeaked: false })
  })

  it('cancels immediately while shared shell preparation continues independently', async () => {
    expect(await page.evaluate(async () => {
      const w = window as any
      w.pwa.setActiveOfflineUser(1); w.waitShell = true
      const download = w.pwa.saveBookOffline(1, 'pdf').then(() => 'downloaded', (error: Error) => error.name)
      while (!w.shellStarted) await new Promise(resolve => setTimeout(resolve, 1))
      w.pwa.cancelBookDownload(1)
      const result = await Promise.race([download, new Promise(resolve => setTimeout(() => resolve('timeout'), 500))])
      const running = !w.shellFinished
      w.finishShell()
      await new Promise(resolve => setTimeout(resolve, 1))
      return { result, running, finished: w.shellFinished, state: w.pwa.downloadStates[1].status, books: (await w.store.listOfflineBooks(1)).length }
    })).toEqual({ result: 'AbortError', running: true, finished: true, state: 'not-downloaded', books: 0 })
  })
})

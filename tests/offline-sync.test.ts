import fs from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test'
import ts from 'typescript'

// Real IndexedDB and browser fetch; the small HTTP fixture below models server
// receipts and deliberately loses/holds responses. No app build or port needed.
const engine = process.env.LITERA_STORAGE_BROWSER === 'webkit' ? webkit : chromium
const origin = 'http://127.0.0.1'
const modules = new Map<string, string>()
for (const name of ['offline-sync', 'offline-store', 'offline-context', 'offline-progress', 'api']) {
  const source = fs.readFileSync(new URL(`../src/web/lib/${name}.ts`, import.meta.url), 'utf8')
  modules.set(`/${name}.js`, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll("from 'vue'", "from '/vue.js'").replaceAll("from '../../shared/progress'", "from '/progress.js'").replace(/from '\.\/([^']+)'/g, "from '/$1.js'"))
}
modules.set('/progress.js', ts.transpileModule(fs.readFileSync(new URL('../src/shared/progress.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
modules.set('/vue.js', fs.readFileSync(new URL('../node_modules/vue/dist/vue.runtime.esm-browser.js', import.meta.url), 'utf8'))

describe(`offline sync in ${engine.name()}`, () => {
  let browser: Browser, context: BrowserContext, page: Page
  let remote: { progress: any; highlights: any[]; favorite: boolean }
  let requests: Array<{ path: string; method: string; user?: string; op?: string; body: any }>
  let receipts: Map<string, { status: number; body: any }>
  let loseNext: boolean, holdNext: boolean, serverDown: boolean, releaseHeld: (() => void) | undefined
  const metadata = { id: 1, title: 'Local book', format: 'epub', favorite: false, fileRevision: 'r1', addedAt: '2026-01-01' }
  beforeAll(async () => { browser = await engine.launch(engine === webkit && process.env.LITERA_WEBKIT_EXECUTABLE ? { executablePath: process.env.LITERA_WEBKIT_EXECUTABLE } : {}) })
  afterAll(async () => { await browser?.close() })
  beforeEach(async () => {
    remote = { progress: null, highlights: [], favorite: false }; requests = []; receipts = new Map()
    loseNext = false; holdNext = false; serverDown = false; releaseHeld = undefined
    context = await browser.newContext()
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method(), path = url.pathname
      if (modules.has(path)) { await route.fulfill({ contentType: 'text/javascript', body: modules.get(path)! }); return }
      if (path === '/') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reading sync test</title>' }); return }
      const headers = req.headers(), body = req.postDataJSON(), op = headers['x-litera-operation']
      requests.push({ path, method, user: headers['x-litera-user'], op, body })
      if (serverDown) { await route.abort('failed'); return }
      if (path === '/health') { await route.fulfill({ json: { status: 'ok' } }); return }
      if (path === '/api/v1/auth/me') { await route.fulfill({ json: { user: { id: 1 } } }); return }
      if (headers['x-litera-user'] !== '1') { await route.fulfill({ status: 409, json: { error: { code: 'SESSION_USER_MISMATCH', message: 'Wrong session' } } }); return }
      if (method === 'GET') {
        const book = { ...metadata, favorite: remote.favorite, progressRatio: remote.progress?.progressRatio ?? null, locator: remote.progress?.locator, completed: remote.progress?.completed ?? false, lastReadAt: remote.progress?.lastReadAt }
        const values: Record<string, any> = {
          '/api/v1/books/1/progress': { progress: remote.progress }, '/api/v1/books/1/highlights': { highlights: remote.highlights },
          '/api/v1/books/1': { book }, '/api/v1/books': { books: [book], pagination: { total: 1 } },
          '/api/v1/settings': { preferences: { theme: 'light' } },
        }
        await route.fulfill({ status: values[path] ? 200 : 404, json: values[path] ?? {} }); return
      }
      let result = op ? receipts.get(op) : undefined
      if (!result) {
        if (path.endsWith('/progress')) {
          if (body.revision !== (remote.progress?.revision ?? 0)) { await route.fulfill({ status: 409, json: { error: { code: 'STALE_PROGRESS', message: 'Another device changed progress' } } }); return }
          remote.progress = { ...body, revision: (remote.progress?.revision ?? 0) + 1, lastReadAt: new Date().toISOString() }
          result = { status: 200, body: { progress: remote.progress } }
        } else if (path.endsWith('/highlights') && method === 'POST') {
          const highlight = { ...body, id: receipts.size + 100, createdAt: new Date().toISOString() }
          remote.highlights.push(highlight); result = { status: 201, body: { highlight } }
        } else if (path.startsWith('/api/v1/highlights/') && method === 'DELETE') {
          remote.highlights = remote.highlights.filter(item => item.id !== Number(path.split('/').at(-1))); result = { status: 204, body: undefined }
        } else if (path.endsWith('/favorite')) {
          remote.favorite = method === 'PUT'; result = { status: method === 'PUT' ? 200 : 204, body: method === 'PUT' ? { favorite: true } : undefined }
        } else result = { status: 200, body: { preferences: body } }
        if (op) receipts.set(op, result)
      }
      if (holdNext) { holdNext = false; await new Promise<void>(resolve => { releaseHeld = resolve }) }
      if (loseNext) { loseNext = false; await route.abort('failed'); return }
      if (result.status === 204) await route.fulfill({ status: 204 })
      else await route.fulfill({ status: result.status, json: result.body })
    })
    page = await context.newPage(); await load(page)
  })
  afterEach(async () => { releaseHeld?.(); await context?.close() })

  async function load(target: Page, offline = false) {
    await target.goto(origin)
    await target.evaluate(`(async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => ${!offline} });
      window.ctx = await import('/offline-context.js'); window.s = await import('/offline-sync.js');
      window.api = (await import('/api.js')).api; window.store = await import('/offline-store.js');
      ctx.setOfflineContext(1);
      window.save = ratio => api('/api/v1/books/1/progress', {method:'PUT',body:JSON.stringify({format:'epub',progressRatio:ratio,locator:{type:'epub-cfi',cfi:'epubcfi(/6/2)'},revision:0})});
      window.queue = async (expedite = false) => {
        const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('litera-reading');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
        const tx=db.transaction('pendingOperations',expedite?'readwrite':'readonly'), store=tx.objectStore('pendingOperations');
        const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
        const rows=await new Promise(resolve=>{const r=store.getAll();r.onsuccess=()=>resolve(r.result)});
        if(expedite)for(const op of rows)store.put({...op,nextAttemptAt:0});
        await done;db.close();return rows;
      };
      window.highlight = () => api('/api/v1/books/1/highlights',{method:'POST',body:JSON.stringify({quoteText:'A quote',locator:{type:'epub-cfi',cfi:'epubcfi(/6/2)'}})});
    })()`)
  }

  it('replays an immutable sent operation before rebasing its own queued successor', async () => {
    await page.evaluate(`api('/api/v1/books/1/progress')`)
    await page.evaluate(`save(.2)`)
    loseNext = true
    await page.evaluate(`s.flushOfflineSync()`)
    await page.evaluate(`save(.7)`)
    const pending: any = await page.evaluate(`queue(true)`)
    expect(pending.map((op: any) => op.phase).sort()).toEqual(['queued', 'sent'])
    await page.evaluate(`s.flushOfflineSync()`)
    const puts = requests.filter(req => req.method === 'PUT')
    expect(puts.map(req => [req.body.progressRatio, req.body.revision])).toEqual([[.2, 0], [.2, 0], [.7, 1]])
    expect(puts[0]!.op).toBe(puts[1]!.op)
    expect(puts[2]!.op).not.toBe(puts[0]!.op)
    expect(await page.evaluate(`queue()`)).toEqual([])
    expect(remote.progress).toMatchObject({ progressRatio: .7, revision: 2 })
  })

  it('cancels an unsent negative highlight, then replays and deletes one already committed', async () => {
    const before: any = await page.evaluate(`(async()=>{const created=await highlight();await api('/api/v1/highlights/'+created.highlight.id,{method:'DELETE'});return {id:created.highlight.id,pending:await queue()}})()`)
    expect(before.id).toBeLessThan(0); expect(before.pending).toEqual([])
    expect(requests.filter(req => req.method === 'POST')).toEqual([])
    const created: any = await page.evaluate(`highlight()`)
    loseNext = true; await page.evaluate(`s.flushOfflineSync()`)
    expect(remote.highlights).toHaveLength(1)
    await page.evaluate(`api('/api/v1/highlights/${created.highlight.id}',{method:'DELETE'})`)
    await page.evaluate(`queue(true)`); await page.evaluate(`s.flushOfflineSync()`)
    expect(remote.highlights).toEqual([])
    expect(await page.evaluate(`queue()`)).toEqual([])
    expect(await page.evaluate(`api('/api/v1/books/1/highlights')`)).toEqual({ highlights: [] })
    expect(requests.filter(req => req.method === 'DELETE').every(req => Number(req.path.split('/').at(-1)) > 0)).toBe(true)
  })

  it('does not let a terminal highlight rejection starve a later independent highlight', async () => {
    let reject = true
    await page.route('**/api/v1/books/1/highlights', async route => {
      if (reject && route.request().method() === 'POST') {
        reject = false
        await route.fulfill({ status: 400, json: { error: { code: 'INVALID_HIGHLIGHT', message: 'Rejected fixture quote' } } })
      } else await route.fallback()
    })
    await page.evaluate(`highlight()`)
    await page.evaluate(`s.flushOfflineSync()`)
    await page.evaluate(`highlight()`)
    await page.evaluate(`s.flushOfflineSync()`)
    expect(remote.highlights).toHaveLength(1)
    const rows: any[] = await page.evaluate(`queue()`)
    expect(rows).toHaveLength(1)
    expect(rows[0].phase).toBe('failed')
  })

  it('restores queued reading across reload and imports old account-scoped drafts exactly once', async () => {
    await page.evaluate(`Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false})`)
    await page.evaluate(`save(.4)`)
    await load(page, true)
    expect((await page.evaluate<any>(`api('/api/v1/books/1/progress')`)).progress.progressRatio).toBe(.4)
    expect(await page.evaluate(`queue()`)).toHaveLength(1)
    await page.evaluate(`Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});s.online=true`)
    await page.evaluate(`s.flushOfflineSync()`)
    expect(remote.progress.progressRatio).toBe(.4)
    await page.evaluate(`(async()=>{await s.clearReadingUser(1);localStorage.setItem('litera-offline-progress-u1-b1',JSON.stringify({format:'epub',progressRatio:.6,locator:{type:'epub-cfi',cfi:'epubcfi(/6/4)'},revision:1}));localStorage.setItem('litera-offline-progress-u2-b1','other');await s.flushOfflineSync();await s.flushOfflineSync()})()`)
    expect(remote.progress).toMatchObject({ revision: 2, progressRatio: .6 })
    expect(await page.evaluate(`localStorage.getItem('litera-offline-progress-u1-b1')`)).toBeNull()
    expect(await page.evaluate(`localStorage.getItem('litera-offline-progress-u2-b1')`)).toBe('other')
  })

  it('leases a sent operation across tabs and retains a new local update during ACK', async () => {
    await page.evaluate(`save(.2)`); holdNext = true
    await page.evaluate(`window.flushing=s.flushOfflineSync();undefined`)
    await vi.waitFor(() => expect(releaseHeld).toBeTypeOf('function'))
    const other = await context.newPage(); await load(other)
    await other.evaluate(`save(.8)`); await other.evaluate(`s.flushOfflineSync()`)
    expect(requests.filter(req => req.method === 'PUT')).toHaveLength(1)
    releaseHeld!(); await page.evaluate(`flushing`)
    expect(remote.progress).toMatchObject({ revision: 2, progressRatio: .8 })
    expect(await other.evaluate(`queue()`)).toEqual([])
  })

  it('blocks conflicted locators until explicit server resolution, without highest-percent wins', async () => {
    await page.evaluate(`save(.9)`)
    remote.progress = { format: 'epub', progressRatio: .1, locator: { type: 'epub-cfi', cfi: 'epubcfi(/6/2)' }, revision: 1 }
    await page.evaluate(`s.flushOfflineSync()`)
    expect(await page.evaluate(`s.syncState.conflicts`)).toEqual([{ bookId: 1, kind: 'progress' }])
    expect(await page.evaluate(`save(.8).then(()=>false,error=>error.code)`)).toBe('STALE_PROGRESS')
    await page.evaluate(`s.resolveProgressConflict(1,'server')`)
    expect(await page.evaluate(`queue()`)).toEqual([])
    expect((await page.evaluate<any>(`api('/api/v1/books/1/progress')`)).progress.progressRatio).toBe(.1)
    await page.evaluate(`save(.05)`); await page.evaluate(`s.flushOfflineSync()`)
    expect(remote.progress).toMatchObject({ revision: 2, progressRatio: .05 })
  })

  it('falls back to a confirmed online mutation if IndexedDB is denied, without claiming local durability', async () => {
    await page.evaluate(`indexedDB.open=()=>{throw new DOMException('Storage denied','SecurityError')}`)
    const result: any = await page.evaluate(`save(.3)`)
    expect(result.progress).toMatchObject({ revision: 1, progressRatio: .3 })
    expect(await page.evaluate(`s.syncState.pending`)).toBe(0)
    expect(await page.evaluate(`s.syncState.message`)).toContain('armazenamento local falhou')
    expect(requests.find(req => req.method === 'PUT')).toMatchObject({ user: '1', body: { revision: 0 } })
  })

  it.each(['detail', 'catalog'])('reconciles acknowledged state with newer %s metadata, while preserving local pending changes', async entry => {
    await page.evaluate(`(async()=>{
      const stage=await store.beginOfflineDownload(1,1),path='/api/v1/books/1';
      const book={id:1,title:'Local book',format:'epub',favorite:false};
      await store.putOfflineResource(stage,path,new Blob([JSON.stringify({book})]));
      await store.commitOfflineDownload(stage,{...stage,format:'epub',metadata:book,revision:'r1',downloadedAt:new Date().toISOString(),bytes:10},[path]);
      await save(.7);await api('/api/v1/books/1/favorite',{method:'PUT'});await s.flushOfflineSync();
    })()`)
    expect(remote.favorite).toBe(true)
    expect(remote.progress.progressRatio).toBe(.7)
    expect(await page.evaluate(`queue()`)).toEqual([])
    remote.favorite = false
    remote.progress = { ...remote.progress, progressRatio: .2, revision: 2, lastReadAt: new Date(Date.now() + 60_000).toISOString() }
    const path = entry === 'detail' ? '/api/v1/books/1' : '/api/v1/books'
    const online: any = await page.evaluate(`api('${path}')`)
    expect(online.book ?? online.books[0]).toMatchObject({ favorite: false, progressRatio: .2 })
    serverDown = true
    const offline: any = await page.evaluate(`api('/api/v1/books')`)
    expect(offline.books[0]).toMatchObject({ favorite: false, progressRatio: .2, offline: true })
    expect((await page.evaluate<any>(`api('/api/v1/books/1')`)).book).toMatchObject({ favorite: false, progressRatio: .2 })
    // A new local action still wins in the overlay, even with an older timestamp.
    await page.evaluate(`(async()=>{await save(.65);await api('/api/v1/books/1/favorite',{method:'PUT'})})()`)
    expect((await page.evaluate<any>(`api('/api/v1/books')`)).books[0]).toMatchObject({ favorite: true, progressRatio: .65 })
    serverDown = false
    await page.evaluate(`s.syncState.online=true`)
    expect((await page.evaluate<any>(`api('/api/v1/books/1')`)).book).toMatchObject({ favorite: true, progressRatio: .65 })
    expect(await page.evaluate(`queue()`)).toHaveLength(2)
  })

  it('serves only downloads during a real outage and recovers without online events or pending operations', async () => {
    await page.evaluate(`(async()=>{
      const stage=await store.beginOfflineDownload(1,1),path='/api/v1/books/1';
      await store.putOfflineResource(stage,path,new Blob([JSON.stringify({book:{id:1,title:'Local book',format:'epub'}})]));
      await store.putOfflineResource(stage,'/api/v1/settings',new Blob(['{"preferences":{"theme":"sepia"}}']));
      await store.commitOfflineDownload(stage,{...stage,format:'epub',metadata:{id:1,title:'Local book'},revision:'r1',downloadedAt:new Date().toISOString(),bytes:10},[path,'/api/v1/settings']);
    })()`)
    serverDown = true
    const local: any = await page.evaluate(`api('/api/v1/books')`)
    expect(local.offline).toBe(true); expect(local.books[0].offline).toBe(true)
    const count = requests.length
    await page.evaluate(`api('/api/v1/books?q=Local')`); await page.evaluate(`api('/api/v1/books?q=missing')`)
    expect(requests.length).toBe(count)
    expect((await page.evaluate<any>(`api('/api/v1/settings')`)).preferences).toMatchObject({ theme: 'sepia', fontScale: 100, appTheme: 'system' })
    serverDown = false
    await page.evaluate(`s.flushOfflineSync()`)
    expect(await page.evaluate(`s.syncState.online`)).toBe(true)
    expect(requests.some(req => req.path === '/health')).toBe(true)
    const online: any = await page.evaluate(`api('/api/v1/books')`)
    expect(online.books[0].offline).toBe(true)
    expect(requests.filter(req => req.path.startsWith('/api/') && req.path !== '/api/v1/auth/me').every(req => req.user === '1')).toBe(true)
    expect(requests.filter(req => req.path === '/api/v1/auth/me').every(req => !req.user)).toBe(true)
  })
})

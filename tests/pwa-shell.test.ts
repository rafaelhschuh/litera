import fs from 'node:fs'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { literaShellPlugin } from '../vite.config'

const template = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const urls = ['/index.html', '/assets/main-123.js', '/assets/reader-456.js', '/assets/app-123.css', '/pdfjs/wasm/openjpeg.wasm', '/icons/litera-192.png']
function workerSource(build = 'test-build', assets = urls) {
  return template.replace("'__LITERA_BUILD__'", JSON.stringify(build)).replace('/* __LITERA_PRECACHE__ */ []', JSON.stringify(assets))
}

function workerHarness(source = workerSource(), stores = new Map<string, Map<string, Response>>()) {
  const listeners = new Map<string, (event: any) => void>()
  const key = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, 'https://litera.test').href
  const caches = {
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name: string) => stores.delete(name)),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        match: async (request: string | Request) => store.get(key(request))?.clone(),
        put: async (request: string | Request, response: Response) => { store.set(key(request), response.clone()) },
      }
    },
  }
  const fetch = vi.fn(async (request: Request) => {
    const pathname = new URL(request.url).pathname
    const type = pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.wasm') ? 'application/wasm' : 'image/png'
    return new Response(pathname, { headers: { 'content-type': type } })
  })
  const self = {
    location: { origin: 'https://litera.test' },
    registration: { waiting: null as any, installing: null as any },
    clients: { claim: vi.fn(async () => undefined), matchAll: vi.fn(async () => [] as { id: string }[]) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
  }
  vm.runInNewContext(source, { self, caches, fetch, URL, Request, Response })
  function dispatch(type: string, fields: Record<string, any> = {}) {
    let response: Promise<Response> | undefined
    const waits: Promise<unknown>[] = []
    listeners.get(type)!({ ...fields, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => { response = promise } })
    return { response, done: Promise.all(waits) }
  }
  function request(path: string, options: { mode?: string; range?: string; method?: string } = {}) {
    return dispatch('fetch', { request: { url: new URL(path, self.location.origin).href, method: options.method ?? 'GET', mode: options.mode ?? 'cors', headers: new Headers(options.range ? { range: options.range } : {}) }, clientId: 'tab', resultingClientId: 'new-tab' })
  }
  return { caches, stores, fetch, self, dispatch, request }
}

describe('production shell build plugin', () => {
  function generate(main = 'main code', reverse = false) {
    const plugin = literaShellPlugin()
    const emitted: any[] = []
    const context = { emitFile: (file: any) => { emitted.push(file); return file.fileName }, error: (message: string) => { throw new Error(message) } }
    ;(plugin.buildStart as any).call(context)
    const entries = [
      { type: 'asset', fileName: 'index.html', source: '<html>Litera</html>' },
      { type: 'chunk', fileName: 'assets/main.js', code: main },
      { type: 'chunk', fileName: 'assets/lazy-reader.js', code: 'reader' },
      { type: 'asset', fileName: 'assets/pdf.worker.mjs', source: 'worker' },
      { type: 'asset', fileName: 'assets/app.css', source: 'body{}' },
      ...emitted,
    ]
    if (reverse) entries.reverse()
    ;(plugin.generateBundle as any).handler.call(context, {}, Object.fromEntries(entries.map(entry => [entry.fileName, entry])))
    return { source: emitted.at(-1).source as string, emitted }
  }

  it('emits deterministic precache for every chunk, icon and PDF auxiliary asset', () => {
    const { source, emitted } = generate()
    expect(source).toBe(generate('main code', true).source)
    expect(source).not.toBe(generate('changed code').source)
    expect(source).not.toContain('/* __LITERA_PRECACHE__ */')
    expect(source).toMatch(/const BUILD = "[a-f0-9]{24}"/)
    const precache = JSON.parse(source.match(/const PRECACHE = (\[.*\])/u)![1]!) as string[]
    expect(precache).toEqual([...precache].sort())
    expect(precache).toEqual(expect.arrayContaining(['/index.html', '/assets/main.js', '/assets/lazy-reader.js', '/assets/pdf.worker.mjs', '/assets/app.css', '/manifest.webmanifest', '/icons/apple-touch-icon.png', '/icons/litera-maskable.png']))
    for (const file of emitted.filter(file => file.fileName.startsWith('pdfjs/'))) expect(precache).toContain('/' + file.fileName)
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) expect(precache.some(url => url.startsWith('/pdfjs/' + directory + '/'))).toBe(true)
    expect(precache.some(url => /api|legacy|health/.test(url))).toBe(false)
    expect(precache).not.toContain('/sw.js')
  })
})

describe('shell-only service worker', () => {
  it('installs every resource before success and never skips waiting automatically', async () => {
    const h = workerHarness()
    await h.dispatch('install').done
    expect(h.fetch).toHaveBeenCalledTimes(urls.length)
    expect(h.self.skipWaiting).not.toHaveBeenCalled()
    for (const [request] of h.fetch.mock.calls) expect(request.credentials).toBe('omit')
    const reply = vi.fn()
    await h.dispatch('message', { data: { type: 'LITERA_ENSURE_SHELL' }, ports: [{ postMessage: reply }] }).done
    expect(reply).toHaveBeenCalledWith({ type: 'LITERA_SHELL_READY', build: 'test-build', ready: true })
    expect(h.fetch).toHaveBeenCalledTimes(urls.length)
  })

  it('rejects a partial install, including HTML masquerading as a missing asset', async () => {
    const h = workerHarness()
    h.fetch.mockResolvedValue(new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }))
    await expect(h.dispatch('install').done).rejects.toThrow('Invalid shell resource')
    expect(h.stores.has('litera-shell-build-test-build')).toBe(false)
    expect(h.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('does not activate the untransformed development placeholder', async () => {
    const h = workerHarness(template)
    await expect(h.dispatch('install').done).rejects.toThrow('Production shell required')
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('serves first-visit deep links and lazy assets without any network', async () => {
    const h = workerHarness()
    await h.dispatch('install').done
    h.fetch.mockClear().mockRejectedValue(new TypeError('offline'))
    for (const route of ['/', '/library', '/books/17', '/read/17?mode=pdf', '/settings', '/highlights', '/search?q=unvisited']) {
      const event = h.request(route, { mode: 'navigate' })
      expect(await (await event.response)!.text()).toBe('/index.html')
      await event.done
    }
    expect(await (await h.request('/assets/reader-456.js').response)!.text()).toBe('/assets/reader-456.js')
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('leaves API, Range, legacy, health, admin and external traffic untouched', async () => {
    const h = workerHarness()
    for (const route of ['/api', '/api/v1/books/1/content', '/legacy', '/legacy/read/1', '/legacy-assets/app.js', '/health', '/admin', '/content/1', 'https://elsewhere.test/assets/main-123.js']) {
      const event = h.request(route, { mode: 'navigate' })
      expect(event.response).toBeUndefined()
      await event.done
    }
    expect(h.request('/assets/main-123.js', { range: 'bytes=0-10' }).response).toBeUndefined()
    expect(h.request('/library', { method: 'POST' }).response).toBeUndefined()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.stores.size).toBe(0)
  })

  it('cleans only obsolete shells, preserving private content and pending updates', async () => {
    const h = workerHarness()
    for (const name of ['litera-shell-v2', 'litera-shell-build-new', 'litera-books-u1-b2-v1', 'litera-data-u1-v1', 'litera-control-v1']) await h.caches.open(name)
    await h.dispatch('install').done
    h.self.registration.waiting = {}
    await h.request('/library', { mode: 'navigate' }).done
    expect(h.stores.has('litera-shell-build-new')).toBe(true)
    h.self.registration.waiting = null
    await h.dispatch('activate').done
    expect([...h.stores.keys()].sort()).toEqual(['litera-books-u1-b2-v1', 'litera-control-v1', 'litera-data-u1-v1', 'litera-shell-build-test-build'])
    expect(h.self.clients.claim).toHaveBeenCalledOnce()
  })

  it('keeps previous hashed chunks while another tab is open', async () => {
    const h = workerHarness()
    const previous = await h.caches.open('litera-shell-build-old')
    await previous.put('/assets/old-reader.js', new Response('old reader'))
    h.self.clients.matchAll.mockResolvedValue([{ id: 'other-reader' }])
    await h.dispatch('install').done
    await h.dispatch('activate').done
    await h.request('/library', { mode: 'navigate' }).done
    expect(await (await h.request('/assets/old-reader.js').response)!.text()).toBe('old reader')
    expect(h.stores.has('litera-shell-build-old')).toBe(true)
  })

  it('preserves downloaded bytes and pending state throughout a two-build opt-in upgrade', async () => {
    const old = workerHarness(workerSource('old', [...urls, '/assets/old-only.js']))
    await old.dispatch('install').done
    const books = await old.caches.open('litera-books-u7-b42-v1')
    const data = await old.caches.open('litera-data-u7-v1')
    const binary = new Uint8Array([0, 255, 80, 68, 70, 0, 17])
    await books.put('/private/book', new Response(binary))
    await data.put('/private/pending', new Response('{"revision":18,"locator":{"page":7}}'))
    const next = workerHarness(workerSource('next'), old.stores)
    let finishIndex!: (response: Response) => void
    next.fetch.mockImplementationOnce(() => new Promise(resolve => { finishIndex = resolve }))
    old.self.registration.installing = {}
    const installing = next.dispatch('install').done
    await vi.waitFor(() => expect(finishIndex).toBeTypeOf('function'))
    await old.request('/library', { mode: 'navigate' }).done
    expect(old.stores.has('litera-shell-build-next')).toBe(true)
    finishIndex(new Response('next build HTML', { headers: { 'content-type': 'text/html' } }))
    await installing
    old.self.registration.installing = null
    old.self.registration.waiting = {}
    expect(await (await old.request('/library', { mode: 'navigate' }).response)!.text()).toBe('/index.html')
    expect(next.self.skipWaiting).not.toHaveBeenCalled()

    await next.dispatch('message', { data: { type: 'LITERA_APPLY_UPDATE' }, ports: [] }).done
    next.self.clients.matchAll.mockResolvedValue([{ id: 'old-reading-tab' }])
    await next.dispatch('activate').done
    next.fetch.mockClear().mockRejectedValue(new TypeError('offline'))
    const navigation = next.request('/read/42', { mode: 'navigate' })
    expect(await (await navigation.response)!.text()).toBe('next build HTML')
    await navigation.done
    expect(await (await next.request('/assets/old-only.js').response)!.text()).toBe('/assets/old-only.js')
    expect(next.fetch).not.toHaveBeenCalled()
    expect(next.stores.has('litera-shell-build-old')).toBe(true)

    next.self.clients.matchAll.mockResolvedValue([])
    await next.request('/library', { mode: 'navigate' }).done
    expect(next.stores.has('litera-shell-build-old')).toBe(false)
    expect(new Uint8Array(await (await books.match('/private/book'))!.arrayBuffer())).toEqual(binary)
    expect(await (await data.match('/private/pending'))!.text()).toBe('{"revision":18,"locator":{"page":7}}')
    expect(next.caches.delete.mock.calls.flat()).toEqual(['litera-shell-build-old'])
  })

  it('rolls back a failed new install without changing the active shell or private downloads', async () => {
    const old = workerHarness(workerSource('old'))
    await old.dispatch('install').done
    const books = await old.caches.open('litera-books-u7-b42-v1')
    await books.put('/private/book', new Response('retained book'))
    const next = workerHarness(workerSource('failed'), old.stores)
    next.fetch.mockRejectedValue(new TypeError('connection interrupted'))
    await expect(next.dispatch('install').done).rejects.toThrow('connection interrupted')
    expect(next.stores.has('litera-shell-build-failed')).toBe(false)
    expect(next.stores.has('litera-shell-build-old')).toBe(true)
    old.fetch.mockClear().mockRejectedValue(new TypeError('offline'))
    const navigation = old.request('/read/42', { mode: 'navigate' })
    expect(await (await navigation.response)!.text()).toBe('/index.html')
    await navigation.done
    expect(old.fetch).not.toHaveBeenCalled()
    expect(await (await books.match('/private/book'))!.text()).toBe('retained book')
    expect(next.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('repairs evicted shell entries or reports unavailable, never false readiness', async () => {
    const h = workerHarness()
    await h.dispatch('install').done
    h.stores.get('litera-shell-build-test-build')!.delete('https://litera.test/assets/reader-456.js')
    h.fetch.mockRejectedValue(new TypeError('offline'))
    const reply = vi.fn()
    await h.dispatch('message', { data: { type: 'LITERA_ENSURE_SHELL' }, ports: [{ postMessage: reply }] }).done
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ready: false }))
  })

  it('activates only on an explicit update message and ignores identity messages', async () => {
    const h = workerHarness()
    await h.dispatch('message', { data: { type: 'LITERA_ACTIVE_USER', userId: 123 }, ports: [] }).done
    expect(h.stores.size).toBe(0)
    await h.dispatch('message', { data: { type: 'LITERA_APPLY_UPDATE' }, ports: [] }).done
    expect(h.self.skipWaiting).toHaveBeenCalledOnce()
  })
})

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetModules() })

async function browserHarness(controlled = true) {
  vi.stubEnv('DEV', false)
  const service = Object.assign(new EventTarget(), { controller: null as any, ready: Promise.resolve(null as any), getRegistration: vi.fn(async () => undefined as any), register: vi.fn() })
  const worker = { postMessage: vi.fn((message: any, ports: any[]) => ports[0].postMessage(message.type === 'LITERA_SHELL_STATUS'
    ? { type: 'LITERA_SHELL_STATUS', protocol: 1 } : { type: 'LITERA_SHELL_READY', ready: true })) }
  const registration = Object.assign(new EventTarget(), { waiting: null as any, installing: null as any, active: worker, update: vi.fn(async () => undefined) })
  service.controller = controlled ? worker : null
  service.ready = Promise.resolve(registration)
  service.register.mockResolvedValue(registration)
  const browser = Object.assign(new EventTarget(), { isSecureContext: true, caches: {}, matchMedia: () => ({ matches: false }), location: { reload: vi.fn() } })
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', document)
  vi.stubGlobal('navigator', { serviceWorker: service, onLine: true })
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as any, close: vi.fn() }
    port2 = { close: vi.fn(), postMessage: (data: any) => this.port1.onmessage?.({ data }) }
  })
  const module = await import('../src/web/lib/pwa-shell')
  return { module, service, worker, registration, browser, document }
}

describe('browser shell lifecycle', () => {
  it('waits for page control and worker confirmation, coalescing concurrent downloads', async () => {
    const h = await browserHarness(false)
    // Safari/WebKit may activate and control the page before register() settles.
    h.service.register.mockReturnValue(new Promise(() => undefined))
    const first = h.module.ensureOfflineShell()
    expect(h.module.ensureOfflineShell()).toBe(first)
    await vi.waitFor(() => expect(h.service.register).toHaveBeenCalledOnce())
    expect(h.worker.postMessage).not.toHaveBeenCalled()
    h.service.controller = h.worker
    h.service.dispatchEvent(new Event('controllerchange'))
    await first
    expect(h.worker.postMessage).toHaveBeenCalledTimes(2)
    expect(h.module.offlineSupport.ready).toBe(true)
    expect(h.service.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('surfaces failed readiness and allows retry instead of marking downloads ready', async () => {
    const h = await browserHarness()
    h.worker.postMessage.mockImplementationOnce((_message, ports) => ports[0].postMessage({ type: 'LITERA_SHELL_STATUS', protocol: 1 }))
      .mockImplementationOnce((_message, ports) => ports[0].postMessage({ type: 'LITERA_SHELL_READY', ready: false }))
    await expect(h.module.ensureOfflineShell()).rejects.toThrow('incompleto')
    expect(h.module.offlineSupport.message).toContain('incompleto')
    expect(h.module.offlineSupport.available).toBe(true)
    expect(h.module.offlineSupport.ready).toBe(false)
    expect(h.module.offlineSupport.supported).toBe(true)
    expect(h.module.offlineSupport.canRetry).toBe(true)
    await h.module.ensureOfflineShell()
    expect(h.module.offlineSupport.message).toBe('')
    expect(h.module.offlineSupport.available).toBe(true)
    expect(h.module.offlineSupport.ready).toBe(true)
    expect(h.module.offlineSupport.canRetry).toBe(false)
  })

  it('initializes once and leaves an update waiting until explicit consent', async () => {
    const h = await browserHarness()
    const waiting = { postMessage: vi.fn(() => { h.service.controller = waiting; h.service.dispatchEvent(new Event('controllerchange')) }) }
    h.registration.waiting = waiting
    h.module.initializePwa(); h.module.initializePwa()
    await vi.waitFor(() => expect(h.module.pwaUpdate.available).toBe(true))
    expect(h.service.register).toHaveBeenCalledOnce()
    expect(waiting.postMessage).not.toHaveBeenCalled()
    // Existing shell remains usable while an update is waiting.
    await h.module.ensureOfflineShell()
    expect(h.browser.location.reload).not.toHaveBeenCalled()
    await h.module.applyPwaUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'LITERA_APPLY_UPDATE' })
    expect(h.browser.location.reload).toHaveBeenCalledOnce()
  })

  it('never reloads another reading tab when its controller changes', async () => {
    const h = await browserHarness()
    h.module.initializePwa()
    h.service.dispatchEvent(new Event('controllerchange'))
    expect(h.browser.location.reload).not.toHaveBeenCalled()
    await h.module.ensureOfflineShell()
  })

  it('reports legacy controllers after five seconds without forcing an available update', async () => {
    const h = await browserHarness()
    h.worker.postMessage.mockImplementation(() => undefined)
    h.registration.waiting = { postMessage: vi.fn() }
    vi.useFakeTimers()
    const failure = expect(h.module.ensureOfflineShell()).rejects.toThrow('Service Worker anterior')
    await vi.advanceTimersByTimeAsync(5_001)
    await failure
    expect(h.module.pwaUpdate.available).toBe(true)
    expect(h.module.offlineSupport.available).toBe(true)
    expect(h.module.offlineSupport.ready).toBe(false)
    expect(h.registration.waiting.postMessage).not.toHaveBeenCalled()
    expect(h.browser.location.reload).not.toHaveBeenCalled()
  })

  it('keeps the five-second legacy deadline even while register is stuck on the network', async () => {
    const h = await browserHarness()
    h.service.register.mockReturnValue(new Promise(() => undefined))
    h.worker.postMessage.mockImplementation(() => undefined)
    vi.useFakeTimers()
    const failure = expect(h.module.ensureOfflineShell()).rejects.toThrow('Aplique a atualização')
    await vi.advanceTimersByTimeAsync(5_001)
    await failure
    expect(h.module.offlineSupport.message).toContain('Service Worker anterior')
    expect(h.module.offlineSupport.ready).toBe(false)
    expect(h.worker.postMessage).toHaveBeenCalledTimes(1)
    expect(h.worker.postMessage.mock.calls[0]![0].type).toBe('LITERA_SHELL_STATUS')
    expect(h.browser.location.reload).not.toHaveBeenCalled()
  })

  it('confirms an existing offline shell even if the registration update fails', async () => {
    const h = await browserHarness()
    h.service.register.mockRejectedValue(new TypeError('offline'))
    await h.module.ensureOfflineShell()
    expect(h.module.offlineSupport.ready).toBe(true)
    expect(h.module.offlineSupport.available).toBe(true)
  })

  it('prepares the shell on initialization without any book download', async () => {
    const h = await browserHarness()
    h.module.initializePwa()
    await vi.waitFor(() => expect(h.module.offlineSupport.ready).toBe(true))
    expect(h.worker.postMessage).toHaveBeenCalledTimes(2)
  })

  it('bounds controller waits and unregisters the listener on timeout', async () => {
    const h = await browserHarness(false)
    vi.useFakeTimers()
    const remove = vi.spyOn(h.service, 'removeEventListener')
    const failure = expect(h.module.ensureOfflineShell()).rejects.toThrow('Recarregue')
    await vi.advanceTimersByTimeAsync(120_001)
    await failure
    expect(remove).toHaveBeenCalledWith('controllerchange', expect.any(Function))
  })

  it('degrades without browser capabilities and does not invent a Safari install prompt', async () => {
    vi.stubGlobal('window', { isSecureContext: false, matchMedia: () => ({ matches: false }) })
    vi.stubGlobal('navigator', { standalone: true })
    const module = await import('../src/web/lib/pwa-shell')
    expect(module.offlineSupport.available).toBe(false)
    expect(module.offlineSupport.supported).toBe(false)
    expect(module.pwaInstall.installed).toBe(true)
    expect(await module.installPwa()).toBe(false)
    await expect(module.ensureOfflineShell()).rejects.toThrow('HTTPS')
    expect(module.offlineSupport.canRetry).toBe(false)
  })
})

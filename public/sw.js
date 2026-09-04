/* global self, caches, URL, fetch, Request */
// Replaced by the Vite build plugin. Not an offline development server.
const BUILD = '__LITERA_BUILD__'
const PRECACHE = /* __LITERA_PRECACHE__ */ []
const SHELL_PREFIX = 'litera-shell-build-'
const SHELL_CACHE = SHELL_PREFIX + BUILD
const ASSETS = new Set(PRECACHE)
const NAVIGATION = /^\/(?:|login\/?|library\/?|search\/?|favorites\/?|settings\/?|highlights\/?|(?:books|read)\/\d+\/?|(?:authors|series|genres)(?:\/[^/]+)?\/?)$/
let preparing

function validResponse(url, response) {
  if (!response.ok || response.redirected) return false
  const type = response.headers.get('content-type') || ''
  // Never mistake the server's SPA fallback for a missing static resource.
  if (url.endsWith('.html')) return type.includes('text/html')
  if (type.includes('text/html')) return false
  if (/\.m?js$/.test(url)) return /(?:javascript|ecmascript)/.test(type)
  if (url.endsWith('.css')) return type.includes('text/css')
  if (url.endsWith('.wasm')) return type.includes('application/wasm')
  return true
}

async function prepareShell() {
  if (BUILD === '__LITERA_' + 'BUILD__' || !ASSETS.has('/index.html')) throw new Error('Production shell required')
  const cache = await caches.open(SHELL_CACHE)
  // Bound parallel requests and memory, particularly on mobile WebKit.
  for (let index = 0; index < PRECACHE.length; index += 8) {
    const results = await Promise.allSettled(PRECACHE.slice(index, index + 8).map(async url => {
      if (await cache.match(url)) return
      const response = await fetch(new Request(new URL(url, self.location.origin), { cache: 'reload', credentials: 'omit' }))
      if (!validResponse(url, response)) throw new Error('Invalid shell resource: ' + url)
      await cache.put(url, response)
    }))
    const failed = results.find(result => result.status === 'rejected')
    if (failed) throw failed.reason
  }
}

function ensureShell() {
  if (!preparing) preparing = prepareShell().finally(() => { preparing = undefined })
  return preparing
}

self.addEventListener('install', event => {
  event.waitUntil(ensureShell().catch(async error => {
    await caches.delete(SHELL_CACHE)
    throw error
  }))
  // First install activates naturally. Updates wait for consent or closed clients.
})

async function cleanUnusedShells(exceptClientId, resultingClientId) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.some(client => client.id !== exceptClientId && client.id !== resultingClientId)) return
  const names = await caches.keys()
  // A waiting/partly installed update owns a different cache; never erase it.
  if (self.registration.waiting || self.registration.installing) return
  await Promise.all(names.filter(name => name.startsWith('litera-shell-') && name !== SHELL_CACHE).map(name => caches.delete(name)))
}

self.addEventListener('activate', event => {
  // Keep previous bundles while another tab may still be reading with them.
  event.waitUntil(cleanUnusedShells().then(() => self.clients.claim()))
})

self.addEventListener('message', event => {
  if (event.data?.type === 'LITERA_SHELL_STATUS') event.ports[0]?.postMessage({ type: 'LITERA_SHELL_STATUS', protocol: 1, build: BUILD })
  if (event.data?.type === 'LITERA_APPLY_UPDATE') event.waitUntil(self.skipWaiting())
  if (event.data?.type === 'LITERA_ENSURE_SHELL') {
    event.waitUntil(ensureShell().then(
      () => event.ports[0]?.postMessage({ type: 'LITERA_SHELL_READY', build: BUILD, ready: true }),
      () => event.ports[0]?.postMessage({ type: 'LITERA_SHELL_READY', build: BUILD, ready: false }),
    ))
  }
})

async function shellAsset(request, pathname) {
  const cached = await caches.open(SHELL_CACHE).then(cache => cache.match(pathname))
  if (cached) return cached
  // An open tab can still request an immutable chunk from the previous build.
  if (pathname.startsWith('/assets/')) {
    const names = await caches.keys()
    for (const name of names.filter(name => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE)) {
      const previous = await caches.open(name).then(cache => cache.match(pathname))
      if (previous) return previous
    }
  }
  // No runtime caching: only the build allowlist can populate shell storage.
  return fetch(request)
}

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) return
  if (/^\/(?:api(?:\/|$)|legacy(?:[-/]|$)|health(?:\/|$)|admin(?:\/|$))/.test(url.pathname)) return
  if (request.mode === 'navigate' && NAVIGATION.test(url.pathname)) {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => (await cache.match('/index.html')) || fetch(request)))
    event.waitUntil(cleanUnusedShells(event.clientId, event.resultingClientId).catch(() => undefined))
    return
  }
  if (ASSETS.has(url.pathname) || url.pathname.startsWith('/assets/')) event.respondWith(shellAsset(request, url.pathname))
})

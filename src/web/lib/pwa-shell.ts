import { reactive } from 'vue'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const supported = typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window
export const offlineSupport = reactive({
  supported: supported && !import.meta.env.DEV,
  available: supported && !import.meta.env.DEV,
  ready: false,
  canRetry: false,
  message: !supported ? 'A leitura offline exige HTTPS e suporte a armazenamento e Service Worker neste navegador.'
    : import.meta.env.DEV ? 'Use o build de produção para preparar a leitura offline.' : '',
})
export const pwaInstall = reactive<{ available: boolean; installed: boolean; prompt?: InstallPromptEvent }>({
  available: false,
  installed: typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true),
})
export const pwaUpdate = reactive({ available: false, checking: false, installing: false, applying: false, promptVersion: 0 })

let initialized = false
let registration: Promise<ServiceWorkerRegistration> | undefined
let preparing: Promise<void> | undefined
let lastUpdateCheck = 0
let updateCheck: Promise<void> | undefined
let offeredWorker: ServiceWorker | undefined
const TIMEOUT = 120_000
const observedRegistrations = new WeakSet<ServiceWorkerRegistration>()

function withTimeout<T>(promise: Promise<T>, message: string, timeout = TIMEOUT): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

function observeRegistration(value: ServiceWorkerRegistration): ServiceWorkerRegistration {
  const update = () => {
    pwaUpdate.available = Boolean(value.waiting)
    pwaUpdate.installing = Boolean(value.installing && navigator.serviceWorker.controller)
    if (value.waiting && value.waiting !== offeredWorker) {
      offeredWorker = value.waiting
      pwaUpdate.promptVersion++
    }
  }
  update()
  if (observedRegistrations.has(value)) return value
  observedRegistrations.add(value)
  const installing = () => {
    value.installing?.addEventListener('statechange', update)
    update()
  }
  value.addEventListener('updatefound', installing)
  installing()
  return value
}

function register(): Promise<ServiceWorkerRegistration> {
  // Transient preparation failures must not permanently disable explicit retries.
  if (!supported || import.meta.env.DEV) return Promise.reject(new Error(offlineSupport.message))
  return navigator.serviceWorker.getRegistration('/').then(existing => {
    // WebKit may leave an earlier register() promise pending after activation.
    // The installed registration is the authoritative state in that case.
    if (existing) {
      registration = Promise.resolve(observeRegistration(existing))
      return existing
    }
    registration ??= withTimeout(navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }), 'A preparação offline demorou demais. Verifique a conexão e tente novamente.')
      .then(observeRegistration).catch(error => { registration = undefined; throw error })
    return registration
  })
}

function waitForController(target?: ServiceWorker): Promise<ServiceWorker> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Recarregue o aplicativo para ativar a leitura offline.')) }, TIMEOUT)
    const cleanup = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', check) }
    const check = () => {
      const controller = navigator.serviceWorker.controller
      if (controller && (!target || controller === target)) { cleanup(); resolve(controller) }
    }
    navigator.serviceWorker.addEventListener('controllerchange', check)
    check()
  })
}

function askWorker(worker: ServiceWorker, type: 'LITERA_SHELL_STATUS' | 'LITERA_ENSURE_SHELL', timeout: number): Promise<{ protocol?: number; ready?: boolean }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const cleanup = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close() }
    const timer = setTimeout(() => { cleanup(); reject(new Error(type === 'LITERA_SHELL_STATUS'
      ? 'O aplicativo ainda usa um Service Worker anterior. Aplique a atualização disponível ou feche as outras abas e reabra o Litera conectado.'
      : 'Não foi possível confirmar o aplicativo offline. Conecte-se e tente novamente.')) }, timeout)
    channel.port1.onmessage = event => {
      if (event.data?.type !== (type === 'LITERA_SHELL_STATUS' ? type : 'LITERA_SHELL_READY')) return
      cleanup()
      resolve(event.data)
    }
    try { worker.postMessage({ type }, [channel.port2]) }
    catch (error) { cleanup(); reject(error) }
  })
}

async function verifyShell(worker: ServiceWorker): Promise<void> {
  // Legacy workers ignore this protocol; fail quickly instead of waiting two minutes.
  const status = await askWorker(worker, 'LITERA_SHELL_STATUS', 5_000)
  if (status.protocol !== 1) throw new Error('Atualize o aplicativo para preparar a leitura offline.')
  const result = await askWorker(worker, 'LITERA_ENSURE_SHELL', TIMEOUT)
  if (result.ready !== true) throw new Error('O aplicativo offline está incompleto. Conecte-se para concluir a preparação.')
}

/** Downloads must await this barrier before presenting a book as available offline. */
export function ensureOfflineShell(): Promise<void> {
  preparing ??= (async () => {
    offlineSupport.ready = false
    offlineSupport.canRetry = false
    const registering = register()
    // Existing control must be checked independently of an update network request:
    // legacy workers fail in five seconds even if registration is still pending.
    void registering.catch(() => undefined)
    const controller = supported && navigator.serviceWorker.controller
    if (controller && !import.meta.env.DEV) await verifyShell(controller)
    else {
      const controlled = waitForController()
      // WebKit can expose an active controller while the register() promise is
      // still pending. Either event is enough to continue to the authoritative
      // shell protocol check; neither is treated as proof by itself.
      await Promise.race([registering.then(() => undefined), controlled.then(() => undefined)])
      if (!navigator.serviceWorker.controller) await withTimeout(navigator.serviceWorker.ready, 'Não foi possível ativar o aplicativo offline. Tente novamente conectado.')
      await verifyShell(navigator.serviceWorker.controller ?? await controlled)
    }
    offlineSupport.available = true
    offlineSupport.ready = true
    offlineSupport.message = ''
  })().catch(error => {
    // Capability is stable; readiness/error are operational state. Keeping
    // available=true lets the user retry without waiting for a network event.
    offlineSupport.available = supported && !import.meta.env.DEV
    offlineSupport.ready = false
    offlineSupport.canRetry = supported && !import.meta.env.DEV
    offlineSupport.message = error instanceof Error ? error.message : 'Não foi possível preparar o aplicativo offline.'
    throw error
  }).finally(() => { preparing = undefined })
  return preparing
}

export function showPwaUpdate(): void { if (pwaUpdate.available) pwaUpdate.promptVersion++ }

/** Check even when an already-installed registration was reused at startup. */
export function checkForPwaUpdate(force = false): Promise<void> {
  if (!offlineSupport.supported || document.visibilityState === 'hidden') return Promise.resolve()
  if (navigator.onLine === false) return force ? Promise.reject(new Error('Conecte-se para verificar atualizações.')) : Promise.resolve()
  if (updateCheck) return updateCheck
  if (!force && Date.now() - lastUpdateCheck < 30_000) return Promise.resolve()
  lastUpdateCheck = Date.now()
  pwaUpdate.checking = true
  updateCheck = withTimeout(register().then(async value => {
    await value.update()
    observeRegistration(value)
  }), 'O servidor demorou para responder à verificação de atualização.', 30_000).finally(() => { updateCheck = undefined; pwaUpdate.checking = false })
  return updateCheck
}

export function initializePwa(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    pwaInstall.prompt = event as InstallPromptEvent
    pwaInstall.available = true
  })
  window.addEventListener('appinstalled', () => {
    pwaInstall.available = false; pwaInstall.installed = true; pwaInstall.prompt = undefined
  })
  if (!offlineSupport.available) return
  const check = () => { void checkForPwaUpdate().catch(() => undefined) }
  const reconnect = () => {
    void checkForPwaUpdate(true).catch(() => undefined)
    if (!offlineSupport.ready) void ensureOfflineShell().catch(() => undefined)
  }
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', check)
  window.addEventListener('online', reconnect)
  setInterval(check, 60_000)
  // Do not block mounting or require a book download to install the shell.
  void ensureOfflineShell().catch(() => undefined)
  check()
}

export async function installPwa(): Promise<boolean> {
  const prompt = pwaInstall.prompt
  if (!prompt) return false // Safari installation is explained by the UI.
  await prompt.prompt()
  const accepted = (await prompt.userChoice).outcome === 'accepted'
  pwaInstall.prompt = undefined; pwaInstall.available = false
  if (accepted) pwaInstall.installed = true
  return accepted
}

/** Call only after explicit consent and after persisting the reader's local state. */
export async function applyPwaUpdate(): Promise<void> {
  if (pwaUpdate.applying) return
  pwaUpdate.applying = true
  try {
    const value = await register()
    const waiting = value.waiting
    if (!waiting) { pwaUpdate.available = false; return }
    const controlled = waitForController(waiting)
    waiting.postMessage({ type: 'LITERA_APPLY_UPDATE' })
    await controlled
    pwaUpdate.available = false
    window.location.reload()
  } finally { pwaUpdate.applying = false }
}

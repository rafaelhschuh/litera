import { nextTick, reactive } from 'vue'

type NativeTransition = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition: () => void }
type MotionDocument = Document & { startViewTransition?: (update: () => Promise<void>) => NativeTransition }
type BookOrigin = { path: string; key?: string }
type Motion = {
  path: string; kind: 'slide' | 'expand'; id?: number; closing?: boolean
  source?: HTMLElement; rect?: DOMRect; coverRect?: DOMRect; cover?: HTMLElement
  complete: () => void; cancel: () => void
}
export const routeMotion = reactive({ kind: 'page' as 'page' | 'slide' | 'expand', direction: 1, native: false })
const origins = reactive(new Map<number, BookOrigin>())
let current: Motion | undefined
let clickedCard: { id: number; element: HTMLElement } | undefined

export function clearNavigationMotion() { current?.cancel(); origins.clear(); clickedCard = undefined }
export function bookReturnPath(id: number) { return origins.get(id)?.path ?? '/library' }
export function bookReturnLabel(id: number) { return ({ '/': 'Início', '/library': 'Biblioteca', '/favorites': 'Favoritos', '/search': 'Busca' } as Record<string, string>)[bookReturnPath(id).split('?')[0]!.split('#')[0]!] ?? 'Voltar' }
export function moduleIndex(path: string): number {
  if (path === '/favorites') return 0
  if (path === '/library' || path.startsWith('/books/')) return 1
  if (path === '/') return 2
  if (path === '/search') return 3
  return 4
}
function ordinaryClick(event: MouseEvent) { return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !event.defaultPrevented }
function reducedMotion() { return document.documentElement.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches }
function timing() {
  const style = getComputedStyle(document.documentElement), token = style.getPropertyValue('--motion-slow').trim()
  return { duration: parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 240, easing: style.getPropertyValue('--ease-standard').trim() || 'ease-out', fill: 'both' as FillMode }
}
function visible(element: HTMLElement) { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth }
function cardFor(id: number) {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-book-card="${id}"]`)].filter(visible)
  return candidates.find(card => card.dataset.bookOrigin === origins.get(id)?.key) ?? candidates[0]
}
async function destinationElement(motion: Motion, wait = true) {
  const select = () => motion.closing ? cardFor(motion.id!) : document.querySelector<HTMLElement>(`[data-book-detail="${motion.id}"]`) ?? undefined
  if (select()) return select()
  if (!wait || typeof MutationObserver === 'undefined') return
  return new Promise<HTMLElement | undefined>(resolve => {
    const finish = () => { clearTimeout(timer); observer.disconnect(); resolve(select()) }
    const observer = new MutationObserver(() => { if (select() || current !== motion) finish() })
    const timer = window.setTimeout(finish, 800)
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

// Links keep their ordinary modified-click behavior. The router owns the full
// transaction, including browser Back and programmatic navigation.
export async function navigateModule(event: MouseEvent, from: string, to: string, navigate: () => Promise<unknown>) {
  if (!ordinaryClick(event) || from === to) return
  event.preventDefault(); await navigate()
}
export async function openBookMotion(event: MouseEvent, id: number, source: HTMLElement | undefined, navigate: () => Promise<unknown>) {
  if (!ordinaryClick(event) || !source) return
  clickedCard = { id, element: source }
  event.preventDefault(); await navigate()
}

export async function beginNavigationMotion(from: string, to: string, origin = from, targetPath = to) {
  current?.cancel()
  if (from === to || /^\/(?:login|read)(?:\/|$)/.test(from) || /^\/(?:login|read)(?:\/|$)/.test(to)) return
  const opening = to.match(/^\/books\/(\d+)$/), leaving = from.match(/^\/books\/(\d+)$/)
  const id = Number((opening ?? leaving)?.[1]), closing = !opening && Boolean(leaving)
  const source = opening ? (clickedCard?.id === id ? clickedCard.element : cardFor(id)) : leaving ? document.querySelector<HTMLElement>(`[data-book-detail="${id}"]`) ?? undefined : undefined
  clickedCard = undefined
  if (opening && source) {
    origins.delete(id); origins.set(id, { path: origin, key: source.dataset.bookOrigin })
    if (origins.size > 24) origins.delete(origins.keys().next().value!)
  }
  const morph = Boolean(source && (opening || (leaving && bookReturnPath(id) === targetPath)))
  const phone = matchMedia('(max-width: 639px)').matches
  if ((!morph && (!phone || moduleIndex(from) === moduleIndex(to))) || reducedMotion()) return
  const root = document.documentElement, previousName = root.style.viewTransitionName
  routeMotion.kind = morph ? 'expand' : 'slide'
  routeMotion.direction = moduleIndex(to) >= moduleIndex(from) ? 1 : -1
  root.style.setProperty('--module-direction', String(routeMotion.direction))
  const cleanups: Array<() => void> = []
  const name = (element: HTMLElement | undefined, value: string) => {
    if (!element) return
    const previous = element.style.viewTransitionName
    element.style.viewTransitionName = value; cleanups.push(() => { element.style.viewTransitionName = previous })
  }
  let releaseUpdate: (() => void) | undefined, releaseGuard: (() => void) | undefined, native: NativeTransition | undefined, disposed = false
  const updated = new Promise<void>(resolve => { releaseUpdate = resolve })
  const cover = source?.querySelector<HTMLElement>('.book-cover') ?? undefined
  const motion: Motion = { path: to, kind: routeMotion.kind, id: morph ? id : undefined, closing, source, rect: source?.getBoundingClientRect(), coverRect: cover?.getBoundingClientRect(), cover: cover?.cloneNode(true) as HTMLElement | undefined, complete: () => releaseUpdate?.(), cancel: () => { native?.skipTransition(); cleanup() } }
  function cleanup() {
    if (disposed) return; disposed = true
    releaseUpdate?.(); releaseGuard?.()
    for (const release of cleanups.reverse()) release()
    if (current !== motion) return
    root.style.viewTransitionName = previousName; delete root.dataset.routeMotion
    routeMotion.kind = 'page'; routeMotion.native = false; current = undefined
  }
  current = motion
  const start = (document as MotionDocument).startViewTransition
  if (!start) {
    root.dataset.routeMotion = morph ? 'book-fallback' : 'slide-fallback'
    let overlay: HTMLElement | undefined
    if (morph && motion.cover && motion.rect && motion.coverRect) {
      overlay = document.createElement('div'); overlay.className = 'book-motion-overlay'; overlay.setAttribute('aria-hidden', 'true')
      const panel = document.createElement('div'); panel.className = 'book-motion-overlay__panel'
      panel.style.cssText = `left:${motion.rect.left}px;top:${motion.rect.top}px;width:${motion.rect.width}px;height:${motion.rect.height}px`
      motion.cover.classList.add('book-motion-overlay__cover'); motion.cover.style.cssText += `;left:${motion.coverRect.left}px;top:${motion.coverRect.top}px;width:${motion.coverRect.width}px;height:${motion.coverRect.height}px;transform:none;`
      overlay.append(panel, motion.cover); document.body.append(overlay); cleanups.push(() => overlay?.remove())
      if (source) { const previous = source.style.visibility; source.style.visibility = 'hidden'; cleanups.push(() => { source.style.visibility = previous }) }
    }
    void updated.then(async () => {
      if (disposed) return
      const target = morph ? await destinationElement(motion) : undefined
      if (disposed) return
      if (overlay && target?.animate && motion.cover) {
        const targetCover = target.querySelector<HTMLElement>('.book-cover'), rect = target.getBoundingClientRect(), coverRect = targetCover?.getBoundingClientRect()
        const previous = target.style.visibility; target.style.visibility = 'hidden'; cleanups.push(() => { target.style.visibility = previous })
        const box = (rect: DOMRect) => ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
        const animations = [overlay.firstElementChild!.animate([box(motion.rect!), box(rect)], timing())]
        if (coverRect) animations.push(motion.cover.animate([box(motion.coverRect!), box(coverRect)], timing()))
        cleanups.push(() => animations.forEach(animation => animation.cancel()))
        await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
      } else if (!morph) await new Promise(resolve => window.setTimeout(resolve, timing().duration))
      cleanup()
    }).catch(cleanup)
    return
  }
  routeMotion.native = true
  root.style.viewTransitionName = 'none'; root.dataset.routeMotion = morph ? 'expand' : 'slide'
  if (morph) { name(source, 'book-surface'); name(cover, 'book-cover') }
  // Fixed chrome gets its own higher snapshot layer. Leaving it unnamed would
  // put moving card/main snapshots above the live mobile navigation.
  name(document.querySelector<HTMLElement>('.mobile-navigation') ?? undefined, 'app-navigation')
  name(document.querySelector<HTMLElement>('.app-shell>header,.admin-shell>header') ?? undefined, 'app-header')
  try {
    await new Promise<void>(resolve => {
      releaseGuard = resolve
      native = start.call(document, async () => {
        releaseGuard?.()
        await updated
        if (disposed || current !== motion) return
        if (morph) {
          const target = await destinationElement(motion, false)
          if (disposed || current !== motion) return
          name(target, 'book-surface'); name(target?.querySelector<HTMLElement>('.book-cover') ?? undefined, 'book-cover')
        }
        name(document.querySelector<HTMLElement>('.mobile-navigation') ?? undefined, 'app-navigation')
        name(document.querySelector<HTMLElement>('.app-shell>header,.admin-shell>header') ?? undefined, 'app-header')
      })
      void native.ready.catch(() => undefined); void native.updateCallbackDone.catch(() => undefined)
      void native.finished.then(cleanup, cleanup)
    })
  } catch { cleanup() }
}

export async function finishNavigationMotion(path: string, failed = false) {
  const motion = current
  if (!motion || motion.path !== path) return
  if (failed) { motion.cancel(); return }
  // Called after synchronous scroll restoration. Rendering is suspended in a
  // View Transition update: waiting for rAF here would wait for its own release.
  await nextTick()
  if (current === motion) motion.complete()
}

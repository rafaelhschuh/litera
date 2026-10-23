import { reactive } from 'vue'
import { router } from '../router'

export const navigation = reactive({ busy: false, error: '' })

export function initializeNavigation(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = () => { clearTimeout(timer); navigation.busy = false }
  router.beforeEach(() => {
    finish()
    navigation.error = ''
    timer = setTimeout(() => { navigation.busy = true }, 180)
  })
  router.afterEach(finish)
  router.onError(() => { finish(); navigation.error = 'Não foi possível abrir esta tela. Tente acessar novamente.' })

  // Load route code on intent; navigation still works when this optional hint fails.
  const attempted = new WeakSet<() => unknown>()
  function prefetch(event: Event) {
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!anchor || anchor.origin !== location.origin || anchor.target || anchor.hasAttribute('download')) return
    for (const record of router.resolve(anchor.pathname + anchor.search).matched) {
      const candidate = record.components?.default
      if (typeof candidate !== 'function' || candidate.length > 0) continue
      const load = candidate as () => Promise<unknown>
      if (attempted.has(load)) continue
      attempted.add(load)
      try { void Promise.resolve(load()).catch(() => { attempted.delete(load) }) } catch { attempted.delete(load) }
    }
  }
  document.addEventListener('pointerover', prefetch, { passive: true })
  document.addEventListener('focusin', prefetch)
}

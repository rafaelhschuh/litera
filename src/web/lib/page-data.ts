import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import { ApiError } from './api'
import { syncState } from './offline-sync'

/** Keep the last successful screen visible while checking for fresh data. */
export function usePageData<T>(fetcher: () => Promise<T>, initial?: T) {
  const data = ref<T | undefined>(initial) as Ref<T | undefined>
  const error = ref('')
  const refreshing = ref(false)
  let active = false
  let generation = 0

  async function refresh() {
    const current = ++generation
    refreshing.value = true
    error.value = ''
    try {
      const result = await fetcher()
      if (current === generation) data.value = result
    } catch (reason) {
      if (current !== generation) return
      // Authorization/removal must never leave an old protected screen visible.
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) data.value = undefined
      error.value = reason instanceof Error ? reason.message : 'Não foi possível atualizar. Tente novamente.'
    } finally {
      if (current === generation) refreshing.value = false
    }
  }
  function activate() { if (!active) { active = true; void refresh() } }
  onMounted(activate)
  onActivated(activate)
  onDeactivated(() => { active = false })
  onScopeDispose(() => { generation++; active = false })
  watch(() => syncState.online, () => { if (active) void refresh() })
  const state = computed(() => data.value !== undefined ? 'loaded' : error.value ? 'error' : 'loading')
  return { data, error, refreshing, state, refresh }
}

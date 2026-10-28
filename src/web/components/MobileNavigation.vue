<script setup lang="ts">
/* global MediaQueryList, MouseEvent */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth, signOut } from '../lib/auth'
import UiDialog from './UiDialog.vue'
import UiIcon from './UiIcon.vue'
import { navigateModule } from '../lib/navigation-motion'
import { adminDestinationActive, adminNavigation } from '../lib/admin-navigation'

const route = useRoute(), router = useRouter(), open = ref(false), panelId = useId()
const sheet = ref<InstanceType<typeof UiDialog>>()
const panel = ref<'main' | 'admin'>('main')
const inAdministration = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'))
const tabs = [
  { label: 'Favoritos', icon: 'heart', to: '/favorites' },
  { label: 'Biblioteca', icon: 'library', to: '/library' },
  { label: 'Início', icon: 'home', to: '/' },
  { label: 'Busca', icon: 'search', to: '/search' },
]
const destinations = computed(() => [
  { label: 'Autores', icon: 'user', to: '/authors' },
  { label: 'Séries', icon: 'series', to: '/series' },
  { label: 'Gêneros', icon: 'tag', to: '/genres' },
  { label: 'Configurações', icon: 'settings', to: '/settings' },
])
function isDestination(path: string) { return route.path === path || route.path.startsWith(path + '/') }
const active = computed(() => {
  if (open.value || inAdministration.value || destinations.value.some(item => isDestination(item.to))) return 4
  if (route.path.startsWith('/books/')) return 1
  return Math.max(0, tabs.findIndex(tab => tab.to === route.path))
})
watch(() => route.fullPath, () => { open.value = false })
watch(panel, async () => { if (open.value) { await nextTick(); sheet.value?.focusTitle() } })
watch(() => auth.user?.role, role => { if (role !== 'admin') { panel.value = 'main'; open.value = false } })
function toggleMore() {
  if (open.value) { open.value = false; return }
  panel.value = inAdministration.value && auth.user?.role === 'admin' ? 'admin' : 'main'
  open.value = true
}
let media: MediaQueryList | undefined
function resize() { if (media?.matches) open.value = false }
onMounted(() => { media = window.matchMedia('(min-width: 640px)'); media.addEventListener?.('change', resize) })
onBeforeUnmount(() => media?.removeEventListener?.('change', resize))
async function logout() { open.value = false; await signOut(); await router.push('/login') }
function navigate(event: MouseEvent, to: string) {
  if (route.path === to && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault(); void sheet.value?.close(); return
  }
  void navigateModule(event, route.path, to, async () => { if (open.value) await sheet.value?.close(); return router.push(to) }).catch(error => window.console.error('Falha ao navegar', error))
}
</script>

<template>
  <nav class="mobile-navigation" aria-label="Navegação inferior" :style="{ '--active-tab': active }">
    <span class="mobile-navigation__selection" aria-hidden="true" />
    <RouterLink v-for="(tab, index) in tabs" :key="tab.to" :to="tab.to" :class="{ 'is-selected': active === index }" :aria-current="active === index ? 'page' : undefined" @click.capture="navigate($event, tab.to)"><UiIcon :name="tab.icon" /><span>{{ tab.label }}</span></RouterLink>
    <button :class="{ 'is-selected': active === 4 }" :aria-current="active === 4 ? 'page' : undefined" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="toggleMore"><UiIcon name="more" /><span>Outros</span></button>
  </nav>
  <UiDialog :id="panelId" ref="sheet" :open="open" :title="panel === 'admin' ? 'Administração' : 'Outros'" variant="sheet" @close="open = false">
    <nav v-if="panel === 'admin' && auth.user?.role === 'admin'" class="more-navigation" aria-label="Navegação administrativa">
      <button class="more-navigation__back" @click="panel = 'main'"><UiIcon name="arrow-left" /><span>Voltar para Outros</span></button>
      <template v-for="item in adminNavigation" :key="item.to">
        <h3 v-if="item.section" class="more-navigation__section">{{ item.section }}</h3>
        <RouterLink :to="item.to" :aria-current="adminDestinationActive(route.path, item.to) ? 'page' : undefined" @click.capture="navigate($event, item.to)"><UiIcon :name="item.icon" /><span>{{ item.label }}</span><UiIcon :name="adminDestinationActive(route.path, item.to) ? 'check' : 'chevron-right'" /></RouterLink>
      </template>
    </nav>
    <nav v-else class="more-navigation" aria-label="Mais opções">
      <RouterLink v-for="item in destinations" :key="item.to" :to="item.to" :aria-current="isDestination(item.to) ? 'page' : undefined" @click.capture="navigate($event, item.to)"><UiIcon :name="item.icon" /><span>{{ item.label }}</span><UiIcon v-if="isDestination(item.to)" name="check" /><UiIcon v-else name="chevron-right" /></RouterLink>
      <button v-if="auth.user?.role === 'admin'" :aria-current="inAdministration ? 'page' : undefined" @click="panel = 'admin'"><UiIcon name="admin" /><span>Administração</span><UiIcon name="chevron-right" /></button>
      <button class="more-navigation__logout" @click="logout"><UiIcon name="logout" /><span>Sair</span></button>
    </nav>
  </UiDialog>
</template>

<script setup lang="ts">
/* global MediaQueryList, MouseEvent */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth, signOut } from '../lib/auth'
import UiDialog from './UiDialog.vue'
import UiIcon from './UiIcon.vue'
import { navigateModule } from '../lib/navigation-motion'

const route = useRoute(), router = useRouter(), open = ref(false), panelId = useId()
const sheet = ref<InstanceType<typeof UiDialog>>()
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
  ...(auth.user?.role === 'admin' ? [{ label: 'Administração', icon: 'admin', to: '/admin' }] : []),
])
function isDestination(path: string) { return route.path === path || route.path.startsWith(path + '/') }
const active = computed(() => {
  if (open.value || destinations.value.some(item => isDestination(item.to))) return 4
  if (route.path.startsWith('/books/')) return 1
  return Math.max(0, tabs.findIndex(tab => tab.to === route.path))
})
watch(() => route.fullPath, () => { open.value = false })
let media: MediaQueryList | undefined
function resize() { if (media?.matches) open.value = false }
onMounted(() => { media = window.matchMedia('(min-width: 640px)'); media.addEventListener?.('change', resize) })
onBeforeUnmount(() => media?.removeEventListener?.('change', resize))
async function logout() { open.value = false; await signOut(); await router.push('/login') }
function navigate(event: MouseEvent, to: string) { void navigateModule(event, route.path, to, async () => { if (open.value) await sheet.value?.close(); return router.push(to) }).catch(error => window.console.error('Falha ao navegar', error)) }
</script>

<template>
  <nav class="mobile-navigation" aria-label="Navegação inferior" :style="{ '--active-tab': active }">
    <span class="mobile-navigation__selection" aria-hidden="true" />
    <RouterLink v-for="(tab, index) in tabs" :key="tab.to" :to="tab.to" :class="{ 'is-selected': active === index }" :aria-current="active === index ? 'page' : undefined" @click.capture="navigate($event, tab.to)"><UiIcon :name="tab.icon" /><span>{{ tab.label }}</span></RouterLink>
    <button :class="{ 'is-selected': active === 4 }" :aria-current="active === 4 ? 'page' : undefined" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="open = !open"><UiIcon name="more" /><span>Outros</span></button>
  </nav>
  <UiDialog :id="panelId" ref="sheet" :open="open" title="Outros" variant="sheet" @close="open = false">
    <nav class="more-navigation" aria-label="Mais opções">
      <RouterLink v-for="item in destinations" :key="item.to" :to="item.to" :aria-current="isDestination(item.to) ? 'page' : undefined" @click.capture="navigate($event, item.to)"><UiIcon :name="item.icon" /><span>{{ item.label }}</span><UiIcon v-if="isDestination(item.to)" name="check" /><UiIcon v-else name="chevron-right" /></RouterLink>
      <button class="more-navigation__logout" @click="logout"><UiIcon name="logout" /><span>Sair</span></button>
    </nav>
  </UiDialog>
</template>

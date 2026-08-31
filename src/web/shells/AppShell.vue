<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth, signOut } from '../lib/auth'
import { api } from '../lib/api'
import { applyTheme, type AppTheme } from '../lib/theme'
import UiIcon from '../components/UiIcon.vue'
const open = ref(false); const router = useRouter(); const route = useRoute(); const query = ref(''); const collapsed = ref(false)
async function logout() { await signOut(); await router.push('/login') }
function search() { if (query.value.trim()) router.push({ path: '/search', query: { q: query.value.trim() } }) }
function toggleCollapsed(){collapsed.value=!collapsed.value;window.localStorage.setItem(`litera-sidebar-${auth.user?.id||'user'}`,String(collapsed.value))}
function closeNavigation(){open.value=false}
function onKey(event:any){if(event.key==='Escape')closeNavigation()}
watch(()=>route.fullPath,closeNavigation)
watch(open,value=>{document.documentElement.classList.toggle('nav-drawer-open',value)})
onMounted(async()=>{window.addEventListener('keydown',onKey);collapsed.value=window.localStorage.getItem(`litera-sidebar-${auth.user?.id||'user'}`)==='true';try{const result=await api<any>('/api/v1/settings');applyTheme(result.preferences.appTheme as AppTheme)}catch{/* Cached/system theme stays usable while offline. */}})
onBeforeUnmount(()=>{window.removeEventListener('keydown',onKey);document.documentElement.classList.remove('nav-drawer-open')})
</script>
<template>
  <div class="app-shell" :class="{ 'app-shell--collapsed': collapsed }">
    <a class="skip-link" href="#main">Pular para o conteúdo</a>
    <header class="topbar"><button class="icon-button nav-toggle" aria-label="Abrir navegação" aria-controls="primary-navigation" :aria-expanded="open" @click="open = !open"><UiIcon name="menu" /></button><RouterLink class="wordmark" to="/">LITERA</RouterLink><form class="global-search search-input" role="search" @submit.prevent="search"><UiIcon name="search" /><label class="sr-only" for="global-q">Buscar livros</label><input id="global-q" v-model="query" type="search" placeholder="Buscar no acervo" /><button v-if="query" class="icon-button" type="button" aria-label="Limpar busca" @click="query=''"><UiIcon name="x" :size="16" /></button></form><div class="topbar__actions"><RouterLink class="icon-button mobile-search" to="/search" aria-label="Buscar no acervo"><UiIcon name="search" /></RouterLink><RouterLink class="avatar-button" to="/settings" :aria-label="`Preferências de ${auth.user?.displayName}`">{{ auth.user?.displayName?.slice(0,1).toUpperCase() }}</RouterLink></div></header>
    <button v-if="open" class="drawer-backdrop" aria-label="Fechar navegação" @click="closeNavigation" />
    <aside id="primary-navigation" class="sidebar" :class="{ 'sidebar--open': open }"><div><div class="sidebar__heading"><span>Biblioteca</span><button class="icon-button drawer-close" aria-label="Fechar navegação" @click="closeNavigation"><UiIcon name="x" /></button><button class="icon-button collapse-button" :aria-label="collapsed?'Expandir navegação':'Recolher navegação'" @click="toggleCollapsed"><UiIcon :name="collapsed?'chevron-right':'chevron-left'" /></button></div><nav aria-label="Principal" @click="closeNavigation"><RouterLink to="/" title="Início"><UiIcon name="home" /><span>Início</span></RouterLink><RouterLink to="/library" title="Biblioteca"><UiIcon name="library" /><span>Biblioteca</span></RouterLink><RouterLink to="/search" title="Busca"><UiIcon name="search" /><span>Busca</span></RouterLink><p class="nav-label">Explorar</p><RouterLink to="/authors" title="Autores"><UiIcon name="user" /><span>Autores</span></RouterLink><RouterLink to="/series" title="Séries"><UiIcon name="series" /><span>Séries</span></RouterLink><RouterLink to="/genres" title="Gêneros"><UiIcon name="tag" /><span>Gêneros</span></RouterLink><RouterLink to="/favorites" title="Favoritos"><UiIcon name="heart" /><span>Favoritos</span></RouterLink></nav></div><div class="sidebar__account"><RouterLink to="/settings" title="Preferências"><UiIcon name="settings" /><span>Preferências</span></RouterLink><RouterLink v-if="auth.user?.role === 'admin'" to="/admin" title="Administração"><UiIcon name="admin" /><span>Administração</span></RouterLink><button title="Sair" @click="logout"><UiIcon name="logout" /><span>Sair</span></button></div></aside>
    <main id="main" class="page"><RouterView /></main>
  </div>
</template>

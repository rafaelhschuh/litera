<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import AppState from '../components/AppState.vue'
import { syncState } from '../lib/offline-sync'

const open=ref(false);const route=useRoute()
function closeNavigation(){open.value=false}
function onKey(event:any){if(event.key==='Escape')closeNavigation()}
watch(()=>route.fullPath,closeNavigation)
watch(open,value=>document.documentElement.classList.toggle('nav-drawer-open',value))
onMounted(()=>window.addEventListener('keydown',onKey))
onBeforeUnmount(()=>{window.removeEventListener('keydown',onKey);document.documentElement.classList.remove('nav-drawer-open')})
</script>
<template>
  <div class="admin-shell">
    <a class="skip-link" href="#main">Pular para o conteúdo</a>
    <header><button class="icon-button admin-nav-toggle" aria-label="Abrir menu administrativo" aria-controls="admin-navigation" :aria-expanded="open" @click="open=!open"><UiIcon name="menu" /></button><RouterLink class="wordmark" to="/admin">LITERA <small>ADMIN</small></RouterLink><RouterLink class="button button--quiet admin-back" to="/"><UiIcon name="chevron-left" /><span>Biblioteca</span></RouterLink></header>
    <button v-if="open" class="drawer-backdrop" aria-label="Fechar menu administrativo" @click="closeNavigation" />
    <aside id="admin-navigation" :class="{'admin-navigation--open':open}"><div class="admin-drawer-heading"><p class="nav-label">Administração</p><button class="icon-button" aria-label="Fechar menu administrativo" @click="closeNavigation"><UiIcon name="x" /></button></div><nav aria-label="Administração" @click="closeNavigation"><RouterLink to="/admin"><UiIcon name="home" /><span>Visão geral</span></RouterLink><RouterLink to="/admin/libraries"><UiIcon name="library" /><span>Bibliotecas</span></RouterLink><RouterLink to="/admin/users"><UiIcon name="users" /><span>Usuários</span></RouterLink><RouterLink to="/admin/metadata"><UiIcon name="sparkles" /><span>Metadata</span></RouterLink><RouterLink to="/admin/jobs"><UiIcon name="refresh" /><span>Jobs</span></RouterLink><p class="nav-label">Sistema</p><RouterLink to="/admin/compatibility"><UiIcon name="monitor" /><span>Compatibilidade</span></RouterLink><RouterLink to="/admin/system"><UiIcon name="settings" /><span>Sistema</span></RouterLink></nav></aside>
    <main id="main"><AppState v-if="!syncState.online" kind="empty" title="Administração requer conexão" message="Você pode continuar lendo os livros salvos no dispositivo."><RouterLink to="/library">Abrir biblioteca offline</RouterLink></AppState><RouterView v-else /></main>
  </div>
</template>

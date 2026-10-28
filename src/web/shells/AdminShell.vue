<script setup lang="ts">
/* global MediaQueryList */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import UiIcon from '../components/UiIcon.vue'
import AppState from '../components/AppState.vue'
import RouteContent from '../components/RouteContent.vue'
import MobileNavigation from '../components/MobileNavigation.vue'
import { syncState } from '../lib/offline-sync'
import { adminDestinationActive, adminNavigation } from '../lib/admin-navigation'

const open=ref(false);const route=useRoute()
let tablet: MediaQueryList | undefined
function breakpointChanged() { closeNavigation() }
function closeNavigation(){open.value=false}
function onKey(event:any){if(event.key==='Escape')closeNavigation()}
watch(()=>route.fullPath,closeNavigation)
watch(open,value=>document.documentElement.classList.toggle('nav-drawer-open',value))
onMounted(()=>{window.addEventListener('keydown',onKey);tablet=window.matchMedia('(min-width:640px) and (max-width:899px)');tablet.addEventListener?.('change',breakpointChanged)})
onBeforeUnmount(()=>{window.removeEventListener('keydown',onKey);tablet?.removeEventListener?.('change',breakpointChanged);document.documentElement.classList.remove('nav-drawer-open')})
</script>
<template>
  <div class="admin-shell">
    <a class="skip-link" href="#main">Pular para o conteúdo</a>
    <header><button class="icon-button admin-nav-toggle" aria-label="Abrir menu administrativo" aria-controls="admin-navigation" :aria-expanded="open" @click="open=!open"><UiIcon name="menu" /></button><RouterLink class="wordmark" to="/admin">LITERA <small>ADMIN</small></RouterLink><RouterLink class="button button--quiet admin-back" to="/" aria-label="Voltar à biblioteca"><UiIcon name="chevron-left" /><span>Biblioteca</span></RouterLink></header>
    <Transition name="backdrop"><button v-if="open" class="drawer-backdrop" aria-label="Fechar menu administrativo" @click="closeNavigation" /></Transition>
    <aside id="admin-navigation" :class="{'admin-navigation--open':open}"><div class="admin-drawer-heading"><p class="nav-label">Administração</p><button class="icon-button" aria-label="Fechar menu administrativo" @click="closeNavigation"><UiIcon name="x" /></button></div><nav aria-label="Administração" @click="closeNavigation"><template v-for="item in adminNavigation" :key="item.to"><p v-if="item.section" class="nav-label">{{ item.section }}</p><RouterLink :to="item.to" :class="{'is-selected':adminDestinationActive(route.path,item.to)}" :aria-current="adminDestinationActive(route.path,item.to)?'page':undefined"><UiIcon :name="item.icon" /><span>{{ item.label }}</span></RouterLink></template></nav></aside>
    <main id="main"><AppState v-if="!syncState.online" kind="empty" title="Administração requer conexão" message="Você pode continuar lendo os livros salvos no dispositivo."><RouterLink to="/library">Abrir biblioteca offline</RouterLink></AppState><RouteContent v-else /></main>
    <MobileNavigation />
  </div>
</template>

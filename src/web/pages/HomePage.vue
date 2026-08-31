<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppState from '../components/AppState.vue'; import BookGrid from '../components/BookGrid.vue'; import { api } from '../lib/api'
const state = ref<'loading'|'loaded'|'error'>('loading'); const home = ref<{ continueReading: any[]; recentlyAdded: any[] }>({ continueReading: [], recentlyAdded: [] })
async function load() { state.value='loading'; try { home.value=await api('/api/v1/home'); state.value='loaded' } catch { state.value='error' } }
async function remove(id:number){await api(`/api/v1/books/${id}/continue`,{method:'DELETE'});home.value.continueReading=home.value.continueReading.filter(book=>book.id!==id)}
onMounted(load)
</script>
<template><div><header class="page-header"><p class="eyebrow">Sala de leitura</p><h1>Bem-vindo de volta</h1><p>Escolha onde a leitura continua hoje.</p></header><AppState v-if="state==='loading'" kind="loading" /><AppState v-else-if="state==='error'" kind="error" title="Não foi possível carregar seu acervo" message="Confira a conexão e tente novamente."><button class="text-link" @click="load">Tentar novamente</button></AppState><template v-else><section v-if="home.continueReading.length" class="catalog-section"><header><h2>Continuar leitura</h2><RouterLink to="/library">Ver biblioteca</RouterLink></header><BookGrid :books="home.continueReading" compact @remove="remove" /></section><section class="catalog-section"><header><h2>Adicionados recentemente</h2><RouterLink to="/library">Ver todos</RouterLink></header><BookGrid v-if="home.recentlyAdded.length" :books="home.recentlyAdded" /><AppState v-else kind="empty" title="A estante está pronta" message="Peça a um administrador para cadastrar e escanear uma pasta de livros." /></section></template></div></template>

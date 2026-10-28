<script setup lang="ts">
import { computed } from 'vue'
import AppState from '../components/AppState.vue'
import BookGrid from '../components/BookGrid.vue'
import PageRefresh from '../components/PageRefresh.vue'
import { api } from '../lib/api'
import { preparedHome, type HomeData } from '../lib/catalog-warmup'
import { usePageData } from '../lib/page-data'
import { syncState } from '../lib/offline-sync'
const { data, state, error, refreshing, refresh: load } = usePageData(() => api<HomeData>('/api/v1/home'), preparedHome())
const home = computed(() => data.value ?? { continueReading: [], recentlyAdded: [] })
async function remove(id: number) {
  try { await api(`/api/v1/books/${id}/continue`, { method: 'DELETE' }); if (data.value) data.value = { ...data.value, continueReading: data.value.continueReading.filter(book => book.id !== id) } }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível remover o livro.' }
}
</script>
<template>
  <div :aria-busy="refreshing">
    <header class="page-header"><h1>Início</h1></header>
    <PageRefresh :busy="refreshing" :error="state==='loaded' ? error : ''" @retry="load" />
    <AppState v-if="state==='loading'" kind="loading" layout="catalog" />
    <AppState v-else-if="state==='error'" kind="error" title="Não foi possível carregar seu acervo" message="Confira a conexão e tente novamente."><button class="text-link" @click="load">Tentar novamente</button></AppState>
    <template v-else>
      <section v-if="home.continueReading.length" class="catalog-section"><header><h2>Continuar leitura</h2><RouterLink to="/library">Ver biblioteca</RouterLink></header><BookGrid :books="home.continueReading" compact :read-only="!syncState.online" @remove="remove" /></section>
      <section class="catalog-section"><header><h2>{{ syncState.online ? 'Adicionados recentemente' : 'Disponíveis offline' }}</h2><RouterLink to="/library">Ver todos</RouterLink></header><BookGrid v-if="home.recentlyAdded.length" :books="home.recentlyAdded" /><AppState v-else kind="empty" :title="syncState.online ? 'Nenhum livro na biblioteca' : 'Você ainda não tem livros disponíveis offline'" :message="syncState.online ? 'Peça a um administrador para cadastrar e escanear uma pasta de livros.' : 'Conecte-se, abra um livro e escolha Salvar para offline.'" /></section>
    </template>
  </div>
</template>

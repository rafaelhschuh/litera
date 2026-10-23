<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppState from '../components/AppState.vue'
import BookGrid from '../components/BookGrid.vue'
import PageRefresh from '../components/PageRefresh.vue'
import { api } from '../lib/api'
import { usePageData } from '../lib/page-data'
const route = useRoute(), router = useRouter()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const submitted = ref(q.value)
const { data, state, error, refreshing, refresh } = usePageData(async () => {
  const query = submitted.value.trim()
  return query ? { books: (await api<{books: any[]}>(`/api/v1/books?q=${encodeURIComponent(query)}`)).books, query } : { books: [], query }
})
const books = computed(() => data.value?.books ?? [])
async function search() {
  submitted.value = q.value.trim()
  await router.replace({ query: submitted.value ? { q: submitted.value } : {} })
  await refresh()
}
watch(() => route.query.q, value => {
  if (route.path !== '/search') return
  const next = typeof value === 'string' ? value : ''
  if (next !== submitted.value) { q.value = next; submitted.value = next; void refresh() }
})
</script>
<template><div :aria-busy="refreshing"><header class="page-header"><p class="eyebrow">Encontre sua próxima leitura</p><h1>Busca</h1></header><form class="search-hero" role="search" @submit.prevent="search"><label for="search-q">Título ou autor</label><div><input id="search-q" v-model="q" type="search" placeholder="Ex.: Machado de Assis" autofocus /><button class="button button--primary">Buscar</button></div></form><PageRefresh :busy="refreshing" :error="state==='loaded' ? error : ''" @retry="refresh" /><AppState v-if="!submitted" kind="empty" title="O acervo está à sua espera" message="Busque pelo título ou pelo nome do autor." /><AppState v-else-if="state==='loading'" kind="loading" layout="catalog" /><AppState v-else-if="state==='error'" kind="error" title="A busca não pôde ser concluída"><button @click="search">Tentar novamente</button></AppState><section v-else><h2>{{ books.length }} {{ books.length===1?'livro encontrado':'livros encontrados' }}</h2><BookGrid v-if="books.length" :books="books" /><AppState v-else kind="empty" title="Nenhum resultado" message="Tente um termo mais curto ou confira a grafia." /></section></div></template>

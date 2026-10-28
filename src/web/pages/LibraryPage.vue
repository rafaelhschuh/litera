<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppState from '../components/AppState.vue'
import BookGrid from '../components/BookGrid.vue'
import PageRefresh from '../components/PageRefresh.vue'
import UiField from '../components/UiField.vue'
import UiIcon from '../components/UiIcon.vue'
import { api } from '../lib/api'
import { usePageData } from '../lib/page-data'
import { syncState } from '../lib/offline-sync'

const props = withDefaults(defineProps<{ filterKind?: 'author' | 'series' | 'genre' | 'favorite'; filterValue?: string }>(), { filterKind: undefined, filterValue: undefined })
const q = ref('')
const format = ref('')
const sort = ref('title')
const page = ref(1)
const filtersOpen = ref(false)
const activeFilters = computed(() => Number(Boolean(format.value)) + Number(sort.value !== 'title'))
const title = computed(() => props.filterKind === 'favorite' ? 'Favoritos' : props.filterValue ? String(props.filterValue) : 'Biblioteca')
const { data, state, error, refreshing, refresh } = usePageData(async () => {
  const params = new globalThis.URLSearchParams({ page: String(page.value), pageSize: '24', sort: sort.value })
  if (q.value) params.set('q', q.value)
  if (format.value) params.set('format', format.value)
  if (props.filterKind && props.filterValue) params.set(props.filterKind, props.filterValue)
  return api<{ books: any[]; pagination: { total: number; pages: number; page: number } }>(`/api/v1/books?${params}`)
})
const books = computed(() => data.value?.books ?? [])
const pages = computed(() => data.value?.pagination.pages ?? 1)
const total = computed(() => data.value?.pagination.total ?? 0)
async function load(reset = false) { if (reset) page.value = 1; await refresh() }
async function move(delta: number) {
  const previous = page.value
  page.value = Math.min(pages.value, Math.max(1, previous + delta))
  await refresh()
  if (error.value) page.value = previous
}
watch([format, sort], () => { void load(true) })
</script>

<template>
  <div :aria-busy="refreshing">
    <header class="page-header" :class="{ 'page-header--tab': !filterKind || filterKind === 'favorite' }"><h1>{{ title }}</h1></header>
    <form class="catalog-toolbar catalog-toolbar--compact" role="search" @submit.prevent="load(true)">
      <div class="search-input catalog-search">
        <button type="submit" class="icon-button" aria-label="Buscar"><UiIcon name="search" /></button>
        <label class="sr-only" for="library-q">Buscar nesta lista</label><input id="library-q" v-model="q" type="search" placeholder="Título ou autor" enterkeyhint="search" />
      </div>
      <button type="button" class="icon-button catalog-filter-toggle" :class="{ 'is-active': activeFilters || filtersOpen }" :aria-label="activeFilters ? `Filtros e ordenação, ${activeFilters} ajustes ativos` : 'Filtros e ordenação'" :aria-expanded="filtersOpen" aria-controls="catalog-filter-fields" @click="filtersOpen = !filtersOpen"><UiIcon name="filter" /><span v-if="activeFilters" class="catalog-filter-count">{{ activeFilters }}</span></button>
      <div id="catalog-filter-fields" class="catalog-filter-fields" :class="{ 'is-open': filtersOpen }">
        <UiField label="Formato" for-id="library-format"><select id="library-format" v-model="format"><option value="">Todos os formatos</option><option value="epub">EPUB</option><option value="pdf">PDF</option></select></UiField>
        <UiField label="Ordenação" for-id="library-sort"><select id="library-sort" v-model="sort"><option value="title">Título</option><option value="author">Autor</option><option value="recent">Mais recentes</option></select></UiField>
      </div>
    </form>
    <p v-if="state === 'loaded'" class="catalog-summary" aria-live="polite">{{ total }} {{ total === 1 ? 'livro' : 'livros' }}</p>
    <PageRefresh :busy="refreshing" :error="state==='loaded' ? error : ''" @retry="load()" />
    <AppState v-if="state === 'loading'" kind="loading" layout="catalog" />
    <AppState v-else-if="state === 'error'" kind="error" title="Não foi possível carregar a biblioteca" message="Confira a conexão e tente novamente."><button class="button button--secondary" @click="load()">Tentar novamente</button></AppState>
    <BookGrid v-else-if="books.length" :books="books" />
    <AppState v-else kind="empty" :title="q ? 'Nenhum livro encontrado' : !syncState.online ? 'Você ainda não tem livros disponíveis offline' : 'Nenhum livro nesta seção'" :message="q ? 'Revise o título ou autor pesquisado.' : !syncState.online ? 'Conecte-se e escolha Salvar para offline na página de um livro.' : 'Quando houver livros correspondentes, eles aparecerão aqui.'" />
    <nav v-if="pages > 1" class="pagination" aria-label="Paginação"><button class="button button--secondary" :disabled="refreshing || page === 1" @click="move(-1)">Anterior</button><span>Página {{ page }} de {{ pages }}</span><button class="button button--secondary" :disabled="refreshing || page === pages" @click="move(1)">Próxima</button></nav>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppState from '../components/AppState.vue'
import BookGrid from '../components/BookGrid.vue'
import { api } from '../lib/api'
import { syncState } from '../lib/offline-sync'

const props = withDefaults(defineProps<{ filterKind?: 'author' | 'series' | 'genre' | 'favorite'; filterValue?: string }>(), { filterKind: undefined, filterValue: undefined })
const books = ref<any[]>([])
const state = ref<'loading' | 'loaded' | 'error'>('loading')
const q = ref('')
const format = ref('')
const sort = ref('title')
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const title = computed(() => props.filterKind === 'favorite' ? 'Favoritos' : props.filterValue ? String(props.filterValue) : 'Biblioteca')
const eyebrow = computed(() => props.filterKind === 'author' ? 'Livros deste autor' : props.filterKind === 'series' ? 'Livros desta série' : props.filterKind === 'genre' ? 'Livros deste gênero' : 'Acervo completo')

async function load(reset = false) {
  if (reset) page.value = 1
  state.value = 'loading'
  const params = new globalThis.URLSearchParams({ page: String(page.value), pageSize: '24', sort: sort.value })
  if (q.value) params.set('q', q.value)
  if (format.value) params.set('format', format.value)
  if (props.filterKind && props.filterValue) params.set(props.filterKind, props.filterValue)
  try {
    const result = await api<{ books: any[]; pagination: { total: number; pages: number } }>(`/api/v1/books?${params}`)
    books.value = result.books; total.value = result.pagination.total; pages.value = result.pagination.pages; state.value = 'loaded'
  } catch { state.value = 'error' }
}
function move(delta: number) { page.value = Math.min(pages.value, Math.max(1, page.value + delta)); void load() }
watch([format, sort], () => { void load(true) })
watch(() => syncState.online, () => { void load(true) })
onMounted(() => load())
</script>

<template>
  <div>
    <header class="page-header"><p class="eyebrow">{{ eyebrow }}</p><h1>{{ title }}</h1><p>{{ total }} {{ total === 1 ? 'livro disponível' : 'livros disponíveis' }}.</p></header>
    <form class="catalog-toolbar" role="search" @submit.prevent="load(true)">
      <label class="sr-only" for="library-q">Buscar nesta lista</label><input id="library-q" v-model="q" type="search" placeholder="Título ou autor" />
      <label class="sr-only" for="library-format">Formato</label><select id="library-format" v-model="format"><option value="">Todos os formatos</option><option value="epub">EPUB</option><option value="pdf">PDF</option></select>
      <label class="sr-only" for="library-sort">Ordenação</label><select id="library-sort" v-model="sort"><option value="title">Título</option><option value="author">Autor</option><option value="recent">Mais recentes</option></select>
      <button class="button button--secondary">Buscar</button>
    </form>
    <AppState v-if="state === 'loading'" kind="loading" />
    <AppState v-else-if="state === 'error'" kind="error" title="Não foi possível carregar a biblioteca" message="Tente novamente; seu progresso não foi afetado."><button class="button button--secondary" @click="load()">Tentar novamente</button></AppState>
    <BookGrid v-else-if="books.length" :books="books" />
    <AppState v-else kind="empty" :title="q ? 'Nenhum livro encontrado' : !syncState.online ? 'Você ainda não tem livros disponíveis offline' : 'Nenhum livro nesta seção'" :message="q ? 'Revise o título ou autor pesquisado.' : !syncState.online ? 'Conecte-se e escolha Salvar para offline na página de um livro.' : 'Quando houver livros correspondentes, eles aparecerão aqui.'" />
    <nav v-if="pages > 1" class="pagination" aria-label="Paginação"><button class="button button--secondary" :disabled="page === 1" @click="move(-1)">Anterior</button><span>Página {{ page }} de {{ pages }}</span><button class="button button--secondary" :disabled="page === pages" @click="move(1)">Próxima</button></nav>
  </div>
</template>

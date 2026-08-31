<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppState from '../components/AppState.vue'
import { api } from '../lib/api'

const props = defineProps<{ kind: 'authors' | 'series' | 'genres' }>()
const items = ref<Array<{ name: string; bookCount: number }>>([])
const state = ref<'loading' | 'loaded' | 'error'>('loading')
const title = computed(() => props.kind === 'authors' ? 'Autores' : props.kind === 'series' ? 'Séries' : 'Gêneros')
onMounted(async () => { try { const result = await api<any>(`/api/v1/catalog/${props.kind}`); items.value = result[props.kind]; state.value = 'loaded' } catch { state.value = 'error' } })
</script>

<template><div><header class="page-header"><p class="eyebrow">Explore o acervo</p><h1>{{ title }}</h1><p>Entre por uma coleção para encontrar sua próxima leitura.</p></header><AppState v-if="state === 'loading'" kind="loading" /><AppState v-else-if="state === 'error'" kind="error" title="Não foi possível carregar esta coleção" /><ul v-else-if="items.length" class="taxonomy-list"><li v-for="item in items" :key="item.name"><RouterLink :to="`/${kind}/${encodeURIComponent(item.name)}`"><strong>{{ item.name }}</strong><span>{{ item.bookCount }} {{ item.bookCount === 1 ? 'livro' : 'livros' }}</span></RouterLink></li></ul><AppState v-else kind="empty" :title="`Nenhum item em ${title.toLocaleLowerCase()}`" message="Os metadados locais e enriquecidos aparecerão aqui após os scans." /></div></template>

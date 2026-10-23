<script setup lang="ts">
import { computed } from 'vue'
import AppState from '../components/AppState.vue'
import PageRefresh from '../components/PageRefresh.vue'
import { api } from '../lib/api'
import { usePageData } from '../lib/page-data'
const props = defineProps<{ kind: 'authors' | 'series' | 'genres' }>()
const { data, state, error, refreshing, refresh } = usePageData(async () => (await api<Record<string, Array<{ name: string; bookCount: number }>>>(`/api/v1/catalog/${props.kind}`))[props.kind]!)
const items = computed(() => data.value ?? [])
const title = computed(() => props.kind === 'authors' ? 'Autores' : props.kind === 'series' ? 'Séries' : 'Gêneros')
</script>

<template><div :aria-busy="refreshing"><header class="page-header"><p class="eyebrow">Explore o acervo</p><h1>{{ title }}</h1><p>Entre por uma coleção para encontrar sua próxima leitura.</p></header><PageRefresh :busy="refreshing" :error="state==='loaded' ? error : ''" @retry="refresh" /><AppState v-if="state === 'loading'" kind="loading" /><AppState v-else-if="state === 'error'" kind="error" title="Não foi possível carregar esta coleção"><button class="text-link" @click="refresh">Tentar novamente</button></AppState><ul v-else-if="items.length" class="taxonomy-list"><li v-for="item in items" :key="item.name"><RouterLink :to="`/${kind}/${encodeURIComponent(item.name)}`"><strong>{{ item.name }}</strong><span>{{ item.bookCount }} {{ item.bookCount === 1 ? 'livro' : 'livros' }}</span></RouterLink></li></ul><AppState v-else kind="empty" :title="`Nenhum item em ${title.toLocaleLowerCase()}`" message="Os metadados locais e enriquecidos aparecerão aqui após os scans." /></div></template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listOfflineBooks, type OfflineBook } from '../lib/offline-store'
import { getOfflineUser } from '../lib/offline-context'
import { offlineSupport, removeBookOffline } from '../lib/pwa'

const books = ref<OfflineBook[]>([]), loading = ref(true), error = ref(''), removing = ref<number>()
const capacity = ref<number>(), browserUsage = ref<number>()
const used = computed(() => books.value.reduce((total, book) => total + book.bytes, 0))
function bytes(value: number) { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1024 / 1024) + ' MB' }
async function refresh() {
  try {
    const userId = getOfflineUser()
    books.value = userId ? await listOfflineBooks(userId) : []
    const estimate = await window.navigator.storage?.estimate?.().catch(() => undefined)
    capacity.value = estimate?.quota; browserUsage.value = estimate?.usage
  } catch { error.value = 'Não foi possível consultar o armazenamento. A leitura online continua disponível.' }
  finally { loading.value = false }
}
async function remove(id: number) {
  removing.value = id; error.value = ''
  try { await removeBookOffline(id); await refresh() }
  catch { error.value = 'Não foi possível remover o download. Tente novamente.' }
  finally { removing.value = undefined }
}
onMounted(() => { void refresh(); window.addEventListener('litera-downloads-changed', refresh) })
onBeforeUnmount(() => window.removeEventListener('litera-downloads-changed', refresh))
</script>

<template>
  <div class="settings-subsection" aria-labelledby="offline-storage-title">
    <h3 id="offline-storage-title">Downloads</h3>
    <p v-if="!offlineSupport.available" class="alert">{{ offlineSupport.message }}</p>
    <p v-if="loading" role="status">Consultando livros salvos…</p>
    <template v-else>
      <p v-if="books.length">{{ books.length }} {{ books.length === 1 ? 'livro salvo' : 'livros salvos' }} · {{ bytes(used) }}</p>
      <ul v-if="books.length" class="offline-storage-list">
        <li v-for="book in books" :key="book.bookId"><div><RouterLink :to="`/books/${book.bookId}`">{{ book.metadata.title }}</RouterLink><p class="field__hint">{{ book.format.toUpperCase() }} · {{ bytes(book.bytes) }}</p></div><button class="button button--quiet" :disabled="removing === book.bookId" :aria-label="`Remover download de ${book.metadata.title}`" @click="remove(book.bookId)">{{ removing === book.bookId ? 'Removendo…' : 'Remover download' }}</button></li>
      </ul>
      <p v-else class="field__hint">Nenhum livro salvo. Use “Salvar para offline” na página de um livro.</p>
      <p v-if="books.length" class="field__hint">Remover um download preserva progresso e destaques.</p>
      <details class="settings-help"><summary>Armazenamento</summary><p v-if="capacity !== undefined && browserUsage !== undefined">Uso do site (estimativa): {{ bytes(browserUsage) }} de {{ bytes(capacity) }}.</p><p>Os downloads ficam neste navegador e são apagados ao sair da conta.</p></details>
    </template>
    <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
  </div>
</template>

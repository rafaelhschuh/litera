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
  <section class="settings-section" aria-labelledby="offline-storage-title">
    <h2 id="offline-storage-title">Offline</h2>
    <p>Livros salvos somente neste dispositivo. Remover um download preserva progresso, destaques e favoritos. Sair da conta apaga os dados locais.</p>
    <p v-if="!offlineSupport.available" class="alert">{{ offlineSupport.message }}</p>
    <p v-if="loading" role="status">Consultando livros salvos…</p>
    <template v-else>
      <p>{{ books.length }} livros salvos · {{ bytes(used) }} em conteúdo de leitura.</p>
      <p v-if="capacity !== undefined && browserUsage !== undefined" class="field__hint">Armazenamento do site: aproximadamente {{ bytes(browserUsage) }} usados de {{ bytes(capacity) }} disponibilizados pelo navegador.</p>
      <ul v-if="books.length" class="offline-storage-list">
        <li v-for="book in books" :key="book.bookId"><div><RouterLink :to="`/books/${book.bookId}`">{{ book.metadata.title }}</RouterLink><p class="field__hint">{{ book.format.toUpperCase() }} · {{ bytes(book.bytes) }}</p></div><button class="button button--quiet" :disabled="removing === book.bookId" :aria-label="`Remover download de ${book.metadata.title}`" @click="remove(book.bookId)">{{ removing === book.bookId ? 'Removendo…' : 'Remover download' }}</button></li>
      </ul>
      <p v-else>Você ainda não tem livros disponíveis offline. Conecte-se, abra um livro e escolha “Salvar para offline”.</p>
      <p class="field__hint">O navegador pode liberar espaço ou remover dados do site. Espere a confirmação do download antes de desconectar.</p>
    </template>
    <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
  </section>
</template>

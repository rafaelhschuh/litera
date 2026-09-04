<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'
import { cancelBookDownload, downloadStates, offlineSupport, removeBookOffline, saveBookOffline } from '../lib/pwa'
import { getOfflineBook } from '../lib/offline-store'
import { getOfflineUser } from '../lib/offline-context'
import { syncState } from '../lib/offline-sync'

const props = defineProps<{ bookId: number; format: 'epub' | 'pdf'; revision?: string }>()
const saved = ref(false), localRevision = ref(''), notice = ref(''), error = ref('')
const download = computed(() => downloadStates[props.bookId])
const errorMessage = computed(() => error.value || (download.value?.status === 'error' ? download.value.error : ''))
const busy = computed(() => ['queued', 'downloading', 'updating'].includes(download.value?.status ?? ''))
const updateAvailable = computed(() => saved.value && props.revision && localRevision.value !== props.revision)
const percent = computed(() => download.value?.total ? Math.min(100, Math.floor(download.value.completed / download.value.total * 100)) : undefined)

async function refresh() {
  const userId = getOfflineUser()
  if (!userId) return
  try { const record = await getOfflineBook(userId, props.bookId); saved.value = Boolean(record); localRevision.value = record?.revision ?? '' }
  catch { error.value = 'Não foi possível verificar os livros salvos neste dispositivo.' }
}
onMounted(() => { void refresh(); window.addEventListener('litera-downloads-changed', refresh) })
onBeforeUnmount(() => window.removeEventListener('litera-downloads-changed', refresh))

async function save() {
  if (busy.value || !offlineSupport.available) return
  notice.value = ''; error.value = ''
  try {
    await saveBookOffline(props.bookId, props.format)
    notice.value = 'Disponível offline.'
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'AbortError') notice.value = 'Download cancelado.'
    else error.value = reason instanceof Error ? reason.message : 'Não foi possível salvar o livro para leitura offline.'
  }
  finally { await refresh() }
}
async function remove() {
  notice.value = ''; error.value = ''
  try { await removeBookOffline(props.bookId); saved.value = false; notice.value = 'Download removido. Progresso, destaques e favoritos foram preservados.' }
  catch { error.value = 'Não foi possível remover o download. Tente novamente.' }
}
</script>

<template>
  <div class="offline-book-control">
    <button v-if="!saved || updateAvailable" class="button button--secondary" :disabled="busy || !offlineSupport.available || !syncState.online" @click="save">
      <UiIcon name="download" />{{ busy ? 'Salvando…' : updateAvailable ? 'Atualizar download' : 'Salvar para offline' }}
    </button>
    <button v-if="busy" class="button button--quiet" @click="cancelBookDownload(bookId)">Cancelar download</button>
    <button v-else-if="saved" class="button button--quiet" @click="remove">Remover download</button>
    <p v-if="busy" class="field__hint" role="status">{{ download?.label }} <span v-if="percent !== undefined">{{ percent }}%</span></p>
    <progress v-if="busy" :value="percent" max="100" aria-label="Progresso do download" />
    <p v-else-if="errorMessage" class="alert alert--error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="notice" class="alert alert--success" role="status">{{ notice }}</p>
    <p v-else-if="!offlineSupport.available" class="field__hint">{{ offlineSupport.message }}</p>
    <p v-else-if="saved" class="field__hint"><UiIcon name="check" :size="16" /> Disponível offline.<template v-if="updateAvailable"> Atualização disponível.</template></p>
    <p v-else-if="!syncState.online" class="field__hint">Conecte-se para salvar este livro.</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import UiIcon from './UiIcon.vue'
import { isBookOffline, offlineSupport, removeBookOffline, saveBookOffline, type OfflineSaveProgress } from '../lib/pwa'

const props = defineProps<{ bookId: number; format: 'epub' | 'pdf' }>()
const saved = ref(false), busy = ref(false), notice = ref(''), error = ref(''), progress = ref('')

onMounted(async () => {
  if (!offlineSupport.available) return
  try { saved.value = await isBookOffline(props.bookId) }
  catch { error.value = 'Não foi possível verificar os livros salvos neste dispositivo.' }
})

function updateProgress(value: OfflineSaveProgress) { progress.value = value.label }
async function toggle() {
  if (busy.value || !offlineSupport.available) return
  busy.value = true; notice.value = ''; error.value = ''; progress.value = 'Preparando leitura offline…'
  try {
    if (saved.value) { await removeBookOffline(props.bookId); saved.value = false; notice.value = 'Livro removido do dispositivo.' }
    else { await saveBookOffline(props.bookId, props.format, updateProgress); saved.value = true; notice.value = 'Livro salvo no dispositivo.' }
  } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível salvar o livro para leitura offline.' }
  finally { busy.value = false; progress.value = '' }
}
</script>

<template>
  <div class="offline-book-control">
    <button class="button button--secondary" :disabled="busy || !offlineSupport.available" @click="toggle">
      <UiIcon :name="saved ? 'x' : 'bookmark'" />{{ busy ? 'Salvando…' : saved ? 'Remover do dispositivo' : 'Salvar no dispositivo' }}
    </button>
    <p v-if="busy" class="field__hint" role="status">{{ progress }}</p>
    <p v-else-if="notice" class="alert alert--success" role="status">{{ notice }}</p>
    <p v-else-if="error" class="alert alert--error" role="alert">{{ error }}</p>
    <p v-else-if="!offlineSupport.available" class="field__hint">{{ offlineSupport.message }}</p>
    <p v-else-if="saved" class="field__hint">Disponível sem internet dentro do Litera.</p>
  </div>
</template>

<script setup lang="ts">
/* global File, AbortController, Event, AbortSignal, clearTimeout, setTimeout */
import { computed, onBeforeUnmount, ref } from 'vue'
import UiButton from './UiButton.vue'
import UiField from './UiField.vue'
import { api } from '../lib/api'
import { uploadBook } from '../lib/book-upload'
import { syncState } from '../lib/offline-sync'

const props = defineProps<{ libraryId: number; maxBookBytes: number }>()
const emit = defineEmits<{ imported: [] }>()
type Item = { file: File; status: 'waiting' | 'sending' | 'validating' | 'indexing' | 'done' | 'error'; sent: number; message: string; jobId?: number }
const items = ref<Item[]>([])
const busy = ref(false)
const controller = ref<AbortController>()
const limitMb = computed(() => Math.round(props.maxBookBytes / 1024 / 1024))
let disposed = false
function select(event: Event) {
  items.value = Array.from((event.target as HTMLInputElement).files ?? []).map(file => ({ file, status: 'waiting', sent: 0, message: '' }))
}
function validate(item: Item): string {
  if (!/\.(epub|pdf)$/i.test(item.file.name)) return 'Escolha um arquivo EPUB ou PDF.'
  if (!item.file.size) return 'O arquivo está vazio.'
  if (item.file.size > props.maxBookBytes) return `O limite por livro é ${limitMb.value} MB.`
  return ''
}
async function waitForJob(jobId: number, signal: AbortSignal): Promise<any> {
  for (let attempt = 0; attempt < 300 && !signal.aborted; attempt++) {
    const { job } = await api<{job: any}>(`/api/v1/admin/jobs/${jobId}`, { signal })
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, 2000)
      signal.addEventListener('abort', finish, { once: true })
    })
  }
  return undefined
}
async function send() {
  if (busy.value || !items.value.length) return
  busy.value = true
  const current = new AbortController()
  controller.value = current
  try {
    for (const item of items.value) {
      if (current.signal.aborted) break
      if (item.status === 'done' || item.jobId) continue
      item.message = validate(item)
      if (item.message) { item.status = 'error'; continue }
      item.status = 'sending'; item.sent = 0
      try {
        const result = await uploadBook(props.libraryId, item.file, current.signal, (sent, total) => {
          item.sent = Math.min(sent, total)
          if (sent >= total) item.status = 'validating'
        })
        item.jobId = result.job.id; item.status = 'indexing'; item.message = 'Arquivo enviado. Catalogando…'
        // A queued scan is durable; navigation/cancellation only stops this observation.
        const job = await waitForJob(result.job.id, current.signal)
        if (disposed) break
        if (!job) { item.message = 'Arquivo enviado. Acompanhe a catalogação em Jobs.'; continue }
        const ingestion = job.summary?.errors?.find((error: any) => error.file === item.file.name)
        if (job.status !== 'completed' || ingestion) {
          item.status = 'error'; item.message = ingestion?.message ?? job.error ?? 'A catalogação não concluiu. Consulte Jobs.'
        } else { item.status = 'done'; item.message = 'Disponível na biblioteca.'; emit('imported') }
      } catch (reason) {
        item.status = 'error'; item.message = reason instanceof Error ? reason.message : 'Falha ao enviar.'
      }
    }
  } finally {
    busy.value = false
    controller.value = undefined
  }
}
onBeforeUnmount(() => { disposed = true; controller.value?.abort() })
</script>

<template>
  <section class="settings-section library-upload" aria-labelledby="upload-title" :aria-busy="busy">
    <h2 id="upload-title">Enviar livros</h2>
    <p>Adicione EPUBs e PDFs diretamente a esta biblioteca. Limite de {{ limitMb }} MB por arquivo. Os livros são catalogados automaticamente.</p>
    <p v-if="!syncState.online" class="field__hint">Conecte-se ao servidor para enviar livros.</p>
    <form @submit.prevent="send">
      <UiField label="Arquivos EPUB ou PDF" for-id="library-books" hint="Arquivos com o mesmo nome não são substituídos.">
        <input id="library-books" type="file" accept=".epub,.pdf,application/epub+zip,application/pdf" multiple :disabled="busy || !syncState.online" @change="select" />
      </UiField>
      <div class="library-upload__actions">
        <UiButton type="submit" variant="primary" :disabled="busy || !items.length || !syncState.online">{{ busy ? 'Enviando livros…' : 'Enviar para esta biblioteca' }}</UiButton>
        <UiButton v-if="busy" @click="controller?.abort()">Cancelar</UiButton>
      </div>
    </form>
    <ul v-if="items.length" class="upload-list" aria-label="Envio de livros">
      <li v-for="(item, index) in items" :key="index">
        <strong>{{ item.file.name }}</strong>
        <span v-if="item.status==='sending'">Enviando · {{ Math.round(item.sent / item.file.size * 100) }}%</span>
        <span v-else-if="item.status==='validating'">Validando arquivo…</span>
        <span v-else-if="item.status==='waiting'">Aguardando envio</span>
        <progress v-if="item.status==='sending'" :value="item.sent" :max="item.file.size" :aria-label="`Envio de ${item.file.name}`" />
        <p v-if="item.message" :class="item.status==='error' ? 'field__error' : 'field__hint'" :role="item.status==='error' ? 'alert' : 'status'">{{ item.message }}</p>
        <RouterLink v-if="item.jobId" class="text-link" to="/admin/jobs">Ver catalogação em Jobs</RouterLink>
      </li>
    </ul>
  </section>
</template>

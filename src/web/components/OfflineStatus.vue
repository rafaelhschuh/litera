<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiIcon from './UiIcon.vue'
import UiButton from './UiButton.vue'
import { syncState, retryOfflineSync, resolveProgressConflict } from '../lib/offline-sync'
import { requestSignIn } from '../lib/auth'
const router = useRouter(), route = useRoute(), error = ref(''), expanded = ref(false), active = ref(false)
let activityTimer: ReturnType<typeof window.setTimeout> | undefined
watch(() => syncState.pending > 0 || syncState.syncing, value => {
  window.clearTimeout(activityTimer)
  if (value) activityTimer = window.setTimeout(() => { active.value = true }, 180)
  else active.value = false
}, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(activityTimer))
const problem = computed(() => syncState.requiresLogin || syncState.conflicts.length > 0 || syncState.failed > 0 || Boolean(syncState.message || error.value))
const visible = computed(() => !syncState.online || problem.value || active.value)
const title = computed(() => syncState.requiresLogin ? 'Entre novamente' : !syncState.online ? 'Sem conexão' : syncState.conflicts.length ? 'Revisar posição de leitura' : problem.value ? 'Sincronização requer atenção' : 'Sincronizando alterações')
const detail = computed(() => {
  if (syncState.requiresLogin) return 'Entre na mesma conta para enviar as alterações pendentes. Elas continuam neste dispositivo.'
  if (!syncState.online) return syncState.pending ? 'Suas alterações aguardam envio. A sincronização será retomada automaticamente quando o servidor estiver disponível.' : 'Você pode ler os livros salvos neste dispositivo. A conexão será verificada automaticamente.'
  if (syncState.conflicts.length) return 'Há posições diferentes neste dispositivo e no servidor. Escolha qual posição usar antes de continuar nesse livro.'
  return error.value || syncState.message || 'Progresso, destaques e preferências são enviados automaticamente.'
})
async function useServer(bookId: number) {
  try { error.value = ''; await resolveProgressConflict(bookId, 'server'); await router.push(`/read/${bookId}`) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Conecte-se para resolver a posição de leitura.' }
}
async function signIn() {
  const next = route.fullPath
  requestSignIn()
  await router.push({ path: '/login', query: { next } })
}
async function retry() {
  try { error.value = ''; await retryOfflineSync() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível retomar a sincronização.' }
}
</script>

<template>
  <aside v-if="visible" class="connection-status" :class="{ 'connection-status--attention': problem && syncState.online }" aria-label="Conexão e sincronização">
    <span class="sr-only" role="status">{{ title }}</span>
    <details :open="expanded" @toggle="expanded = ($event.target as HTMLDetailsElement).open">
      <summary><span v-if="syncState.syncing && !problem" class="loading-spinner" aria-hidden="true"></span><UiIcon v-else :name="!syncState.online ? 'wifi-off' : problem ? 'info' : 'refresh'" :size="18" /><span>{{ title }}</span><UiIcon class="connection-status__chevron" name="chevron-right" :size="16" /></summary>
      <div class="connection-status__body">
        <p>{{ detail }}</p>
        <p v-if="syncState.pending" class="field__hint">{{ syncState.pending }} {{ syncState.pending === 1 ? 'alteração pendente' : 'alterações pendentes' }}</p>
        <div class="connection-status__actions">
          <UiButton v-if="syncState.requiresLogin" variant="primary" @click="signIn">Entrar novamente</UiButton>
          <UiButton v-else-if="!syncState.conflicts.length" :disabled="syncState.syncing" @click="retry">{{ syncState.syncing ? 'Sincronizando…' : 'Tentar agora' }}</UiButton>
          <UiButton v-for="conflict in syncState.conflicts" :key="conflict.bookId" :disabled="!syncState.online" @click="useServer(conflict.bookId)">Usar posição do servidor · livro {{ conflict.bookId }}</UiButton>
        </div>
      </div>
    </details>
  </aside>
</template>

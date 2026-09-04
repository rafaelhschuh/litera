<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { syncState, flushOfflineSync, resolveProgressConflict } from '../lib/offline-sync'
import { pwaUpdate, applyPwaUpdate } from '../lib/pwa'
const router = useRouter(), error = ref('')
async function updateApp() {
  try { error.value = ''; await applyPwaUpdate() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível atualizar o aplicativo. Tente novamente conectado.' }
}
async function useServer(bookId: number) {
  try { await resolveProgressConflict(bookId, 'server'); await router.push(`/read/${bookId}`) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Conecte-se para resolver a posição de leitura.' }
}
</script>

<template>
  <div class="offline-status" role="status" aria-live="polite">
    <span v-if="!syncState.online">Offline · livros deste dispositivo</span>
    <span v-else-if="syncState.syncing">Sincronizando {{ syncState.pending }} alterações…</span>
    <span v-else-if="syncState.message">{{ syncState.message }}</span>
    <span v-else-if="syncState.pending">{{ syncState.pending }} alterações aguardando envio</span>
    <button v-if="syncState.online && syncState.pending && !syncState.syncing" class="text-link" @click="flushOfflineSync()">Sincronizar agora</button>
    <button v-for="conflict in syncState.conflicts" :key="conflict.bookId" class="text-link" @click="useServer(conflict.bookId)">Usar posição do servidor · livro {{ conflict.bookId }}</button>
    <span v-if="error">{{ error }}</span>
    <template v-if="pwaUpdate.available"><span>Nova versão disponível.</span><button class="text-link" @click="updateApp">Atualizar aplicativo</button></template>
  </div>
</template>

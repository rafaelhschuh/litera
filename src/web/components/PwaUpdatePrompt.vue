<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import UiDialog from './UiDialog.vue'
import UiButton from './UiButton.vue'
import UiIcon from './UiIcon.vue'
import { auth } from '../lib/auth'
import { applyPwaUpdate, pwaUpdate } from '../lib/pwa-shell'
import { downloadStates } from '../lib/pwa'

const route = useRoute(), open = ref(false), error = ref('')
let offered = -1
const safeToPrompt = computed(() => Boolean(auth.user) && route.path !== '/login' && !route.path.startsWith('/read/'))
const downloading = computed(() => Object.values(downloadStates).some(download => ['queued', 'downloading', 'updating'].includes(download.status)))
function showWhenSafe() {
  if (!safeToPrompt.value || !pwaUpdate.available) { open.value = false; return }
  if (offered === pwaUpdate.promptVersion || document.querySelector('dialog[open]')) return
  offered = pwaUpdate.promptVersion
  error.value = ''; open.value = true
}
watch(() => [pwaUpdate.available, pwaUpdate.promptVersion, safeToPrompt.value], showWhenSafe, { immediate: true })
onMounted(() => document.addEventListener('close', showWhenSafe, true))
onBeforeUnmount(() => document.removeEventListener('close', showWhenSafe, true))
async function update() {
  if (downloading.value) return
  error.value = ''
  try { await applyPwaUpdate() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível atualizar. Tente novamente conectado.' }
}
</script>

<template>
  <UiDialog :open="open" title="Atualização disponível" close-label="Atualizar depois" @close="open = false">
    <div class="app-update">
      <span class="app-update__icon"><UiIcon name="refresh" :size="24" /></span>
      <p>Uma nova versão do Litera está pronta. Atualize para usar as melhorias.</p>
      <p class="field__hint">O aplicativo será reaberto. Seus livros e alterações salvas neste dispositivo serão mantidos.</p>
      <p v-if="downloading" class="alert" role="status">Aguarde o download em andamento para atualizar.</p>
      <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
      <div class="app-update__actions">
        <UiButton variant="quiet" :disabled="pwaUpdate.applying" @click="open = false">Depois</UiButton>
        <UiButton variant="primary" :disabled="pwaUpdate.applying || downloading" @click="update"><span v-if="pwaUpdate.applying" class="loading-spinner" aria-hidden="true"></span>{{ pwaUpdate.applying ? 'Atualizando…' : 'Atualizar agora' }}</UiButton>
      </div>
    </div>
  </UiDialog>
</template>

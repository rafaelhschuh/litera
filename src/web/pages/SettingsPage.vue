<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppState from '../components/AppState.vue'
import UiButton from '../components/UiButton.vue'
import UiField from '../components/UiField.vue'
import UiSwitch from '../components/UiSwitch.vue'
import UiToast from '../components/UiToast.vue'
import OfflineStorage from '../components/OfflineStorage.vue'
import ReaderTypographyFields from '../components/ReaderTypographyFields.vue'
import { resolveReaderTypography, type ReaderTypography } from '../../shared/reader-typography'
import { api } from '../lib/api'
import { syncState } from '../lib/offline-sync'
import { rememberTheme, rememberReducedMotion, type AppTheme } from '../lib/theme'
import { installPwa, pwaInstall } from '../lib/pwa'
import { checkForPwaUpdate, offlineSupport, pwaUpdate, showPwaUpdate } from '../lib/pwa-shell'
import { hasAndroidHost, openAndroidSettings } from '../lib/android-host'

const androidHost = hasAndroidHost()

const loading = ref(true); const error = ref(''); const notice = ref('')
const preferences = reactive({ theme: 'light', fontScale: 100, lineHeight: 'normal', margins: 'normal', appTheme: 'system', reducedMotion: false, pdfInvert: false, epubFlow: 'scroll' })
const typography = computed<ReaderTypography>({ get: () => resolveReaderTypography(preferences), set: value => Object.assign(preferences, value) })
const currentPassword = ref(''); const newPassword = ref('')
function previewTheme(theme: AppTheme){ preferences.appTheme=theme; rememberTheme(theme) }
onMounted(async () => { try { Object.assign(preferences, (await api<any>('/api/v1/settings')).preferences); previewTheme(preferences.appTheme as AppTheme); rememberReducedMotion(preferences.reducedMotion) } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Falha ao carregar.' } finally { loading.value = false } })
async function save() { try { await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify(preferences) }); previewTheme(preferences.appTheme as AppTheme); rememberReducedMotion(preferences.reducedMotion); notice.value = 'Preferências salvas.'; error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Falha ao salvar.' } }
async function changePassword() { try { await api('/api/v1/account/password', { method: 'PUT', body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }) }); currentPassword.value = ''; newPassword.value = ''; notice.value = 'Senha alterada e outras sessões revogadas.'; error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Falha ao alterar a senha.' } }
async function install(){try{const installed=await installPwa();notice.value=installed?'Litera instalado como aplicativo.':'O navegador ainda não liberou a instalação neste dispositivo.'}catch{error.value='Não foi possível abrir a instalação. Tente pelo menu do navegador.'}}
async function checkUpdate() {
  try {
    error.value = ''; notice.value = ''
    await checkForPwaUpdate(true)
    if (pwaUpdate.available) showPwaUpdate()
    else notice.value = pwaUpdate.installing ? 'A nova versão está sendo preparada. Você será avisado quando estiver pronta.' : 'O aplicativo está atualizado.'
  } catch { error.value = 'Não foi possível verificar atualizações. Confira a conexão e tente novamente.' }
}
</script>

<template>
  <div>
    <header class="page-header"><h1>Preferências</h1></header>
    <AppState v-if="loading" kind="loading" />
    <template v-else>
      <UiToast :message="notice" /><p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
      <section class="settings-section"><h2>Aparência</h2><p>O tema Sistema acompanha a aparência deste dispositivo.</p><div class="segmented-control" aria-label="Tema do aplicativo"><button :aria-pressed="preferences.appTheme==='system'" @click="previewTheme('system')">Sistema</button><button :aria-pressed="preferences.appTheme==='light'" @click="previewTheme('light')">Claro</button><button :aria-pressed="preferences.appTheme==='dark'" @click="previewTheme('dark')">Escuro</button></div></section>
      <section class="settings-section"><h2>Leitura</h2><p>Estas opções se aplicam a EPUBs e ao texto adaptado de PDFs. O tema da leitura é independente da aparência do aplicativo.</p><div class="settings-grid"><UiField label="Tema da leitura em texto" for-id="pref-theme"><select id="pref-theme" v-model="preferences.theme"><option value="light">Claro</option><option value="sepia">Sépia</option><option value="dark">Escuro</option></select></UiField><UiField label="Tamanho do texto" for-id="pref-scale"><div class="reader-range"><input id="pref-scale" v-model.number="preferences.fontScale" type="range" min="80" max="200" step="5" /><output for="pref-scale">{{ preferences.fontScale }}%</output></div></UiField><UiField label="Navegação do EPUB" for-id="pref-epub-flow"><select id="pref-epub-flow" v-model="preferences.epubFlow"><option value="scroll">Rolagem por capítulo</option><option value="paginated">Páginas pela tela</option></select></UiField><UiField label="Largura do texto" for-id="pref-margins"><select id="pref-margins" v-model="preferences.margins"><option value="narrow">Estreita</option><option value="normal">Normal</option><option value="wide">Ampla</option></select></UiField></div><ReaderTypographyFields v-model="typography" /><UiSwitch v-model="preferences.pdfInvert" label="Inverter cores dos PDFs" description="Cria um modo escuro forçado sem modificar os arquivos originais." /><UiSwitch v-model="preferences.reducedMotion" label="Reduzir movimento" description="Remove transições não essenciais mesmo quando o sistema não solicitar." /><UiButton variant="primary" @click="save">Salvar preferências</UiButton></section>
      <section class="settings-section"><h2>Segurança da conta</h2><p v-if="!syncState.online" class="field__hint">Alterar a senha requer conexão.</p><form v-else class="account-form" @submit.prevent="changePassword"><UiField label="Senha atual" for-id="current-password"><input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required /></UiField><UiField label="Nova senha" for-id="new-password" hint="Use pelo menos 12 caracteres."><input id="new-password" v-model="newPassword" type="password" minlength="12" autocomplete="new-password" required /></UiField><UiButton type="submit">Alterar senha</UiButton></form></section>
    </template>
    <section class="settings-section" aria-labelledby="app-offline-title">
      <h2 id="app-offline-title">Aplicativo e offline</h2>
      <div class="settings-subsection">
        <template v-if="androidHost"><h3>Aplicativo Android</h3><UiButton @click="openAndroidSettings">Ajustes do Android</UiButton></template>
        <template v-else>
          <h3>Instalação</h3>
          <p v-if="pwaInstall.installed" class="field__hint">Aplicativo instalado.</p>
          <UiButton v-else-if="pwaInstall.available" variant="primary" @click="install">Instalar Litera</UiButton>
          <details v-else class="settings-help"><summary>Como instalar</summary><p>No Safari, use Compartilhar → Adicionar à Tela de Início, ou Adicionar ao Dock no Mac. No Chrome, escolha Instalar aplicativo no menu.</p></details>
        </template>
      </div>
      <div v-if="offlineSupport.supported" class="settings-subsection">
        <h3>Atualizações</h3>
        <UiButton :disabled="pwaUpdate.checking || !syncState.online" @click="checkUpdate">{{ pwaUpdate.checking ? 'Verificando…' : pwaUpdate.available ? 'Ver atualização disponível' : 'Verificar atualizações' }}</UiButton>
      </div>
      <OfflineStorage />
    </section>
  </div>
</template>

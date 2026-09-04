<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppState from '../components/AppState.vue'
import UiButton from '../components/UiButton.vue'
import UiField from '../components/UiField.vue'
import UiSwitch from '../components/UiSwitch.vue'
import UiToast from '../components/UiToast.vue'
import OfflineStorage from '../components/OfflineStorage.vue'
import { api } from '../lib/api'
import { syncState } from '../lib/offline-sync'
import { rememberTheme, type AppTheme } from '../lib/theme'
import { installPwa, pwaInstall } from '../lib/pwa'

const loading = ref(true); const error = ref(''); const notice = ref('')
const preferences = reactive({ theme: 'light', fontScale: 100, lineHeight: 'normal', margins: 'normal', appTheme: 'system', reducedMotion: false, pdfInvert: false })
const currentPassword = ref(''); const newPassword = ref('')
function previewTheme(theme: AppTheme){ preferences.appTheme=theme; rememberTheme(theme) }
onMounted(async () => { try { Object.assign(preferences, (await api<any>('/api/v1/settings')).preferences); previewTheme(preferences.appTheme as AppTheme); document.documentElement.dataset.reducedMotion=String(preferences.reducedMotion) } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Falha ao carregar.' } finally { loading.value = false } })
async function save() { try { await api('/api/v1/settings', { method: 'PUT', body: JSON.stringify(preferences) }); previewTheme(preferences.appTheme as AppTheme); document.documentElement.dataset.reducedMotion=String(preferences.reducedMotion); notice.value = 'Preferências salvas.'; error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Falha ao salvar.' } }
async function changePassword() { try { await api('/api/v1/account/password', { method: 'PUT', body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }) }); currentPassword.value = ''; newPassword.value = ''; notice.value = 'Senha alterada e outras sessões revogadas.'; error.value = '' } catch (reason) { error.value = reason instanceof Error ? reason.message : 'Falha ao alterar a senha.' } }
async function install(){try{const installed=await installPwa();notice.value=installed?'Litera instalado como aplicativo.':'O navegador ainda não liberou a instalação neste dispositivo.'}catch{error.value='Não foi possível abrir a instalação. Tente pelo menu do navegador.'}}
</script>

<template>
  <div>
    <header class="page-header"><p class="eyebrow">Sua experiência</p><h1>Preferências</h1><p>Estas escolhas acompanham sua conta em outros dispositivos.</p></header>
    <OfflineStorage />
    <AppState v-if="loading" kind="loading" />
    <template v-else>
      <UiToast :message="notice" /><p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
      <section class="settings-section"><h2>Aparência</h2><p>Escolha como o Litera aparece. No modo Sistema, ele acompanha este dispositivo.</p><div class="segmented-control" aria-label="Tema do aplicativo"><button :aria-pressed="preferences.appTheme==='system'" @click="previewTheme('system')">Sistema</button><button :aria-pressed="preferences.appTheme==='light'" @click="previewTheme('light')">Claro</button><button :aria-pressed="preferences.appTheme==='dark'" @click="previewTheme('dark')">Escuro</button></div></section>
      <section class="settings-section"><h2>Leitura</h2><p>Estas opções se aplicam a EPUBs e ao texto adaptado de PDFs. O tema da leitura é independente da aparência do aplicativo.</p><div class="settings-grid"><UiField label="Tema da leitura em texto" for-id="pref-theme"><select id="pref-theme" v-model="preferences.theme"><option value="light">Claro</option><option value="sepia">Sépia</option><option value="dark">Escuro</option></select></UiField><UiField label="Tamanho do texto" for-id="pref-scale"><select id="pref-scale" v-model.number="preferences.fontScale"><option :value="90">90%</option><option :value="100">100%</option><option :value="110">110%</option><option :value="120">120%</option><option :value="130">130%</option></select></UiField><UiField label="Entrelinhas" for-id="pref-lines"><select id="pref-lines" v-model="preferences.lineHeight"><option value="compact">Compacta</option><option value="normal">Normal</option><option value="relaxed">Relaxada</option></select></UiField><UiField label="Margens" for-id="pref-margins"><select id="pref-margins" v-model="preferences.margins"><option value="narrow">Estreitas</option><option value="normal">Normais</option><option value="wide">Largas</option></select></UiField></div><UiSwitch v-model="preferences.pdfInvert" label="Inverter cores dos PDFs" description="Cria um modo escuro forçado sem modificar os arquivos originais." /><UiSwitch v-model="preferences.reducedMotion" label="Reduzir movimento" description="Remove transições não essenciais mesmo quando o sistema não solicitar." /><UiButton variant="primary" @click="save">Salvar preferências</UiButton></section>
      <section class="settings-section"><h2>Aplicativo</h2><p>Instale o Litera pelo fluxo oferecido pelo navegador para abrir em uma janela própria. A instalação não baixa livros automaticamente.</p><p v-if="pwaInstall.installed" class="alert alert--success">O Litera já está instalado neste dispositivo.</p><UiButton v-else-if="pwaInstall.available" variant="primary" @click="install">Instalar Litera</UiButton><p v-else class="field__hint">No Safari do iPhone ou iPad, abra Compartilhar e escolha “Adicionar à Tela de Início”. No Mac, use “Adicionar ao Dock” quando disponível. No Chrome, procure “Instalar aplicativo” no menu. O acesso deve usar HTTPS (ou localhost durante desenvolvimento).</p></section>
      <section class="settings-section"><h2>Segurança da conta</h2><p v-if="!syncState.online" class="field__hint">Alterar a senha requer conexão.</p><form v-else class="account-form" @submit.prevent="changePassword"><UiField label="Senha atual" for-id="current-password"><input id="current-password" v-model="currentPassword" type="password" autocomplete="current-password" required /></UiField><UiField label="Nova senha" for-id="new-password" hint="Use pelo menos 12 caracteres."><input id="new-password" v-model="newPassword" type="password" minlength="12" autocomplete="new-password" required /></UiField><UiButton type="submit">Alterar senha</UiButton></form></section>
    </template>
  </div>
</template>

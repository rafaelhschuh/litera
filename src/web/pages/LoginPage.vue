<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiButton from '../components/UiButton.vue'
import UiField from '../components/UiField.vue'
import { api } from '../lib/api'
import { rememberSession, type User } from '../lib/auth'
const username = ref(''); const password = ref(''); const error = ref(''); const loading = ref(false)
const router = useRouter(); const route = useRoute()
async function submit() {
  error.value = ''; loading.value = true
  try { rememberSession((await api<{ user: User }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) })).user); await router.push(typeof route.query.next === 'string' ? route.query.next : '/') }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível entrar.'; await nextTick(); document.querySelector<HTMLInputElement>('#username')?.focus() }
  finally { loading.value = false }
}
</script>
<template>
  <main class="auth-layout"><section class="auth-intro"><p class="eyebrow">Sua biblioteca particular</p><h1>Histórias guardadas.<br />Leitura retomada.</h1><p>O acervo que vive no seu servidor, organizado para o próximo capítulo.</p></section><form class="auth-form" @submit.prevent="submit"><RouterLink class="wordmark" to="/login">LITERA</RouterLink><h2>Entrar</h2><p v-if="error" class="alert alert--error" role="alert">{{ error }}</p><UiField label="Usuário" for-id="username"><input id="username" v-model="username" autocomplete="username" required autofocus :aria-invalid="Boolean(error)" /></UiField><UiField label="Senha" for-id="password"><input id="password" v-model="password" type="password" autocomplete="current-password" required :aria-invalid="Boolean(error)" /></UiField><UiButton type="submit" variant="primary" :disabled="loading">{{ loading ? 'Entrando…' : 'Entrar' }}</UiButton><a class="legacy-link" href="/legacy/login">Usar modo de compatibilidade</a></form></main>
</template>

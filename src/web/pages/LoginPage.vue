<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiButton from '../components/UiButton.vue'
import UiField from '../components/UiField.vue'
import { api } from '../lib/api'
import { prepareHome } from '../lib/catalog-warmup'
import { rememberSession, type User } from '../lib/auth'
const username = ref(''); const password = ref(''); const error = ref(''); const loading = ref(false)
const status = ref('Conectando…')
const router = useRouter(); const route = useRoute()
async function submit() {
  if (loading.value) return
  error.value = ''; loading.value = true; status.value = 'Conectando…'
  try {
    const result = await api<{ user: User }>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) })
    await rememberSession(result.user)
    password.value = ''
    status.value = 'Preparando sua biblioteca…'
    await prepareHome()
    await router.push(typeof route.query.next === 'string' ? route.query.next : '/')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Não foi possível entrar.'
    loading.value = false
    await nextTick(); document.querySelector<HTMLInputElement>('#username')?.focus()
  } finally { loading.value = false }
}
</script>
<template>
  <main class="auth-layout">
    <section class="auth-panel" aria-labelledby="login-title">
      <header class="auth-brand"><RouterLink class="wordmark" to="/login">LITERA</RouterLink></header>
      <form class="auth-form" aria-labelledby="login-title" :aria-busy="loading" @submit.prevent="submit">
        <h1 id="login-title">Entrar</h1>
        <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
        <UiField label="Usuário" for-id="username"><input id="username" v-model="username" autocomplete="username" required autofocus :disabled="loading" :aria-invalid="Boolean(error)" /></UiField>
        <UiField label="Senha" for-id="password"><input id="password" v-model="password" type="password" autocomplete="current-password" required :disabled="loading" :aria-invalid="Boolean(error)" /></UiField>
        <UiButton type="submit" variant="primary" :disabled="loading"><span v-if="loading" class="loading-spinner" aria-hidden="true"></span>{{ loading ? 'Entrando…' : 'Entrar' }}</UiButton>
        <p v-if="loading" class="login-progress" role="status" aria-live="polite">{{ status }}</p>
      </form>
      <footer class="auth-footer"><a class="legacy-link" href="/legacy/login">Usar modo de compatibilidade</a></footer>
    </section>
  </main>
</template>

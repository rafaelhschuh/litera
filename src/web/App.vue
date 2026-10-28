<script setup lang="ts">
import { auth } from './lib/auth'
import { navigation } from './lib/navigation'
import OfflineStatus from './components/OfflineStatus.vue'
import PwaUpdatePrompt from './components/PwaUpdatePrompt.vue'
import { useRoute } from 'vue-router'
const currentRoute = useRoute()
</script>

<template>
  <span v-if="navigation.busy" class="navigation-activity" role="status"><span class="sr-only">Abrindo tela…</span></span>
  <p v-if="navigation.error" class="navigation-error alert alert--error" role="alert">{{ navigation.error }}</p>
  <RouterView v-slot="{ Component, route }">
    <Transition name="surface">
      <component :is="Component" v-if="route.path === '/login'" key="login" />
      <KeepAlive v-else :key="`${auth.user?.id ?? 'guest'}:${auth.user?.role ?? ''}`" :include="['AppShell']">
        <component :is="Component" :key="route.path.startsWith('/read/') ? route.path : route.matched[0]?.path" />
      </KeepAlive>
    </Transition>
  </RouterView>
  <OfflineStatus v-if="auth.user && currentRoute.path !== '/login' && !currentRoute.path.startsWith('/read/')" />
  <PwaUpdatePrompt />
</template>

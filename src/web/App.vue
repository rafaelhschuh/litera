<script setup lang="ts">
import { auth } from './lib/auth'
import { navigation } from './lib/navigation'
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { routeMotion } from '../lib/navigation-motion'
withDefaults(defineProps<{ cache?: boolean }>(), { cache: false })
const retainedPages = ['HomePage', 'LibraryPage', 'SearchPage', 'TaxonomyPage', 'BookPage']
const transition = computed(() => routeMotion.native || routeMotion.kind === 'expand' ? 'route-instant' : routeMotion.kind === 'slide' ? (routeMotion.direction > 0 ? 'module-next' : 'module-prev') : 'page')
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition :name="transition">
      <KeepAlive :include="cache ? retainedPages : []" :max="12">
        <component :is="Component" :key="route.path" />
      </KeepAlive>
    </Transition>
  </RouterView>
</template>

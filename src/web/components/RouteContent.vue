<script setup lang="ts">
withDefaults(defineProps<{ cache?: boolean }>(), { cache: false })
const retainedPages = ['HomePage', 'LibraryPage', 'SearchPage', 'TaxonomyPage', 'BookPage']
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="page">
      <KeepAlive :include="cache ? retainedPages : []" :max="12">
        <component :is="Component" :key="route.path" />
      </KeepAlive>
    </Transition>
  </RouterView>
</template>

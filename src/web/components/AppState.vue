<script setup lang="ts">
withDefaults(defineProps<{ kind: 'loading' | 'empty' | 'error'; title?: string; message?: string; layout?: 'lines' | 'catalog' }>(), { title: '', layout: 'lines' })
</script>
<template>
  <div class="state" :class="[`state--${kind}`, { 'state--catalog': kind === 'loading' && layout === 'catalog' }]" :role="kind === 'error' ? 'alert' : 'status'">
    <template v-if="kind === 'loading'">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span class="sr-only">Carregando conteúdo…</span>
      <div v-if="layout === 'catalog'" class="book-grid skeleton-grid" aria-hidden="true"><div v-for="item in 8" :key="item" class="skeleton-book"><i class="book-cover" /><i /><i /></div></div>
      <div v-else class="skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
    </template>
    <h2 v-if="title">{{ title }}</h2><p v-if="message">{{ message }}</p><slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ kind: 'loading' | 'empty' | 'error'; title?: string; message?: string }>(), { title: '' })
</script>
<template>
  <div class="state" :class="`state--${kind}`" :role="kind === 'error' ? 'alert' : 'status'">
    <div v-if="kind === 'loading'" class="skeleton-lines" aria-hidden="true"><i /><i /><i /></div>
    <h2 v-if="title">{{ title }}</h2><p v-if="message">{{ message }}</p><slot />
  </div>
</template>

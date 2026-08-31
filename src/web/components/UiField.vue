<script setup lang="ts">
defineProps<{ label: string; error?: string; hint?: string; forId: string }>()
</script>
<template>
  <div class="field">
    <label :for="forId">{{ label }}</label>
    <slot />
    <p v-if="hint && !error" class="field__hint">{{ hint }}</p>
    <p v-if="error" :id="`${forId}-error`" class="field__error" role="alert">{{ error }}</p>
  </div>
</template>

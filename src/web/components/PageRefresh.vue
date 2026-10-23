<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ busy: boolean; error?: string }>()
defineEmits<{ retry: [] }>()
const visible = ref(false)
let timer: number | undefined
watch(() => props.busy, busy => {
  window.clearTimeout(timer)
  if (!busy) visible.value = false
  else timer = window.setTimeout(() => { visible.value = true }, 180)
}, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <div class="page-refresh" :class="{ 'page-refresh--error': error }">
    <span v-if="visible" class="page-refresh__activity" role="status"><span class="sr-only">Atualizando conteúdo…</span></span>
    <p v-if="error" class="alert alert--error" role="alert">{{ error }} <button class="text-link" @click="$emit('retry')">Tentar novamente</button></p>
  </div>
</template>

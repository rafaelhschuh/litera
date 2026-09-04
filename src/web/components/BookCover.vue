<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getOfflineResource } from '../lib/offline-store'
import { getOfflineUser, offlineContext } from '../lib/offline-context'
const props = defineProps<{ id: number; title: string; author?: string; hasCover?: boolean; format?: string }>()
const localUrl = ref(''), resolved = ref(false)
let generation = 0
function release() { if (localUrl.value) window.URL.revokeObjectURL(localUrl.value); localUrl.value = '' }
watch(() => [props.id, offlineContext.userId], async () => {
  const current = ++generation; release(); resolved.value = false
  const userId = getOfflineUser()
  if (!userId) { resolved.value = true; return }
  try { const blob = await getOfflineResource(userId, props.id, `/api/v1/books/${props.id}/cover`); if (blob && current === generation) localUrl.value = window.URL.createObjectURL(blob) }
  catch { /* An unavailable optional storage API must not break online covers. */ }
  finally { if (current === generation) resolved.value = true }
}, { immediate: true })
onBeforeUnmount(() => { generation++; release() })
</script>
<template>
  <div class="book-cover">
    <img v-if="hasCover && resolved" :src="localUrl || `/api/v1/books/${id}/cover`" :alt="`Capa de ${title}`" loading="lazy" />
    <div v-else-if="!hasCover" class="book-cover__fallback" :class="`book-cover__fallback--${id % 6}`" aria-hidden="true"><i>LITERA</i><span>{{ title }}</span><small>{{ author || 'Coleção particular' }}</small></div>
  </div>
</template>

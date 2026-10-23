<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getOfflineResource } from '../lib/offline-store'
import { syncState } from '../lib/offline-sync'
import { getOfflineUser, offlineContext } from '../lib/offline-context'
const props = defineProps<{ id: number; title: string; author?: string; hasCover?: boolean; format?: string; coverRevision?: string }>()
const localUrl = ref(''), resolved = ref(false), imageReady = ref(false), imageFailed = ref(false)
let generation = 0
function release() { if (localUrl.value) window.URL.revokeObjectURL(localUrl.value); localUrl.value = '' }
watch(() => [props.id, props.coverRevision, offlineContext.userId, syncState.online], async () => {
  const current = ++generation; release(); resolved.value = false; imageReady.value = false; imageFailed.value = false
  const userId = getOfflineUser()
  if (!userId || (syncState.online && window.navigator.onLine !== false)) { resolved.value = true; return }
  try { const blob = await getOfflineResource(userId, props.id, `/api/v1/books/${props.id}/cover`); if (blob && current === generation) localUrl.value = window.URL.createObjectURL(blob) }
  catch { /* An unavailable optional storage API must not break online covers. */ }
  finally { if (current === generation) resolved.value = true }
}, { immediate: true })
onBeforeUnmount(() => { generation++; release() })
</script>
<template>
  <div class="book-cover">
    <img v-if="hasCover && resolved && !imageFailed" :src="localUrl || `/api/v1/books/${id}/cover${coverRevision ? `?v=${coverRevision}` : ''}`" :alt="`Capa de ${title}`" loading="lazy" decoding="async" :class="{ 'book-cover__image--ready': imageReady }" @load="imageReady=true" @error="imageFailed=true" />
    <div v-else-if="!hasCover || imageFailed" class="book-cover__fallback" :class="`book-cover__fallback--${id % 6}`" aria-hidden="true"><i>LITERA</i><span>{{ title }}</span><small>{{ author || 'Coleção particular' }}</small></div>
  </div>
</template>

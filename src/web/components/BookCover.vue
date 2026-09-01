<script setup lang="ts">
defineProps<{ id: number; title: string; author?: string; hasCover?: boolean; format?: string }>()
</script>
<template>
  <div class="book-cover">
    <img v-if="hasCover" :src="`/api/v1/books/${id}/cover`" :alt="`Capa de ${title}`" loading="lazy" />
    <div v-else class="book-cover__fallback" :class="`book-cover__fallback--${id % 6}`" aria-hidden="true"><i>LITERA</i><span>{{ title }}</span><small>{{ author || 'Coleção particular' }}</small></div>
  </div>
</template>

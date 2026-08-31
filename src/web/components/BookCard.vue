<script setup lang="ts">
import BookCover from './BookCover.vue'
import BookProgress from './BookProgress.vue'
defineProps<{ book: any; compact?: boolean; removable?: boolean }>()
const emit=defineEmits<{remove:[id:number]}>()
</script>
<template>
  <article class="book-card" :class="{ 'book-card--compact': compact }">
    <RouterLink class="book-card__cover-link" :to="`/books/${book.id}`"><BookCover :id="book.id" :title="book.title" :author="book.author" :has-cover="book.hasCover" :format="book.format" /><span class="book-card__read">Abrir</span></RouterLink>
    <div class="book-card__body">
      <h3><RouterLink :to="`/books/${book.id}`">{{ book.title }}</RouterLink></h3>
      <p>{{ book.author || 'Autor desconhecido' }}</p>
      <BookProgress v-if="book.progressRatio" :value="book.progressRatio" />
      <button v-if="removable" class="text-link book-card__remove" @click="emit('remove',book.id)">Remover da seção</button>
    </div>
  </article>
</template>

<script setup lang="ts">
import BookCard from './BookCard.vue'
defineProps<{ books: any[]; compact?: boolean }>()
const emit=defineEmits<{remove:[id:number]}>()
</script>
<template><div class="book-grid" :class="{ 'book-grid--rail': compact }"><BookCard v-for="book in books" :key="book.id" :book="book" :compact="compact" :removable="compact" @remove="emit('remove',$event)" /></div></template>

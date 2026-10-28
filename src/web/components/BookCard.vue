<script setup lang="ts">
/* global MouseEvent */
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from 'vue'
import { observeBook, warmBook } from '../lib/catalog-warmup'
import BookCover from './BookCover.vue'
import BookProgress from './BookProgress.vue'
import { useRouter } from 'vue-router'
import { openBookMotion } from '../lib/navigation-motion'
const props = defineProps<{ book: any; compact?: boolean; removable?: boolean }>()
const card = ref<HTMLElement>(), motionKey = useId()
const router = useRouter()
function open(event: MouseEvent) { void openBookMotion(event, props.book.id, card.value, () => router.push(`/books/${props.book.id}`)).catch(error => window.console.error('Falha ao navegar', error)) }
let stop: (() => void) | undefined
function observe() { if (!stop && card.value) stop = observeBook(card.value, () => props.book) }
function release() { stop?.(); stop = undefined }
onMounted(observe)
onActivated(observe)
onDeactivated(release)
onBeforeUnmount(release)
watch(() => [props.book.fileRevision, props.book.coverRevision], () => { release(); observe() })
const emit=defineEmits<{remove:[id:number]}>()
</script>
<template>
  <article ref="card" :data-book-card="book.id" :data-book-origin="motionKey" class="book-card" :class="{ 'book-card--compact': compact }" @pointerenter="warmBook(book)" @focusin="warmBook(book)">
    <RouterLink class="book-card__cover-link" :to="`/books/${book.id}`" @click.capture="open"><BookCover :id="book.id" :title="book.title" :author="book.author" :has-cover="book.hasCover" :cover-revision="book.coverRevision" :format="book.format" /><span class="book-card__read">Abrir</span></RouterLink>
    <div class="book-card__body">
      <h3><RouterLink :to="`/books/${book.id}`" @click.capture="open">{{ book.title }}</RouterLink></h3>
      <p>{{ book.author || 'Autor desconhecido' }}</p>
      <small v-if="book.offline" class="field__hint">Disponível offline</small>
      <BookProgress v-if="book.progressRatio" :value="book.progressRatio" />
      <button v-if="removable" class="text-link book-card__remove" @click="emit('remove',book.id)">Remover da seção</button>
    </div>
  </article>
</template>

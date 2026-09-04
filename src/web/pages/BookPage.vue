<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppState from '../components/AppState.vue'
import BookCover from '../components/BookCover.vue'
import BookProgress from '../components/BookProgress.vue'
import OfflineBookControl from '../components/OfflineBookControl.vue'
import UiIcon from '../components/UiIcon.vue'
import RatingStars from '../components/RatingStars.vue'
import { api } from '../lib/api'
import { syncState } from '../lib/offline-sync'

const route=useRoute();const book=ref<any>();const highlights=ref<any[]>([]);const state=ref<'loading'|'loaded'|'error'>('loading');const notice=ref(''), error=ref(''), busy=ref(false)
async function load(){try{const [bookResult,highlightResult]=await Promise.all([api<{book:any}>(`/api/v1/books/${route.params.id}`),api<{highlights:any[]}>(`/api/v1/books/${route.params.id}/highlights`)]);book.value=bookResult.book;highlights.value=highlightResult.highlights;state.value='loaded'}catch{state.value='error'}}
onMounted(load)
watch(()=>syncState.online,load)
async function change(action:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await action()}catch(reason){error.value=reason instanceof Error?reason.message:'Não foi possível salvar a alteração. Tente novamente.'}finally{busy.value=false}}
async function favorite(){await change(async()=>{const value=!book.value.favorite;await api(`/api/v1/books/${book.value.id}/favorite`,{method:value?'PUT':'DELETE'});book.value.favorite=value;notice.value=value?'Adicionado aos favoritos.':'Removido dos favoritos.'})}
async function reopen(){await change(async()=>{await api(`/api/v1/books/${book.value.id}/reopen`,{method:'POST'});book.value.completed=false;notice.value='Livro reaberto para continuar a leitura.'})}
async function removeHighlight(id:number){await change(async()=>{await api(`/api/v1/highlights/${id}`,{method:'DELETE'});highlights.value=highlights.value.filter(item=>item.id!==id);notice.value='Destaque removido.'})}
async function rateBook(rating:number){await change(async()=>{await api(`/api/v1/books/${book.value.id}/rating`,{method:'PUT',body:JSON.stringify({rating})});book.value.userRating=rating;notice.value=rating?`Livro avaliado com ${rating} estrelas.`:'Avaliação do livro removida.'})}
async function rateHighlight(highlight:any,rating:number){await change(async()=>{await api(`/api/v1/highlights/${highlight.id}/rating`,{method:'PUT',body:JSON.stringify({rating})});highlight.rating=rating;notice.value=rating?`Citação avaliada com ${rating} estrelas.`:'Avaliação da citação removida.'})}
</script>

<template>
  <AppState v-if="state==='loading'" kind="loading" />
  <AppState v-else-if="state==='error'" kind="error" title="Livro indisponível" :message="!syncState.online ? 'Este livro não está disponível offline. Conecte-se para abri-lo e salvar um download.' : 'Ele pode ter sido removido do acervo ou não estar liberado para sua conta.'" />
  <article v-else class="book-detail">
    <RouterLink class="back-link" to="/library">← Biblioteca</RouterLink>
    <BookCover :id="book.id" :title="book.title" :author="book.author" :has-cover="book.hasCover" :format="book.format" />
    <div class="book-detail__copy">
      <p class="eyebrow">{{ book.format.toUpperCase() }}</p><h1>{{ book.title }}</h1>
      <p class="book-author"><RouterLink v-if="book.author" :to="`/authors/${encodeURIComponent(book.author)}`">{{ book.author }}</RouterLink><span v-else>Autor desconhecido</span></p>
      <div class="book-rating"><span>Sua avaliação</span><RatingStars :model-value="book.userRating||0" :disabled="busy || !syncState.online" label="Avaliação do livro" @update:model-value="rateBook" /><small v-if="!syncState.online">Avaliações requerem conexão.</small></div>
      <p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
      <p v-if="notice" class="alert alert--success" role="status">{{ notice }}</p><BookProgress v-if="book.progressRatio" :value="book.progressRatio" />
      <div class="book-actions"><RouterLink v-if="syncState.online || book.offline" class="button button--primary" :to="`/read/${book.id}`"><UiIcon name="book-open" />{{ book.completed ? 'Reler' : book.progressRatio ? 'Continuar leitura' : 'Começar leitura' }}</RouterLink><span v-else>Este livro não está disponível offline.</span><button class="button button--tonal" :disabled="busy" @click="favorite"><UiIcon name="heart" />{{ book.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos' }}</button><button v-if="book.completed" class="button button--quiet" :disabled="busy || !syncState.online" @click="reopen">Marcar como em leitura</button></div>
      <OfflineBookControl :book-id="book.id" :format="book.format" :revision="book.fileRevision" />
      <p v-if="book.description" class="description">{{ book.description }}</p>
      <dl><div><dt>Formato</dt><dd>{{ book.format.toUpperCase() }}</dd></div><div v-if="book.series"><dt>Série</dt><dd><RouterLink :to="`/series/${encodeURIComponent(book.series)}`">{{ book.series }}<template v-if="book.seriesIndex"> · {{ book.seriesIndex }}</template></RouterLink></dd></div><div v-if="book.language"><dt>Idioma</dt><dd>{{ book.language }}</dd></div><div v-if="book.pageCount"><dt>Páginas</dt><dd>{{ book.pageCount }}</dd></div><div v-if="book.identifier"><dt>Identificador</dt><dd>{{ book.identifier }}</dd></div><div v-if="book.genres?.length"><dt>Gêneros</dt><dd class="genre-links"><RouterLink v-for="genre in book.genres" :key="genre" :to="`/genres/${encodeURIComponent(genre)}`">{{ genre }}</RouterLink></dd></div></dl>
      <section class="highlight-section">
        <header><div><p class="eyebrow">Sua leitura</p><h2>Destaques</h2></div><RouterLink v-if="syncState.online || book.offline" class="button button--quiet" :to="`/read/${book.id}`">Voltar a ler</RouterLink></header>
        <div v-if="highlights.length" class="highlight-list">
          <article v-for="highlight in highlights" :key="highlight.id" class="highlight-card">
            <blockquote>“{{ highlight.quoteText }}”</blockquote>
            <RatingStars :model-value="highlight.rating||0" :disabled="busy || !syncState.online" label="Avaliação da citação" @update:model-value="rateHighlight(highlight,$event)" />
            <footer><span>{{ highlight.pageNumber ? `Página ${highlight.pageNumber}` : highlight.chapter || 'Trecho do livro' }}</span><div class="reader-actions"><RouterLink v-if="syncState.online || book.offline" class="text-link" :to="`/read/${book.id}?highlight=${highlight.id}`">Abrir trecho</RouterLink><button class="icon-button" :disabled="busy" aria-label="Remover destaque" @click="removeHighlight(highlight.id)"><UiIcon name="x" :size="16" /></button></div></footer>
          </article>
        </div>
        <div v-else class="state highlight-empty"><UiIcon name="sparkles" :size="28" /><h3>Nenhum destaque ainda</h3><p>Selecione um trecho durante a leitura para encontrá-lo aqui depois.</p></div>
      </section>
    </div>
  </article>
</template>

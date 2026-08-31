<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppState from '../../components/AppState.vue'
import BookCover from '../../components/BookCover.vue'
import UiButton from '../../components/UiButton.vue'
import UiDialog from '../../components/UiDialog.vue'
import UiField from '../../components/UiField.vue'
import UiSwitch from '../../components/UiSwitch.vue'
import { api } from '../../lib/api'

const provider=ref<any>();const books=ref<any[]>([]);const loading=ref(true);const error=ref('');const notice=ref('');const testing=ref(false);const editing=ref<any>();const saving=ref(false);const coverDataUrl=ref('');const coverPreview=ref('')
async function load(){loading.value=true;try{const [providers,states]=await Promise.all([api<any>('/api/v1/admin/metadata'),api<any>('/api/v1/admin/metadata/books')]);provider.value=providers.providers[0];books.value=states.books;error.value=''}catch(reason){error.value=reason instanceof Error?reason.message:'Falha ao carregar.'}finally{loading.value=false}}
async function saveProvider(){try{await api('/api/v1/admin/metadata/openlibrary',{method:'PUT',body:JSON.stringify({enabled:provider.value.enabled,contact:provider.value.contact})});notice.value='Integração atualizada; não é necessário reiniciar.';await load()}catch(reason){error.value=reason instanceof Error?reason.message:'Falha ao salvar.'}}
async function test(){testing.value=true;try{await api('/api/v1/admin/metadata/openlibrary/test',{method:'POST'});notice.value='Open Library respondeu corretamente.';error.value=''}catch(reason){error.value=reason instanceof Error?reason.message:'Provider indisponível.'}finally{testing.value=false}}
function edit(book:any){editing.value={...book,genresText:(book.genres||[]).join(', '),publishedYear:book.publishedYear??'',seriesIndex:book.seriesIndex??''};coverDataUrl.value='';coverPreview.value=''}
function chooseCover(event:any){const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>8*1024*1024){error.value='A imagem deve ter no máximo 8 MB.';return}const reader=new window.FileReader();reader.onload=()=>{coverDataUrl.value=String(reader.result);coverPreview.value=String(reader.result)};reader.readAsDataURL(file)}
async function saveBook(){if(!editing.value)return;saving.value=true;error.value='';try{const book=editing.value;await api(`/api/v1/admin/metadata/books/${book.id}`,{method:'PUT',body:JSON.stringify({title:book.title,author:book.author||null,description:book.description||null,language:book.language||null,identifier:book.identifier||null,series:book.series||null,seriesIndex:book.seriesIndex===''?null:Number(book.seriesIndex),publishedYear:book.publishedYear===''?null:Number(book.publishedYear),genres:book.genresText.split(',').map((value:string)=>value.trim()).filter(Boolean)})});if(coverDataUrl.value)await api(`/api/v1/admin/metadata/books/${book.id}/cover`,{method:'PUT',body:JSON.stringify({dataUrl:coverDataUrl.value})});notice.value=`Metadata de “${book.title}” atualizada manualmente.`;editing.value=undefined;await load()}catch(reason){error.value=reason instanceof Error?reason.message:'Não foi possível salvar o livro.'}finally{saving.value=false}}
onMounted(load)
</script>
<template>
  <div>
    <header class="page-header"><p class="eyebrow">Organização do acervo</p><h1>Metadata</h1><p>Edite títulos, descrições, coleções e imagens manualmente, com ou sem integração externa.</p></header>
    <AppState v-if="loading" kind="loading" />
    <template v-else>
      <p v-if="notice" class="alert alert--success" role="status">{{ notice }}</p><p v-if="error" class="alert alert--error" role="alert">{{ error }}</p>
      <section class="settings-section"><h2>Open Library</h2><p>{{ provider.policy }}</p><UiSwitch v-model="provider.enabled" label="Habilitar Open Library" description="Enquanto estiver desligada, PDFs usam a primeira página como capa." /><UiField label="Email de contato" for-id="provider-contact"><input id="provider-contact" v-model="provider.contact" type="email" :required="provider.enabled" /></UiField><div class="book-actions"><UiButton variant="primary" @click="saveProvider">Salvar configuração</UiButton><UiButton :disabled="testing||!provider.enabled" @click="test">{{ testing?'Testando…':'Testar conexão' }}</UiButton></div></section>
      <section class="settings-section"><h2>Itens do acervo</h2><p>Alterações manuais têm prioridade sobre dados encontrados automaticamente.</p><div class="metadata-books"><article v-for="book in books" :key="book.id"><BookCover :id="book.id" :title="book.title" :author="book.author" :has-cover="book.hasCover" :format="book.format" /><div><h3>{{ book.title }}</h3><p>{{ book.author||'Autor desconhecido' }}</p><small>{{ book.format.toUpperCase() }} · {{ book.provenance||'metadata do arquivo' }}</small></div><UiButton @click="edit(book)">Editar</UiButton></article></div><AppState v-if="!books.length" kind="empty" title="Nenhum livro disponível" message="Escaneie uma biblioteca para editar seus itens." /></section>
    </template>
    <UiDialog :open="Boolean(editing)" title="Editar metadata" @close="editing=undefined">
      <form v-if="editing" class="metadata-form" @submit.prevent="saveBook">
        <div class="metadata-cover-editor"><BookCover v-if="!coverPreview" :id="editing.id" :title="editing.title" :author="editing.author" :has-cover="editing.hasCover" :format="editing.format" /><img v-else :src="coverPreview" alt="Prévia da nova capa" /><UiField label="Imagem da capa" for-id="book-cover" hint="JPEG, PNG ou WebP, até 8 MB."><input id="book-cover" type="file" accept="image/jpeg,image/png,image/webp" @change="chooseCover" /></UiField></div>
        <div class="metadata-fields"><UiField label="Título" for-id="book-title"><input id="book-title" v-model="editing.title" required /></UiField><UiField label="Autor" for-id="book-author"><input id="book-author" v-model="editing.author" /></UiField><UiField label="Descrição" for-id="book-description"><textarea id="book-description" v-model="editing.description" rows="5" /></UiField><div class="settings-grid"><UiField label="Idioma" for-id="book-language"><input id="book-language" v-model="editing.language" /></UiField><UiField label="Ano" for-id="book-year"><input id="book-year" v-model="editing.publishedYear" type="number" min="0" max="3000" /></UiField><UiField label="Série" for-id="book-series"><input id="book-series" v-model="editing.series" /></UiField><UiField label="Número na série" for-id="book-series-index"><input id="book-series-index" v-model="editing.seriesIndex" type="number" min="0" step="0.1" /></UiField></div><UiField label="Identificador" for-id="book-identifier"><input id="book-identifier" v-model="editing.identifier" /></UiField><UiField label="Gêneros" for-id="book-genres" hint="Separe por vírgulas."><input id="book-genres" v-model="editing.genresText" /></UiField></div>
        <div class="book-actions metadata-actions"><UiButton type="button" @click="editing=undefined">Cancelar</UiButton><UiButton type="submit" variant="primary" :disabled="saving">{{ saving?'Salvando…':'Salvar alterações' }}</UiButton></div>
      </form>
    </UiDialog>
  </div>
</template>

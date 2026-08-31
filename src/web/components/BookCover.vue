<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const props=defineProps<{ id: number; title: string; author?: string; hasCover?: boolean; format?: string }>()
const root=ref<HTMLElement>();const canvas=ref<HTMLCanvasElement>();const pdfReady=ref(false);const pdfFailed=ref(false);let observer:any;let task:any
async function renderFirstPage(){
  if(props.hasCover||props.format!=='pdf'||pdfReady.value)return
  try{await nextTick();const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;task=pdfjs.getDocument({url:`/api/v1/books/${props.id}/content`,withCredentials:true});const document=await task.promise;const page=await document.getPage(1);const base=page.getViewport({scale:1});const width=root.value?.clientWidth||180;const viewport=page.getViewport({scale:Math.max(.25,width/base.width)});const context=canvas.value!.getContext('2d')!;canvas.value!.width=viewport.width;canvas.value!.height=viewport.height;await page.render({canvas:canvas.value!,canvasContext:context,viewport}).promise;pdfReady.value=true}
  catch{pdfFailed.value=true}
}
onMounted(()=>{if(props.hasCover||props.format!=='pdf')return;if('IntersectionObserver'in window){observer=new window.IntersectionObserver((entries:any[])=>{if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();void renderFirstPage()}},{rootMargin:'200px'});observer.observe(root.value!)}else void renderFirstPage()})
onBeforeUnmount(()=>{observer?.disconnect();try{task?.destroy?.()}catch{/* Rendering may already be complete. */}})
</script>
<template>
  <div ref="root" class="book-cover">
    <img v-if="hasCover" :src="`/api/v1/books/${id}/cover`" :alt="`Capa de ${title}`" loading="lazy" />
    <canvas v-else-if="format==='pdf'&&!pdfFailed" ref="canvas" class="book-cover__pdf" :class="{'book-cover__pdf--ready':pdfReady}" role="img" :aria-label="`Primeira página de ${title}`" />
    <div v-else class="book-cover__fallback" :class="`book-cover__fallback--${id % 6}`" aria-hidden="true"><i>LITERA</i><span>{{ title }}</span><small>{{ author || 'Coleção particular' }}</small></div>
  </div>
</template>

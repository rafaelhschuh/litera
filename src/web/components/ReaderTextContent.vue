<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { PdfReflowBlock, PdfReflowFigure } from '../../shared/pdf-reflow'

defineProps<{
  blocks: PdfReflowBlock[]
  loading: boolean
  theme: 'light' | 'sepia' | 'dark'
  contentStyle: CSSProperties
  visualSrc?: string
  figures: PdfReflowFigure[]
  imageUrl: string
}>()
</script>

<template>
  <article :aria-busy="loading" class="reader-text-surface" :class="`reader-text-surface--${theme}`">
    <div class="reader-document" :style="contentStyle">
      <p v-if="loading" class="reader-text-status">Preparando esta página…</p>
      <figure v-for="(figure, index) in figures.filter(item => item.afterBlock === -1)" :key="`leading-${index}`" class="reader-document__visual"><img :src="`${imageUrl}&crop=${figure.crop.join(',')}`" alt="Ilustração da página" /></figure>
      <template v-for="(block, index) in blocks" :key="index">
        <component :is="block.kind" :data-reflow-block="index" :class="{ 'reader-document__center': block.align === 'center', 'reader-document__section': block.spaced }">
          <span v-for="(span, spanIndex) in block.spans" :key="spanIndex" :class="{ 'reader-document__bold': span.bold, 'reader-document__italic': span.italic }">{{ span.text }}</span>
        </component>
        <figure v-for="(figure, figureIndex) in figures.filter(item => item.afterBlock === index)" :key="figureIndex" class="reader-document__visual"><img :src="`${imageUrl}&crop=${figure.crop.join(',')}`" alt="Ilustração da página" /></figure>
      </template>
      <p v-if="!loading && !blocks.length" class="reader-text-status">{{ visualSrc ? 'Esta página não possui texto extraível; o conteúdo visual foi preservado.' : 'Esta página não tem conteúdo legível.' }}</p>
      <figure v-if="visualSrc" class="reader-document__visual" aria-label="Conteúdo visual preservado desta página">
        <img :src="visualSrc" alt="Conteúdo visual preservado desta página" />
      </figure>
    </div>
  </article>
</template>

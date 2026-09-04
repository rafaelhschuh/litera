<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import type { PdfReflowBlock, PdfReflowFigure } from '../../shared/pdf-reflow'

const props = defineProps<{
  blocks: PdfReflowBlock[]
  loading: boolean
  theme: 'light' | 'sepia' | 'dark'
  contentStyle: CSSProperties
  figures: PdfReflowFigure[]
  imageUrl: string
  resolveAsset?: (url: string) => string
}>()
const fontAssets = computed(() => [...new Set(props.blocks.flatMap(block => block.spans.map(span => span.fontAsset).filter((asset): asset is string => Boolean(asset))))])
function fontFamily(asset?: string) { return asset ? `litera-pdf-${asset.replace(/[^a-zA-Z0-9-]/g, '-')}` : undefined }
function assetUrl(asset: string) { const url = props.imageUrl + '&asset=' + encodeURIComponent(asset); return props.resolveAsset ? props.resolveAsset(url) : url }
const fontRules = computed(() => fontAssets.value.map(asset => `@font-face{font-family:${JSON.stringify(fontFamily(asset))};src:url(${JSON.stringify(assetUrl(asset))}) format("truetype");font-display:swap;}`).join('\n'))
</script>

<template>
  <article :aria-busy="loading" class="reader-text-surface" :class="`reader-text-surface--${theme}`">
    <component :is="'style'" v-if="fontRules">{{ fontRules }}</component>
    <div class="reader-document" :style="contentStyle">
      <p v-if="loading" class="reader-text-status">Preparando esta página…</p>
      <figure v-for="(figure, index) in figures.filter(item => item.asset && item.afterBlock === -1)" :key="`leading-${index}`" class="reader-document__visual"><img :src="assetUrl(figure.asset ?? '')" :width="figure.width" :height="figure.height" alt="Ilustração da página" /></figure>
      <template v-for="(block, index) in blocks" :key="index">
        <component :is="block.kind" :data-reflow-block="index" :class="{ 'reader-document__center': block.align === 'center', 'reader-document__section': block.spaced }">
          <span v-for="(span, spanIndex) in block.spans" :key="spanIndex" :style="span.fontAsset ? { fontFamily: fontFamily(span.fontAsset) } : undefined" :class="{ 'reader-document__bold': span.bold, 'reader-document__italic': span.italic }">{{ span.text }}</span>
        </component>
        <figure v-for="(figure, figureIndex) in figures.filter(item => item.asset && item.afterBlock === index)" :key="figureIndex" class="reader-document__visual"><img :src="assetUrl(figure.asset ?? '')" :width="figure.width" :height="figure.height" alt="Ilustração da página" /></figure>
      </template>
      <p v-if="!loading && !blocks.length && !figures.length" class="reader-text-status">Esta página não possui texto extraível. Abra o documento original para consultar o conteúdo.</p>
    </div>
  </article>
</template>

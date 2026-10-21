<script setup lang="ts">
import UiButton from './UiButton.vue'
import UiSwitch from './UiSwitch.vue'
import type { PdfReaderMode, PdfZoomMode } from '../../shared/pdf-reader'

defineProps<{
  format: 'epub' | 'pdf'
  mode: PdfReaderMode
  toolbarPosition: 'top' | 'bottom'
  textScale: number
  theme: 'light' | 'sepia' | 'dark'
  zoom: number
  zoomMode: PdfZoomMode
}>()
const lineHeight = defineModel<'compact' | 'normal' | 'relaxed'>('lineHeight', { required: true })
const margins = defineModel<'narrow' | 'normal' | 'wide'>('margins', { required: true })
const invert = defineModel<boolean>('invert', { required: true })
defineEmits<{
  toolbar: [position: 'top' | 'bottom']
  mode: []
  text: [delta: number]
  theme: [theme: 'light' | 'sepia' | 'dark']
  zoom: [delta: number]
  fit: [mode: 'fit-width' | 'fit-page']
  change: []
  save: []
  fullscreen: []
  search: []
}>()
</script>

<template>
  <div class="reader-settings">
    <fieldset>
      <legend>Posição dos controles</legend>
      <div class="reader-options">
        <UiButton :aria-pressed="toolbarPosition === 'top'" @click="$emit('toolbar', 'top')">Topo</UiButton>
        <UiButton :aria-pressed="toolbarPosition === 'bottom'" @click="$emit('toolbar', 'bottom')">Base</UiButton>
      </div>
    </fieldset>
    <fieldset v-if="format === 'pdf'">
      <legend>Modo de leitura</legend>
      <div class="reader-options">
        <UiButton :aria-pressed="mode === 'visual'" @click="mode !== 'visual' && $emit('mode')">Documento original</UiButton>
        <UiButton :aria-pressed="mode === 'reflow'" @click="mode !== 'reflow' && $emit('mode')">Texto adaptado</UiButton>
      </div>
    </fieldset>
    <template v-if="format === 'epub' || mode === 'reflow'">
      <fieldset>
        <legend>Tamanho do texto</legend>
        <div class="reader-stepper">
          <UiButton aria-label="Diminuir texto" :disabled="textScale <= 80" @click="$emit('text', -10)">−</UiButton>
          <output aria-label="Tamanho do texto">{{ textScale }}%</output>
          <UiButton aria-label="Aumentar texto" :disabled="textScale >= 140" @click="$emit('text', 10)">+</UiButton>
        </div>
      </fieldset>
      <label for="lines">Entrelinhas<select id="lines" v-model="lineHeight" @change="$emit('change')"><option value="compact">Compacta</option><option value="normal">Normal</option><option value="relaxed">Relaxada</option></select></label>
      <label for="margins">Largura do texto<select id="margins" v-model="margins" @change="$emit('change')"><option value="narrow">Estreita</option><option value="normal">Normal</option><option value="wide">Ampla</option></select></label>
      <fieldset>
        <legend>Tema</legend>
        <div class="reader-options">
          <UiButton v-for="choice in ([['light', 'Claro'], ['sepia', 'Sépia'], ['dark', 'Escuro']] as const)" :key="choice[0]" :aria-pressed="theme === choice[0]" @click="$emit('theme', choice[0])">{{ choice[1] }}</UiButton>
        </div>
      </fieldset>
    </template>
    <template v-else>
      <fieldset>
        <legend>Enquadramento</legend>
        <div class="reader-options">
          <UiButton :aria-pressed="zoomMode === 'fit-width'" @click="$emit('fit', 'fit-width')">Ajustar largura</UiButton>
          <UiButton :aria-pressed="zoomMode === 'fit-page'" @click="$emit('fit', 'fit-page')">Página inteira</UiButton>
        </div>
      </fieldset>
      <fieldset>
        <legend>Zoom manual</legend>
        <div class="reader-stepper">
          <UiButton aria-label="Diminuir zoom" :disabled="zoom <= .25" @click="$emit('zoom', -.2)">−</UiButton>
          <output aria-label="Zoom">{{ Math.round(zoom * 100) }}%</output>
          <UiButton aria-label="Aumentar zoom" :disabled="zoom >= 4" @click="$emit('zoom', .2)">+</UiButton>
        </div>
      </fieldset>
      <UiSwitch v-model="invert" label="Inverter cores" @update:model-value="$emit('save')" />
    </template>
    <div class="reader-options">
      <UiButton @click="$emit('search')">Buscar no livro</UiButton>
      <UiButton @click="$emit('fullscreen')">Alternar tela cheia</UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/* global Event */
import { useId } from 'vue'
import UiField from './UiField.vue'
import { readerFonts, type ReaderTypography } from '../../shared/reader-typography'

const typography = defineModel<ReaderTypography>({ required: true })
const emit = defineEmits<{ change: [] }>(), prefix = useId()
const ranges = [
  { key: 'marginSize', label: 'Margens laterais', min: 12, max: 80, step: 2, unit: 'px' },
  { key: 'marginTop', label: 'Margem superior', min: 0, max: 160, step: 4, unit: 'px' },
  { key: 'marginBottom', label: 'Margem inferior', min: 0, max: 160, step: 4, unit: 'px' },
  { key: 'lineSpacing', label: 'Entrelinhas', min: 1.2, max: 2.4, step: .05, unit: '×' },
  { key: 'letterSpacing', label: 'Espaço entre letras', min: 0, max: .12, step: .01, unit: 'em' },
  { key: 'paragraphSpacing', label: 'Espaço entre parágrafos', min: .5, max: 2, step: .1, unit: 'em' },
] as const
function update(key: keyof ReaderTypography, event: Event) {
  const value = (event.target as HTMLInputElement).value
  typography.value = { ...typography.value, [key]: key === 'fontFamily' || key === 'textAlign' ? value : Number(value) }
}
</script>

<template>
  <div class="reader-typography">
    <UiField label="Fonte" :for-id="`${prefix}-font`">
      <select :id="`${prefix}-font`" :value="typography.fontFamily" @change="update('fontFamily', $event); emit('change')"><option v-for="(font, key) in readerFonts" :key="key" :value="key">{{ font.label }}</option></select>
    </UiField>
    <UiField label="Alinhamento" :for-id="`${prefix}-align`">
      <select :id="`${prefix}-align`" :value="typography.textAlign" @change="update('textAlign', $event); emit('change')"><option value="publisher">Como no livro</option><option value="start">À esquerda</option><option value="justify">Justificado</option></select>
    </UiField>
    <UiField v-for="range in ranges" :key="range.key" :label="range.label" :for-id="`${prefix}-${range.key}`">
      <div class="reader-range"><input :id="`${prefix}-${range.key}`" :value="typography[range.key]" type="range" :min="range.min" :max="range.max" :step="range.step" @input="update(range.key, $event)" @change="emit('change')" /><output :for="`${prefix}-${range.key}`">{{ Number(typography[range.key].toFixed(2)) }} {{ range.unit }}</output></div>
    </UiField>
    <p class="reader-typography__preview" :style="{ fontFamily: readerFonts[typography.fontFamily].css, lineHeight: typography.lineSpacing, letterSpacing: `${typography.letterSpacing}em` }">Uma leitura no seu ritmo.</p>
  </div>
</template>

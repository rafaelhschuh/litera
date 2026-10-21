<script setup lang="ts">
/* global HTMLDialogElement, KeyboardEvent */
import { nextTick, ref, useId, watch } from 'vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; closeLabel?: string }>(), { closeLabel: 'Fechar' })
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
watch(() => props.open, async value => {
  await nextTick()
  if (value && !dialog.value?.open) dialog.value?.showModal()
  if (!value && dialog.value?.open) dialog.value.close()
}, { immediate: true })

function containFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[tabindex]') ?? [])]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>

<template>
  <dialog ref="dialog" class="dialog" :aria-labelledby="titleId" @keydown="containFocus" @close="emit('close')" @cancel.prevent="emit('close')">
    <header>
      <h2 :id="titleId">{{ title }}</h2>
      <button class="icon-button" :aria-label="closeLabel" @click="emit('close')"><UiIcon name="x" /></button>
    </header>
    <slot />
  </dialog>
</template>

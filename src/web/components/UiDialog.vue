<script setup lang="ts">
/* global HTMLDialogElement, KeyboardEvent, Animation */
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; closeLabel?: string; variant?: 'dialog' | 'sheet' }>(), { closeLabel: 'Fechar', variant: 'dialog' })
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
let closing: Animation | undefined, disposed = false, revision = 0
function reducedMotion() { return document.documentElement.dataset.reducedMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches }
async function close() {
  const element = dialog.value
  if (!element?.open) return
  if (closing) { await closing.finished.catch(() => undefined); return }
  const request = ++revision
  if (element.animate && !reducedMotion()) {
    const style = window.getComputedStyle(element), token = style.getPropertyValue(props.variant === 'sheet' ? '--motion-slow' : '--motion-normal').trim()
    element.dataset.closing = 'true'
    const offset = style.getPropertyValue(props.variant === 'sheet' ? '--space-6' : '--space-3').trim() || '0px'
    closing = element.animate([{ opacity: style.opacity, transform: style.transform }, { opacity: props.variant === 'sheet' ? 1 : 0, transform: `translateY(${offset}) scale(${props.variant === 'sheet' ? 1 : .98})` }], { duration: parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 180, easing: style.getPropertyValue('--ease-standard').trim() || 'ease-out', fill: 'both' })
    await closing.finished.catch(() => undefined)
  }
  if (disposed || request !== revision) return
  element.close(); closing?.cancel(); closing = undefined; delete element.dataset.closing
}
defineExpose({ close, isOpen: () => Boolean(dialog.value?.open) })
watch(() => props.open, async value => {
  await nextTick()
  if (disposed) return
  if (value) {
    revision++; closing?.cancel(); closing = undefined
    if (dialog.value) delete dialog.value.dataset.closing
    if (!dialog.value?.open) dialog.value?.showModal()
  } else await close()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; revision++; closing?.cancel() })
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
  <dialog ref="dialog" class="dialog" :class="{ 'dialog--sheet': variant === 'sheet' }" :aria-labelledby="titleId" @click="event => { if (props.variant === 'sheet' && event.target === dialog) void close() }" @keydown="containFocus" @close="emit('close')" @cancel.prevent="close">
    <header>
      <h2 :id="titleId">{{ title }}</h2>
      <button class="icon-button" :aria-label="closeLabel" @click="close"><UiIcon name="x" /></button>
    </header>
    <slot />
  </dialog>
</template>

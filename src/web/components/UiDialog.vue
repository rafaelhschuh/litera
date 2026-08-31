<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import UiIcon from './UiIcon.vue'
const props=defineProps<{open:boolean;title:string}>();const emit=defineEmits<{close:[]}>();const dialog=ref<{open:boolean;showModal:()=>void;close:()=>void}>()
watch(()=>props.open,async(value)=>{await nextTick();if(value&&!dialog.value?.open)dialog.value?.showModal();if(!value&&dialog.value?.open)dialog.value.close()},{immediate:true})
</script>
<template><dialog ref="dialog" class="dialog" :aria-labelledby="`${title}-dialog-title`" @close="emit('close')" @cancel.prevent="emit('close')"><header><h2 :id="`${title}-dialog-title`">{{ title }}</h2><button class="icon-button" aria-label="Fechar" @click="emit('close')"><UiIcon name="x" /></button></header><slot /></dialog></template>

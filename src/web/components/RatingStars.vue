<script setup lang="ts">
defineProps<{modelValue:number;label:string;disabled?:boolean}>()
const emit=defineEmits<{ 'update:modelValue':[value:number] }>()
</script>
<template>
  <div class="rating-stars" role="group" :aria-label="label">
    <button v-for="star in 5" :key="star" type="button" :disabled="disabled" :class="{'rating-stars__active':star<=modelValue}" :aria-label="`${star} de 5 estrelas`" :aria-pressed="modelValue===star" @click="emit('update:modelValue',modelValue===star?0:star)">★</button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label: string; description?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
<template>
  <label class="switch-row">
    <span><strong>{{ label }}</strong><small v-if="description">{{ description }}</small></span>
    <input type="checkbox" role="switch" :checked="props.modelValue" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" />
  </label>
</template>

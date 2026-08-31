<script setup lang="ts">
withDefaults(defineProps<{ type?: 'button' | 'submit'; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean }>(), { type: 'button', variant: 'secondary' })
</script>
<template><button :type="type" class="button" :class="`button--${variant}`" :disabled="disabled"><slot /></button></template>

<script setup lang="ts">
defineProps<{ value: number }>()
</script>
<template><div class="book-progress"><span :style="{ width: `${Math.round(value * 100)}%` }" /><small>{{ Math.round(value * 100) }}% lido</small></div></template>

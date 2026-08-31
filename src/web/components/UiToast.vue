<script setup lang="ts">defineProps<{ message: string; kind?: 'success' | 'error' }>()</script>
<template><p v-if="message" class="toast" :class="`toast--${kind||'success'}`" :role="kind==='error'?'alert':'status'">{{ message }}</p></template>

<script setup lang="ts">
// A short screen recording from public/media/: <Clip src="sql/run-query.mp4" caption="Running a query" />
import { withBase } from 'vitepress'

defineProps<{ src: string; caption?: string }>()
</script>

<template>
  <figure class="clip">
    <video :src="withBase('/media/' + src)" controls muted loop playsinline preload="metadata" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>

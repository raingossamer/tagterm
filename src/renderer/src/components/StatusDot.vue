<script setup lang="ts">
// 状态点四态（样式在 base.css 的 .dot）；M1 全部为 idle，M3 接入 agent 状态
withDefaults(defineProps<{ status?: 'idle' | 'working' | 'blocked' | 'done' }>(), {
  status: 'idle',
})
</script>

<template>
  <span class="dot" :class="status"></span>
</template>

<script setup lang="ts">
// 终端区：只提供容器给实例池并挂 ResizeObserver；点击空白处聚焦当前终端
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { TERMINAL_POOL_KEY } from '../terminal/poolKey'

const pool = inject(TERMINAL_POOL_KEY)!
const root = ref<HTMLDivElement | null>(null)
let observer: ResizeObserver | null = null

onMounted(() => {
  pool.attach(root.value!)
  observer = new ResizeObserver(() => pool.fitActive())
  observer.observe(root.value!)
})
onUnmounted(() => {
  observer?.disconnect()
  pool.detach()
})
</script>

<template>
  <div ref="root" class="term" data-test="terminal-pane" @click="pool.focusActive()"></div>
</template>

<style scoped>
.term {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--t-bg);
  padding: 4px 0 0 8px;
}
</style>

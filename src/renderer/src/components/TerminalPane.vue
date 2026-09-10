<script setup lang="ts">
// 终端区：提供容器给实例池并挂 ResizeObserver；点击空白处聚焦当前终端。
// 背景图（data: URL）与黑色遮罩铺在实例池容器下方，xterm 本身背景透明（theme.ts）
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { TERMINAL_POOL_KEY } from '../terminal/poolKey'
import { useSettingsStore } from '../stores/settings'

const pool = inject(TERMINAL_POOL_KEY)!
const settings = useSettingsStore()
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
  <div class="term-wrap">
    <div
      v-if="settings.backgroundImage"
      class="bg"
      :style="{ backgroundImage: `url(${settings.backgroundImage})` }"
      data-test="terminal-bg"
    >
      <div
        class="dim"
        :style="{ opacity: settings.terminalBackground.dimOpacity }"
        data-test="terminal-dim"
      ></div>
    </div>
    <div ref="root" class="term" data-test="terminal-pane" @click="pool.focusActive()"></div>
  </div>
</template>

<style scoped>
.term-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--t-bg);
}
.bg,
.term {
  position: absolute;
  inset: 0;
}
.bg {
  background-size: cover;
  background-position: center;
}
.dim {
  position: absolute;
  inset: 0;
  background: #000;
}
.term {
  padding: 4px 0 0 8px;
}
</style>

<script setup lang="ts">
// 全局背景层：整窗口只有这一层，铺满、按显示方式缩放、整体模糊与淡化（决策 3）。
// 模糊只在这一层算一次，不用 backdrop-filter（每个面板各自模糊在缩放 / 侧栏动画时太贵）。
// 没有背景图时整层不渲染，面板由 App 恢复为完全不透明。
import { computed } from 'vue'
import { useSettingsStore } from '../stores/settings'

const settings = useSettingsStore()

const style = computed(() => {
  const bg = settings.background
  const isTile = bg.fit === 'tile'
  return {
    backgroundImage: `url(${settings.backgroundImage})`,
    backgroundSize: isTile ? 'auto' : bg.fit,
    backgroundRepeat: isTile ? 'repeat' : 'no-repeat',
    opacity: String(bg.imageOpacity),
    filter: bg.blurPx > 0 ? `blur(${bg.blurPx}px)` : 'none',
    // 模糊会把边缘晕成底色，放大一点让虚边落到窗口外
    transform: bg.blurPx > 0 ? 'scale(1.06)' : 'none',
  }
})
</script>

<template>
  <div
    v-if="settings.backgroundImage"
    class="app-bg"
    :style="style"
    data-test="app-background"
  ></div>
</template>

<style scoped>
.app-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  background-position: center;
  pointer-events: none;
}
</style>

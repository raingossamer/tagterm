<script setup lang="ts">
// 全局背景层：整窗口只有这一层，铺满、按显示方式缩放、整体模糊与淡化（决策 3）。
// 模糊只在这一层算一次，不用 backdrop-filter（每个面板各自模糊在缩放 / 侧栏动画时太贵）。
// 没有背景图时整层不渲染，面板不透明度回到 1。
// 面板不透明度写在根元素 <html> 的 --panel-opacity 上，而不是 .app：tokens.css 的各面板底色是在 :root 上
// 用 color-mix 派生的，自定义属性在声明处就把 var() 换成了值、后代只继承算好的颜色，
// 写在 .app 上变量本身是对的、派生出来的底色却纹丝不动（0.2.4 就是这样把背景整个盖住的）。
import { computed, onUnmounted, watchEffect } from 'vue'
import { useSettingsStore } from '../stores/settings'

const PANEL_OPACITY_VAR = '--panel-opacity'

const settings = useSettingsStore()

watchEffect(() => {
  document.documentElement.style.setProperty(PANEL_OPACITY_VAR, String(settings.panelOpacity))
})
onUnmounted(() => document.documentElement.style.removeProperty(PANEL_OPACITY_VAR))

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

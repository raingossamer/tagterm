<script setup lang="ts">
// 终端区：把容器交给会话生命周期核心（内部实例池）并挂 ResizeObserver；点击空白处聚焦当前终端。
// 背景图由 App 的全局背景层提供（决策 3），这里只留半透明底色，xterm 本身背景透明（theme.ts）。
// Ctrl+滚轮 / Ctrl+0 调字号时右上角浮出「字号 N」，停手 1 秒消失（到上下限再滚也浮出，让人知道到头了）
import { inject, onMounted, onUnmounted, ref } from 'vue'
import type { Unsubscribe } from '@shared/api'
import { TERMINAL_WORKSPACE_KEY } from '../terminal/workspaceKey'
import { createDebounced } from '../composables/debounce'

/** 尺寸变化后多久才真正 fit：拖动窗口时 ResizeObserver 逐帧回调，逐帧 fit 会卡顿并闪烁 */
const FIT_DEBOUNCE_MS = 80
/** 字号小牌停手后多久消失 */
const FONT_BADGE_MS = 1000

const workspace = inject(TERMINAL_WORKSPACE_KEY)!
const root = ref<HTMLDivElement | null>(null)
let observer: ResizeObserver | null = null
const scheduleFit = createDebounced(() => workspace.fitActive(), FIT_DEBOUNCE_MS)

const badgeFontSize = ref<number | null>(null)
let badgeTimer: ReturnType<typeof setTimeout> | null = null
let offFontZoom: Unsubscribe | null = null

function showFontBadge(size: number): void {
  badgeFontSize.value = size
  if (badgeTimer) clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => {
    badgeFontSize.value = null
    badgeTimer = null
  }, FONT_BADGE_MS)
}

onMounted(() => {
  workspace.attach(root.value!)
  observer = new ResizeObserver(() => scheduleFit.call())
  observer.observe(root.value!)
  offFontZoom = workspace.onFontZoom(showFontBadge)
})
onUnmounted(() => {
  observer?.disconnect()
  scheduleFit.cancel()
  offFontZoom?.()
  if (badgeTimer) clearTimeout(badgeTimer)
  workspace.detach()
})
</script>

<template>
  <div class="term-wrap">
    <div ref="root" class="term" data-test="terminal-pane" @click="workspace.focusActive()"></div>
    <div
      v-if="badgeFontSize !== null"
      class="font-badge"
      data-test="font-size-badge"
      v-text="`字号 ${badgeFontSize}`"
    ></div>
  </div>
</template>

<style scoped>
.term-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--t-bg-soft);
  /* 输入法组合串在光标处显示，光标靠近右缘时 xterm 的 composition-view 与隐藏 textarea 会伸出终端区；
     浏览器为了让聚焦的 textarea 露出来会去滚最近的滚动容器 —— body 的 overflow: hidden 也算滚动容器，
     结果整个窗口内容（含左栏）被往左挤。clip 只裁不滚、也不把溢出算进祖先的可滚范围，窗口就再也挤不动 */
  overflow: clip;
}
.term {
  position: absolute;
  inset: 0;
  padding: 4px 0 0 8px;
}
/* xterm 6 自带的 xterm.css 给铺满终端区的 .xterm-viewport 写死了 background-color: #000（注释说是给 macOS 滚动条用的），
   它垫在画布下面，终端文字区因此永远纯黑、透不出全局背景（与渲染器无关，WebGL / DOM 都一样）。
   覆盖成透明后底色只剩 .term-wrap 的 --t-bg-soft：不设背景是 #0C0C0C，设了背景随面板不透明度半透明。
   :deep 让特异性高过 xterm.css 的同名规则；烟测取真实像素核查（termBackground） */
.term :deep(.xterm .xterm-viewport) {
  background-color: transparent;
}
/* 字号小牌：浮在终端右上角，不挡点击 */
.font-badge {
  position: absolute;
  top: 8px;
  right: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--panel2);
  color: var(--text);
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  pointer-events: none;
}
</style>

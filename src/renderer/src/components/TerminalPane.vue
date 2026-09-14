<script setup lang="ts">
// 终端区：把容器交给会话生命周期核心（内部实例池）并挂 ResizeObserver；点击空白处聚焦当前终端。
// 背景图由 App 的全局背景层提供（决策 3），这里只留半透明底色，xterm 本身背景透明（theme.ts）
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { TERMINAL_WORKSPACE_KEY } from '../terminal/workspaceKey'
import { createDebounced } from '../composables/debounce'

/** 尺寸变化后多久才真正 fit：拖动窗口时 ResizeObserver 逐帧回调，逐帧 fit 会卡顿并闪烁 */
const FIT_DEBOUNCE_MS = 80

const workspace = inject(TERMINAL_WORKSPACE_KEY)!
const root = ref<HTMLDivElement | null>(null)
let observer: ResizeObserver | null = null
const scheduleFit = createDebounced(() => workspace.fitActive(), FIT_DEBOUNCE_MS)

onMounted(() => {
  workspace.attach(root.value!)
  observer = new ResizeObserver(() => scheduleFit.call())
  observer.observe(root.value!)
})
onUnmounted(() => {
  observer?.disconnect()
  scheduleFit.cancel()
  workspace.detach()
})
</script>

<template>
  <div class="term-wrap">
    <div ref="root" class="term" data-test="terminal-pane" @click="workspace.focusActive()"></div>
  </div>
</template>

<style scoped>
.term-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--t-bg-soft);
}
.term {
  position: absolute;
  inset: 0;
  padding: 4px 0 0 8px;
}
</style>

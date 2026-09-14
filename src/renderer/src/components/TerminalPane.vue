<script setup lang="ts">
// 终端区：把容器交给会话生命周期核心（内部实例池）并挂 ResizeObserver；点击空白处聚焦当前终端。
// 背景图（data: URL）与黑色遮罩铺在终端容器下方，xterm 本身背景透明（theme.ts）
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { TERMINAL_WORKSPACE_KEY } from '../terminal/workspaceKey'
import { useSettingsStore } from '../stores/settings'
import { createDebounced } from '../composables/debounce'

/** 尺寸变化后多久才真正 fit：拖动窗口时 ResizeObserver 逐帧回调，逐帧 fit 会卡顿并闪烁 */
const FIT_DEBOUNCE_MS = 80

const workspace = inject(TERMINAL_WORKSPACE_KEY)!
const settings = useSettingsStore()
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
    <div ref="root" class="term" data-test="terminal-pane" @click="workspace.focusActive()"></div>
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

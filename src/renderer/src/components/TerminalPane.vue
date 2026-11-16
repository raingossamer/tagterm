<script setup lang="ts">
// 终端区：把容器交给会话生命周期核心（内部实例池）并挂 ResizeObserver；点击空白处聚焦当前终端。
// 背景图由 App 的全局背景层提供（决策 3），这里只留半透明底色，xterm 本身背景透明（theme.ts）。
// 右上角浮层：终端内搜索框（Ctrl+Shift+F，TerminalSearch）与字号小牌 —— Ctrl+滚轮 / Ctrl+0 调字号时浮出「字号 N」，
// 停手 1 秒消失（到上下限再滚也浮出，让人知道到头了）；两者同时出现时小牌排在搜索框下面。
// 拖文字进来（备忘小窗的事项，或别的程序的文字；memo-floating-window 决策 5）：当前终端在运行时出现「松开插入到「会话名」」，
// 松手按粘贴送进终端（不加回车）并请主进程激活主窗口（Windows 拖放不激活目标窗口）；文件、空文字、终端没在运行都不收
import { inject, onMounted, onUnmounted, ref } from 'vue'
import type { Unsubscribe } from '@shared/api'
import { TERMINAL_WORKSPACE_KEY } from '../terminal/workspaceKey'
import { createDebounced } from '../composables/debounce'
import { useSessionsStore } from '../stores/sessions'
import TerminalSearch from './TerminalSearch.vue'

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

const sessions = useSessionsStore()
/** 拖文字经过时的提示（当前会话名）；null = 不显示 */
const dropTarget = ref<string | null>(null)
/** dragenter / dragleave 会在内部子元素之间成对冒上来，计数归零才算真的离开 */
let dragDepth = 0

/** 收不收这次拖动：只收文字（拖文件不收），而且当前终端要在运行 */
function acceptsDrag(e: DragEvent): boolean {
  const types = [...(e.dataTransfer?.types ?? [])]
  return types.includes('text/plain') && !types.includes('Files') && workspace.canPaste()
}

function onDragEnter(e: DragEvent): void {
  if (!acceptsDrag(e)) return
  dragDepth += 1
  const activeId = workspace.snapshot().activeId
  dropTarget.value = (activeId && sessions.byId(activeId)?.name) || '当前终端'
}

function onDragOver(e: DragEvent): void {
  if (!acceptsDrag(e)) return
  e.preventDefault() // 不拦 dragover 浏览器就不让放
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(): void {
  if (dragDepth === 0) return
  dragDepth -= 1
  if (dragDepth === 0) dropTarget.value = null
}

function onDrop(e: DragEvent): void {
  const accepted = acceptsDrag(e)
  dragDepth = 0
  dropTarget.value = null
  if (!accepted) return
  e.preventDefault() // 也挡住浏览器把文字插进 xterm 隐藏 textarea 的默认行为（否则会再发一遍）
  const text = e.dataTransfer?.getData('text/plain') ?? ''
  if (!text.trim()) return
  if (workspace.pasteToActive(text)) window.tagterm.app.focusMainWindow()
}

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
  <div
    class="term-wrap"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div ref="root" class="term" data-test="terminal-pane" @click="workspace.focusActive()"></div>
    <div v-if="dropTarget !== null" class="drop" data-test="terminal-drop">
      <span v-text="`松开插入到「${dropTarget}」`"></span>
    </div>
    <div class="overlay">
      <TerminalSearch />
      <div
        v-if="badgeFontSize !== null"
        class="font-badge"
        data-test="font-size-badge"
        v-text="`字号 ${badgeFontSize}`"
      ></div>
    </div>
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
/* 留白用定位偏移而不是 padding：实例池的 host 是 absolute + inset 0，以本元素的内边距盒为准，
   padding 对它无效（2026-11-06 前写的 padding 从没生效，终端第一列紧贴左栏）。
   左 4 px ≈ 14 号字半个英文字符，上 4 px 让提示符不贴路径条；FitAddon 按缩进后的盒量列数 */
.term {
  position: absolute;
  inset: 4px 0 0 4px;
}
/* xterm 6 自带的 xterm.css 给铺满终端区的 .xterm-viewport 写死了 background-color: #000（注释说是给 macOS 滚动条用的），
   它垫在画布下面，终端文字区因此永远纯黑、透不出全局背景（与渲染器无关，WebGL / DOM 都一样）。
   覆盖成透明后底色只剩 .term-wrap 的 --t-bg-soft：不设背景是 #0C0C0C，设了背景随面板不透明度半透明。
   :deep 让特异性高过 xterm.css 的同名规则；烟测取真实像素核查（termBackground） */
.term :deep(.xterm .xterm-viewport) {
  background-color: transparent;
}
/* 同一个 .xterm-viewport 还写死了 overflow-y: scroll：xterm 6 的滚动改由自绘滚动条（滑块已在 theme.ts 设透明）接管，
   这个元素却一直挂着一条系统原生滚动条（带上下箭头）贴在终端右缘。藏起来不影响滚动，与左栏、标签页栏同一写法
   （用户 2026-11-06 要求）；FitAddon 量列数时预留的是自绘滚动条的宽度，与它无关 */
.term :deep(.xterm .xterm-viewport) {
  scrollbar-width: none;
}
.term :deep(.xterm .xterm-viewport::-webkit-scrollbar) {
  display: none;
}
/* 拖文字经过时的落点提示：虚线框 + 居中的「松开插入到「会话名」」；不挡拖放事件（落在下面的终端上） */
.drop {
  position: absolute;
  inset: 6px;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  pointer-events: none;
  z-index: 2;
}
.drop span {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font: 600 13px var(--font);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent);
}
/* 右上角浮层：搜索框在上、字号小牌在下；浮层本身不挡点击（搜索框自己接事件） */
.overlay {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  pointer-events: none;
}
.font-badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--panel2);
  color: var(--text);
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  pointer-events: none;
}
</style>

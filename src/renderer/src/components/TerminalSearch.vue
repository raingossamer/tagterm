<script setup lang="ts">
// 终端内搜索框（Ctrl+Shift+F）：浮在终端区右上角，查当前会话终端的全部回滚内容（不区分大小写的普通文本）。
// Ctrl+Shift+F 在 document 上监听（焦点在终端里也能收到：xterm 对它返回 false、不写 pty）；已开着时聚焦并全选。
// 输入即搜、Enter / Shift+Enter 下一处 / 上一处；Esc 或 × 关闭并清高亮、焦点回终端；切到别的会话即关。
// 搜索词记在组件里，再打开时预填并全选（不跨重启）
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Unsubscribe } from '@shared/api'
import type { SearchResult } from '../terminal/TerminalInstance'
import { SEARCH_HIGHLIGHT_LIMIT } from '../terminal/theme'
import { TERMINAL_WORKSPACE_KEY } from '../terminal/workspaceKey'
import { useWorkspaceStore } from '../stores/workspace'

const core = inject(TERMINAL_WORKSPACE_KEY)!
const workspace = useWorkspaceStore()

const isOpen = ref(false)
const query = ref('')
const result = ref<SearchResult | null>(null)
/** 搜索框是为哪个会话打开的：结果按它认领，切走时清它的高亮 */
const sessionId = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)

const countText = computed(() => {
  const r = result.value
  if (!r) return ''
  if (r.count === 0) return '无结果'
  if (r.index < 0)
    return `共 ${r.count >= SEARCH_HIGHLIGHT_LIMIT ? `${SEARCH_HIGHLIGHT_LIMIT}+` : r.count} 处`
  return `第 ${r.index + 1} 处，共 ${r.count} 处`
})

async function open(): Promise<void> {
  if (workspace.activeId === null) return
  if (!isOpen.value) {
    isOpen.value = true
    sessionId.value = workspace.activeId
    result.value = null
    await nextTick()
  }
  input.value?.focus()
  input.value?.select()
}

/** 关闭并清掉那个会话的高亮；refocus 为真时把焦点交还当前终端 */
function close(refocus: boolean): void {
  if (!isOpen.value) return
  if (sessionId.value) core.clearSearch(sessionId.value)
  isOpen.value = false
  sessionId.value = null
  result.value = null
  if (refocus) core.focusActive()
}

function onInput(e: Event): void {
  query.value = (e.target as HTMLInputElement).value
  if (query.value === '') {
    if (sessionId.value) core.clearSearch(sessionId.value)
    result.value = null
    return
  }
  core.find(query.value, 'next', { incremental: true })
}

function step(direction: 'next' | 'previous'): void {
  if (query.value !== '') core.find(query.value, direction)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    step(e.shiftKey ? 'previous' : 'next')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close(true)
  }
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return
  e.preventDefault()
  void open()
}

// 切到别的会话（左栏 / 标签页 / 通知）即关；新终端由核心显示时自己拿焦点
watch(
  () => workspace.activeId,
  (id) => {
    if (isOpen.value && id !== sessionId.value) close(false)
  },
)

let offResults: Unsubscribe | null = null
onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
  offResults = core.onSearchResults((id, r) => {
    if (isOpen.value && id === sessionId.value) result.value = r
  })
})
onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  offResults?.()
  close(false)
})
</script>

<template>
  <div v-if="isOpen" class="find" data-test="terminal-search">
    <input
      ref="input"
      class="find-input"
      data-test="terminal-search-input"
      placeholder="在终端中查找"
      :value="query"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
    />
    <span class="find-count" data-test="terminal-search-count" v-text="countText"></span>
    <button
      class="find-btn"
      data-test="terminal-search-prev"
      title="上一处（Shift+Enter）"
      @click="step('previous')"
    >
      ↑
    </button>
    <button
      class="find-btn"
      data-test="terminal-search-next"
      title="下一处（Enter）"
      @click="step('next')"
    >
      ↓
    </button>
    <button
      class="find-btn"
      data-test="terminal-search-close"
      title="关闭（Esc）"
      @click="close(true)"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.find {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  pointer-events: auto;
}
.find-input {
  width: 180px;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: #fff;
  font-size: 12px;
}
.find-count {
  min-width: 84px;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.find-btn {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--muted);
  font-size: 13px;
  line-height: 22px;
  text-align: center;
}
.find-btn:hover {
  background: var(--accent-soft);
  color: var(--text);
}
</style>

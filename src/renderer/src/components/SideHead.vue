<script setup lang="ts">
// 左栏头部：品牌行 + 搜索框。输入即写入 filter.search（分组算法据此过滤）；
// Ctrl+K 在 document 上监听（焦点在终端里也能抢到：xterm 对 Ctrl+K 返回 false 且不 preventDefault），
// 聚焦并全选搜索框；搜索框内 Esc 清空搜索词并把焦点交还当前终端
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { useFilterStore } from '../stores/filter'
import { TERMINAL_POOL_KEY } from '../terminal/poolKey'

const filter = useFilterStore()
const pool = inject(TERMINAL_POOL_KEY, null)
const input = ref<HTMLInputElement | null>(null)

function onInput(e: Event): void {
  filter.setSearch((e.target as HTMLInputElement).value)
}

function onEscape(): void {
  filter.setSearch('')
  pool?.focusActive()
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    input.value?.focus()
    input.value?.select()
  }
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown))
</script>

<template>
  <div class="side-head">
    <div class="brand"><b>TagTerm</b><span>会话即路径，标签可交叉</span></div>
    <input
      ref="input"
      class="search"
      type="search"
      :value="filter.search"
      placeholder="搜索会话名或路径　Ctrl+K"
      autocomplete="off"
      data-test="search-input"
      @input="onInput"
      @keydown.esc.prevent="onEscape"
    />
  </div>
</template>

<style scoped>
.side-head {
  padding: 12px 12px 8px;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.brand b {
  font-size: 15px;
  font-weight: 600;
}
.brand span {
  color: var(--muted);
  font-size: 12px;
}
.search {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
}
</style>

<script setup lang="ts">
// 标签筛选区：「按标签筛选」+ 任一 / 全部分段 + 清除（有选中时可见）+ 标签 chips（色点 + 名 + 会话数，
// 计数为全部会话、不受筛选影响）；没有标签时提示到「管理标签」创建
import { useFilterStore } from '../stores/filter'
import { useTagsStore } from '../stores/tags'

const filter = useFilterStore()
const tags = useTagsStore()
</script>

<template>
  <div class="filter" data-test="tag-filter">
    <div class="filter-row">
      <span>按标签筛选</span>
      <span class="seg">
        <button
          :class="{ on: filter.mode === 'any' }"
          title="含任一选中标签"
          data-test="mode-any"
          @click="filter.setMode('any')"
        >
          任一
        </button>
        <button
          :class="{ on: filter.mode === 'all' }"
          title="同时含所有选中标签"
          data-test="mode-all"
          @click="filter.setMode('all')"
        >
          全部
        </button>
      </span>
      <button
        class="link"
        :style="{ visibility: filter.selected.size ? 'visible' : 'hidden' }"
        data-test="filter-clear"
        @click="filter.clear()"
      >
        清除
      </button>
    </div>
    <div class="chips">
      <template v-if="tags.sortedTags.length">
        <button
          v-for="t in tags.sortedTags"
          :key="t.id"
          class="chip"
          :class="{ on: filter.selected.has(t.id) }"
          :style="{ '--c': t.color }"
          data-test="tag-chip"
          @click="filter.toggle(t.id)"
        >
          <i></i>{{ t.name }}<em data-test="chip-count">{{ tags.countOf(t.id) }}</em>
        </button>
      </template>
      <span v-else class="hint" data-test="filter-hint">还没有标签，在"管理标签"里创建</span>
    </div>
  </div>
</template>

<style scoped>
.filter {
  padding: 4px 12px 10px;
  border-bottom: 1px solid var(--line);
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--muted);
}
.seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}
.seg button {
  padding: 2px 9px;
  font-size: 12px;
  color: var(--muted);
}
.seg button.on {
  background: var(--text);
  color: #fff;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>

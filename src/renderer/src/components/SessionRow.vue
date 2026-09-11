<script setup lang="ts">
// 一行会话：状态点 + 名称 + 路径末两段 + 右侧标签色点；tooltip 为完整路径，多标签时追加「同时在：a、b」；
// active 行左侧蓝条；peer = 同一会话在其他分组的副本正被悬停（一起高亮）。M3 前状态点一律 idle
import { computed } from 'vue'
import type { Session, Tag } from '@shared/models'
import StatusDot from './StatusDot.vue'
import { pathTail } from '../composables/path'

const props = defineProps<{ session: Session; active: boolean; tags: Tag[]; peer: boolean }>()
const emit = defineEmits<{ select: [id: string]; hover: [id: string]; leave: [id: string] }>()

const tooltip = computed(() =>
  props.tags.length > 1
    ? `${props.session.cwd}\n同时在：${props.tags.map((t) => t.name).join('、')}`
    : props.session.cwd,
)
</script>

<template>
  <button
    class="row"
    :class="{ active, peer }"
    :title="tooltip"
    data-test="session-row"
    @click="emit('select', session.id)"
    @mouseenter="emit('hover', session.id)"
    @mouseleave="emit('leave', session.id)"
  >
    <StatusDot />
    <span class="txt">
      <div class="name">{{ session.name }}</div>
      <div class="path" data-test="row-path">{{ pathTail(session.cwd) }}</div>
    </span>
    <span class="dots" data-test="row-tags">
      <i v-for="t in tags" :key="t.id" :style="{ background: t.color }" data-test="row-tag-dot" />
    </span>
  </button>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px 6px 22px;
  border-radius: 6px;
  text-align: left;
  position: relative;
}
.row:hover,
.row.peer {
  background: #e4e8ed;
}
.row.active,
.row.active.peer {
  background: var(--accent-soft);
}
.row.active::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
}
.row .txt {
  min-width: 0;
  flex: 1;
}
.row .name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row .path {
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--mono);
}
.row .dots {
  display: flex;
  gap: 3px;
  flex: none;
}
.row .dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
</style>

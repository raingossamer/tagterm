<script setup lang="ts">
// 一行会话：状态点 + 名称 + 路径末两段；tooltip 为完整路径；active 行左侧蓝条
import type { Session } from '@shared/models'
import StatusDot from './StatusDot.vue'
import { pathTail } from '../composables/path'

defineProps<{ session: Session; active: boolean }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <button
    class="row"
    :class="{ active }"
    :title="session.cwd"
    data-test="session-row"
    @click="emit('select', session.id)"
  >
    <StatusDot />
    <span class="txt">
      <div class="name">{{ session.name }}</div>
      <div class="path" data-test="row-path">{{ pathTail(session.cwd) }}</div>
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
</style>

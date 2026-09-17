<script setup lang="ts">
// 一行会话：状态点 + 名称 + 路径末两段 + 右侧标签色点；
// tooltip 为完整路径，多标签时追加「同时在：a、b」；active 行左侧蓝条；peer = 同一会话在其他分组的副本正被悬停（一起高亮）。
// 根元素是 div[role=button]：click / Enter / Space 选中，右键发 menu 给父组件弹菜单（移除会话在菜单里）。状态点由父组件从 agent store 取好传进来
// 排序拖拽是**整行**可拖、不加手柄：会话行是高频主操作区，行里已经挤了状态点 / 名称 / 路径 / 标签色点。
// 拖拽只上抛事件（起点 / 落点 / 结束），是否同组、新顺序算成什么，全由 SessionGroups 裁决
import { computed } from 'vue'
import type { AgentStatus, Session, Tag } from '@shared/models'
import StatusDot from './StatusDot.vue'
import { pathTail } from '../composables/path'

const props = withDefaults(
  defineProps<{
    session: Session
    active: boolean
    tags: Tag[]
    peer: boolean
    /** 能否拖拽排序：左栏正在搜索时为假（组内只剩子集，拖了容易误解） */
    canDrag: boolean
    /** 运行时状态（agent store 的 statusOf），缺省空闲 */
    status?: AgentStatus
    /** 等你确认时的那一行提示（tooltip 追加显示） */
    pendingHint?: string
  }>(),
  { status: 'idle', pendingHint: undefined },
)
const emit = defineEmits<{
  select: [id: string]
  hover: [id: string]
  leave: [id: string]
  menu: [id: string, x: number, y: number]
  dragStart: [id: string]
  dropOn: [id: string]
  dragEnd: []
}>()

function onDragStart(e: DragEvent): void {
  e.dataTransfer?.setData('text/plain', props.session.id) // Firefox 需要设点数据才启动拖拽
  emit('dragStart', props.session.id)
}

// tooltip：完整路径；多标签追加「同时在：a、b」；等你确认追加「等你确认：<提示>」（不切过去也知道它在问什么）
const tooltip = computed(() => {
  const lines = [props.session.cwd]
  if (props.tags.length > 1) lines.push(`同时在：${props.tags.map((t) => t.name).join('、')}`)
  if (props.status === 'blocked' && props.pendingHint) lines.push(`等你确认：${props.pendingHint}`)
  return lines.join('\n')
})

function onContextMenu(e: MouseEvent): void {
  emit('menu', props.session.id, e.clientX, e.clientY)
}
</script>

<template>
  <div
    class="row"
    :class="{ active, peer }"
    role="button"
    tabindex="0"
    :title="tooltip"
    :draggable="canDrag"
    data-test="session-row"
    @dragstart="onDragStart"
    @dragover.prevent
    @drop.prevent="emit('dropOn', session.id)"
    @dragend="emit('dragEnd')"
    @click="emit('select', session.id)"
    @keydown.enter.prevent="emit('select', session.id)"
    @keydown.space.prevent="emit('select', session.id)"
    @contextmenu.prevent="onContextMenu"
    @mouseenter="emit('hover', session.id)"
    @mouseleave="emit('leave', session.id)"
  >
    <StatusDot :status="status" />
    <span class="txt">
      <div class="name">{{ session.name }}</div>
      <div class="path" data-test="row-path">{{ pathTail(session.cwd) }}</div>
    </span>
    <span class="dots" data-test="row-tags">
      <i v-for="t in tags" :key="t.id" :style="{ background: t.color }" data-test="row-tag-dot" />
    </span>
  </div>
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
  cursor: pointer;
  user-select: none;
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

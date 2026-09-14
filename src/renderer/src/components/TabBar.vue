<script setup lang="ts">
// 标签页栏：☰ 收起 / 展开左栏、每个打开的会话一个标签页（状态点 + 名称 + ×）、＋ 新建会话。
// 关闭标签页只从 openTabs 移除，pty 与终端实例都保留。
import { computed } from 'vue'
import StatusDot from './StatusDot.vue'
import { useSessionsStore } from '../stores/sessions'
import { useWorkspaceStore } from '../stores/workspace'

const sessions = useSessionsStore()
const workspace = useWorkspaceStore()
const emit = defineEmits<{ select: [id: string]; newSession: [] }>()

const tabs = computed(() =>
  workspace.openTabs
    .map((id) => sessions.byId(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined),
)

function onTabKeydown(e: KeyboardEvent, id: string): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('select', id)
  }
}
</script>

<template>
  <div class="tabs">
    <button
      class="tab-side"
      title="收起/展开左栏"
      data-test="tab-side"
      @click="workspace.toggleSide()"
    >
      ☰
    </button>
    <div
      v-for="s in tabs"
      :key="s.id"
      class="tab"
      :class="{ active: s.id === workspace.activeId }"
      role="button"
      tabindex="0"
      data-test="tab"
      @click="emit('select', s.id)"
      @keydown="onTabKeydown($event, s.id)"
    >
      <StatusDot />
      <span data-test="tab-name">{{ s.name }}</span>
      <button
        class="x"
        title="关闭标签页（会话继续在后台保持）"
        data-test="tab-close"
        @click.stop="workspace.closeTab(s.id)"
      >
        ×
      </button>
    </div>
    <button class="tab-add" title="新建会话" data-test="tab-add" @click="emit('newSession')">
      ＋
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 8px 8px 0;
  height: 44px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 12px;
  border-radius: 8px 8px 0 0;
  background: #dce0e6;
  color: var(--muted);
  font-size: 13px;
  max-width: 200px;
  white-space: nowrap;
  cursor: default;
  flex: none;
}
.tab:hover {
  background: #d2d7de;
}
.tab.active,
.tab.active:hover {
  background: var(--t-bg-soft);
  color: #fff;
}
.tab .x {
  opacity: 0.5;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1;
}
.tab .x:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.15);
}
.tab.active .x:hover {
  background: rgba(255, 255, 255, 0.2);
}
.tab-add,
.tab-side {
  padding: 6px 10px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1;
  border-radius: 6px;
  margin-bottom: 3px;
  flex: none;
}
.tab-add:hover,
.tab-side:hover {
  background: #dce0e6;
  color: var(--text);
}
</style>

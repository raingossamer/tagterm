<script setup lang="ts">
// 标签页栏：☰ 收起 / 展开左栏、每个打开的会话一个标签页（状态点 + 名称 + ×）、＋ 新建会话。
// 关闭标签页只从 openTabs 移除，pty 与终端实例都保留。
// 标签页一多：☰ / ＋ 钉在两端只让中间滚动，标签页先压窄（200 → 100 px）再滚，当前页变化时滚进视野，竖向滚轮转横向。
import { computed, nextTick, ref, watch } from 'vue'
import StatusDot from './StatusDot.vue'
import { useAgentStore } from '../stores/agent'
import { useSessionsStore } from '../stores/sessions'
import { useWorkspaceStore } from '../stores/workspace'

const sessions = useSessionsStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const emit = defineEmits<{ select: [id: string]; newSession: [] }>()

const tabs = computed(() =>
  workspace.openTabs
    .map((id) => sessions.byId(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined),
)

/** tooltip 恒为完整会话名（压窄后名字会被截断）；等你确认时再加一行提示 */
function tabTitle(id: string, name: string): string {
  const runtime = agent.runtimeOf(id)
  return runtime?.status === 'blocked' && runtime.pendingHint
    ? `${name}\n等你确认：${runtime.pendingHint}`
    : name
}

const scroller = ref<HTMLElement | null>(null)

/** 当前页变化（左栏点选、通知点击、启动恢复）时滚进视野；nearest 只滚标签页区，不动整页 */
watch(
  () => workspace.activeId,
  async (id) => {
    if (!id) return
    await nextTick()
    const el = scroller.value?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
)

/** 普通鼠标滚轮只给 deltaY，横向容器不会滚：转成横向。本来就横向的（触控板、Shift+滚轮）交给浏览器 */
function onWheel(e: WheelEvent): void {
  if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.preventDefault()
  scroller.value?.scrollBy({ left: e.deltaY })
}

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
    <div ref="scroller" class="tab-scroller" data-test="tab-scroller" @wheel="onWheel">
      <div
        v-for="s in tabs"
        :key="s.id"
        class="tab"
        :class="{ active: s.id === workspace.activeId }"
        role="button"
        tabindex="0"
        :title="tabTitle(s.id, s.name)"
        :data-tab-id="s.id"
        data-test="tab"
        @click="emit('select', s.id)"
        @keydown="onTabKeydown($event, s.id)"
      >
        <StatusDot :status="agent.statusOf(s.id)" />
        <span class="name" data-test="tab-name">{{ s.name }}</span>
        <button
          class="x"
          title="关闭标签页（会话继续在后台保持）"
          data-test="tab-close"
          @click.stop="workspace.closeTab(s.id)"
        >
          ×
        </button>
      </div>
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
}
/* 只有中间这一段滚动，☰ 与 ＋ 钉在两端；滚动条藏起，靠滚轮（转横向）与「当前页滚进视野」定位 */
.tab-scroller {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tab-scroller::-webkit-scrollbar {
  display: none;
}
/* 先压窄（200 → 100 px，名字省略号）再滚：十个左右的标签页不用滚也看得全 */
.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 12px;
  border-radius: 8px 8px 0 0;
  background: #dce0e6;
  color: var(--muted);
  font-size: 13px;
  flex: 0 1 200px;
  min-width: 100px;
  white-space: nowrap;
  cursor: default;
}
.tab .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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

<script setup lang="ts">
// 会话列表：按 buildSessionGroups（输入 = 会话 / 标签 / 关联 + filter store 的选中 / 模式 / 搜索词）渲染分组
//（分组头 = 三角 + 色点 + 名称 + 数量，点击折叠 / 展开，折叠状态记在 filter store）；
// 组内无会话显示「这个标签下还没有会话」，整体无匹配显示「没有匹配的会话…」。
// 移除会话的唯一入口在这里（右键菜单「移除会话」）：confirm 后只调 sessions.remove，关标签页靠主进程广播；
// 右键菜单唯一实例挂在这里（usePopover 管点外部关闭），「编辑会话」上抛 edit 由 App 开弹窗；
// 「重启终端」在这里确认（终端里有程序在跑时写出程序名）后交生命周期核心重启并切过去
import { computed, onUnmounted, ref } from 'vue'
import SessionMenu from './SessionMenu.vue'
import SessionRow from './SessionRow.vue'
import { usePopover } from '../composables/usePopover'
import { buildSessionGroups, type SessionGroup } from '../composables/useSessionGroups'
import { reorderWithinGroup } from '../composables/sessionOrder'
import { useAgentStore } from '../stores/agent'
import { useFilterStore } from '../stores/filter'
import { useSessionsStore } from '../stores/sessions'
import { useTagsStore } from '../stores/tags'
import { useWorkspaceStore } from '../stores/workspace'

const sessions = useSessionsStore()
const tags = useTagsStore()
const filter = useFilterStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const emit = defineEmits<{ select: [id: string]; edit: [id: string] }>()

const menuEl = ref<HTMLElement | null>(null)
const { isOpen: isMenuOpen, open: openMenu, close: closeMenu } = usePopover(menuEl)
const menuTarget = ref<{ id: string; x: number; y: number } | null>(null)

/** 右键：记下目标与坐标，并把该行置为悬停对象（副本一起高亮）标明操作对象 */
function onMenu(id: string, x: number, y: number): void {
  menuTarget.value = { id, x, y }
  workspace.setHovered(id)
  openMenu()
}

/** 菜单打开期间鼠标移到菜单上会触发行的 leave：保持目标行高亮 */
function onLeave(id: string): void {
  if (isMenuOpen.value && menuTarget.value?.id === id) return
  workspace.setHovered(null)
}

function dismissMenu(): void {
  closeMenu()
  workspace.setHovered(null)
}

function editFromMenu(): void {
  const id = menuTarget.value?.id
  dismissMenu()
  if (id) emit('edit', id)
}

function removeFromMenu(): void {
  const id = menuTarget.value?.id
  dismissMenu()
  if (id) void removeSession(id)
}

function restartFromMenu(): void {
  const id = menuTarget.value?.id
  dismissMenu()
  if (id) void restartTerminal(id)
}

/**
 * 重启终端：有程序在跑先确认（与唤起区置灰看同一份镜像，进程树每 2 s 一轮）；已退出的终端里肯定没程序，不问。
 * 结束、重开、切页都在生命周期核心里；失败（结束终端的调用被拒）在左栏顶部红字
 */
async function restartTerminal(id: string): Promise<void> {
  const running = workspace.phaseOf(id) === 'running' ? agent.runningNameOf(id) : null
  if (running && !window.confirm(`终端里有程序在运行（${running}），重启会结束它。继续？`)) return
  try {
    await workspace.restart(id)
  } catch (err) {
    flashError(err instanceof Error ? err.message : String(err))
  }
}

/** 移除只走主进程广播这一条路：session:changed 到达后由生命周期核心销毁实例并关标签页 */
async function removeSession(id: string): Promise<void> {
  const s = sessions.byId(id)
  if (!s) return
  if (!window.confirm(`移除会话 "${s.name}"？终端进程会被结束。`)) return
  await sessions.remove(s.id)
}

const groups = computed(() =>
  buildSessionGroups({
    sessions: sessions.sessions,
    tags: tags.tags, // 传全部标签（含隐藏）：隐藏标签既不成组，也要把它名下的会话整体从左栏收起来
    sessionTags: tags.sessionTags,
    selected: filter.selected,
    mode: filter.mode,
    search: filter.search,
  }),
)
// 与原型一致：没有分组或所有分组都为空 → 整体空态
const isEmpty = computed(() => groups.value.every((g) => g.sessions.length === 0))

// 列表顶部的失败红字 1.2 s（组内拖拽排序、重启终端共用）
const ERROR_FLASH_MS = 1200
const error = ref('')
let errorTimer: ReturnType<typeof setTimeout> | null = null
function flashError(message: string): void {
  error.value = message
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => {
    error.value = ''
  }, ERROR_FLASH_MS)
}
onUnmounted(() => {
  if (errorTimer) clearTimeout(errorTimer)
})

// ---- 组内拖拽排序 ----

// 搜索时组内只剩子集，拖了容易误以为改的是完整顺序 —— 直接禁用
const canDrag = computed(() => !filter.search.trim())

/** 拖拽起点：会话 id + 它所在的分组 key；跨组落点一律忽略（加减标签只走胶囊 / 「+ 标签」/ 管理标签） */
let dragFrom: { id: string; groupKey: string } | null = null

function onDragStart(groupKey: string, id: string): void {
  dragFrom = { id, groupKey }
}

/** 拖到组头或列表空白处松手不会触发 drop，靠 dragend 复位，避免下次拖拽用到脏起点 */
function onDragEnd(): void {
  dragFrom = null
}

/**
 * 同组内落点：把该组占据的那些全局槽位按新的组内顺序填回，组外会话一个不动（见 sessionOrder.ts）。
 * 不做本地乐观重排，顺序以主进程 session:changed 广播为准。
 */
function onDrop(group: SessionGroup, targetId: string): void {
  const from = dragFrom
  dragFrom = null
  if (!from || from.groupKey !== group.key || from.id === targetId) return
  const groupIds = group.sessions.map((s) => s.id)
  const allIds = [...sessions.sessions].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id)
  const next = reorderWithinGroup(
    allIds,
    groupIds,
    groupIds.indexOf(from.id),
    groupIds.indexOf(targetId),
  )
  void sessions
    .reorder(next)
    .catch((err) => flashError(err instanceof Error ? err.message : String(err)))
}
</script>

<template>
  <div class="groups">
    <p v-if="error" class="groups-error" data-test="groups-error">{{ error }}</p>
    <div v-if="isEmpty" class="empty-side">没有匹配的会话。换个标签组合，或新建一个会话。</div>
    <template v-else>
      <div
        v-for="g in groups"
        :key="g.key"
        class="group"
        :class="{ open: !filter.isCollapsed(g.key) }"
        data-test="group"
      >
        <button class="group-h" data-test="group-head" @click="filter.toggleCollapsed(g.key)">
          <span class="tri"></span>
          <i v-if="g.color" :style="{ '--c': g.color }" data-test="group-dot"></i>
          <!-- 「未打标签」组没有色点，但位置照样占着：所有组名从同一列起，会话行才能统一对齐到组名（2026-09-21） -->
          <i v-else class="blank" data-test="group-dot-blank"></i>
          <b data-test="group-title">{{ g.title }}</b>
          <em data-test="group-count">{{ g.sessions.length }}</em>
        </button>
        <div class="group-body">
          <SessionRow
            v-for="s in g.sessions"
            :key="s.id"
            :session="s"
            :active="s.id === workspace.activeId"
            :tags="tags.visibleTagsOf(s.id)"
            :peer="s.id === workspace.hoveredId"
            :can-drag="canDrag"
            :status="agent.statusOf(s.id)"
            :pending-hint="agent.runtimeOf(s.id)?.pendingHint"
            @select="emit('select', $event)"
            @hover="workspace.setHovered($event)"
            @leave="onLeave"
            @menu="onMenu"
            @drag-start="onDragStart(g.key, $event)"
            @drop-on="onDrop(g, $event)"
            @drag-end="onDragEnd"
          />
          <div v-if="g.sessions.length === 0" class="none" data-test="group-empty">
            这个标签下还没有会话
          </div>
        </div>
      </div>
    </template>
    <div v-if="isMenuOpen && menuTarget" ref="menuEl">
      <SessionMenu
        :x="menuTarget.x"
        :y="menuTarget.y"
        :can-restart="workspace.phaseOf(menuTarget.id) !== 'closed'"
        @edit="editFromMenu"
        @restart="restartFromMenu"
        @remove="removeFromMenu"
        @close="dismissMenu"
      />
    </div>
  </div>
</template>

<style scoped>
.groups {
  flex: 1;
  overflow: auto;
  padding: 6px 6px 8px;
}
.group {
  margin-bottom: 4px;
}
.group-h {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px;
  font-size: 12px;
  color: var(--muted);
  border-radius: 6px;
  text-align: left;
}
.group-h:hover {
  background: #edeff3;
}
.group-h .tri {
  width: 0;
  height: 0;
  border: 4px solid transparent;
  border-left-color: currentColor;
  margin: 0 2px 0 3px;
  transition: transform 0.12s;
}
.group.open .group-h .tri {
  transform: rotate(90deg);
}
.group-h i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c);
}
.group-h i.blank {
  background: transparent;
}
.group-h b {
  font-weight: 600;
  color: var(--text);
}
.group-h em {
  font-style: normal;
  margin-left: auto;
}
.group-body {
  display: none;
}
.group.open .group-body {
  display: block;
}
.none {
  padding: 4px 22px;
  font-size: 12px;
  color: var(--muted);
}
.groups-error {
  margin: 0 0 4px;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--danger, #d14343);
}
.empty-side {
  padding: 24px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}
</style>

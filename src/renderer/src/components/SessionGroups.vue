<script setup lang="ts">
// 会话列表：按 buildSessionGroups（输入 = 会话 / 标签 / 关联 + filter store 的选中 / 模式 / 搜索词）渲染分组
//（分组头 = 三角 + 色点 + 名称 + 数量，点击折叠 / 展开，折叠状态记在 filter store）；
// 组内无会话显示「这个标签下还没有会话」，整体无匹配显示「没有匹配的会话…」。
// 移除会话的唯一入口在这里（右键菜单「移除会话」）：confirm 后只调 sessions.remove，关标签页靠主进程广播；
// 右键菜单唯一实例挂在这里（usePopover 管点外部关闭），「编辑会话」上抛 edit 由 App 开弹窗
import { computed, ref } from 'vue'
import SessionMenu from './SessionMenu.vue'
import SessionRow from './SessionRow.vue'
import { usePopover } from '../composables/usePopover'
import { buildSessionGroups } from '../composables/useSessionGroups'
import { useFilterStore } from '../stores/filter'
import { useSessionsStore } from '../stores/sessions'
import { useTagsStore } from '../stores/tags'
import { useWorkspaceStore } from '../stores/workspace'

const sessions = useSessionsStore()
const tags = useTagsStore()
const filter = useFilterStore()
const workspace = useWorkspaceStore()
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
</script>

<template>
  <div class="groups">
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
            @select="emit('select', $event)"
            @hover="workspace.setHovered($event)"
            @leave="onLeave"
            @menu="onMenu"
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
        @edit="editFromMenu"
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
.empty-side {
  padding: 24px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}
</style>

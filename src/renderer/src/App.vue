<script setup lang="ts">
// 应用骨架：左栏（会话列表）+ 右栏（标签页 / 工作区 / 空状态 + 状态栏），布局照原型 .app 双栏 grid；
// 启动依次加载 settings / update / sessions / tags（tags 的派生以会话列表为主表，放最后）；
// 装配会话生命周期核心 TerminalWorkspace：provide 给 TerminalPane / SideHead（宿主操作），attachCore 给 workspace store（快照镜像）。
// 选中 / 关页 / 重启 / 移除的编排全在核心里，这里只做接线
import { onMounted, onUnmounted, provide, ref } from 'vue'
import type { Session } from '@shared/models'
import type { Unsubscribe } from '@shared/api'
import AppBackground from './components/AppBackground.vue'
import SideHead from './components/SideHead.vue'
import TagFilter from './components/TagFilter.vue'
import SessionGroups from './components/SessionGroups.vue'
import SideFoot from './components/SideFoot.vue'
import TabBar from './components/TabBar.vue'
import PathStrip from './components/PathStrip.vue'
import TerminalPane from './components/TerminalPane.vue'
import EmptyState from './components/EmptyState.vue'
import StatusBar from './components/StatusBar.vue'
import NewSessionModal from './components/NewSessionModal.vue'
import EditSessionModal from './components/EditSessionModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import ManageTagsModal from './components/ManageTagsModal.vue'
import { useSessionsStore } from './stores/sessions'
import { useSettingsStore } from './stores/settings'
import { useTagsStore } from './stores/tags'
import { useUpdateStore } from './stores/update'
import { useWorkspaceStore } from './stores/workspace'
import { TerminalWorkspace } from './terminal/TerminalWorkspace'
import { TERMINAL_WORKSPACE_KEY } from './terminal/workspaceKey'
import { createXtermFactory } from './terminal/xtermFactory'
import { buildTerminalOptions } from './terminal/theme'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const tags = useTagsStore()
const update = useUpdateStore()
const workspace = useWorkspaceStore()
const isNewModalOpen = ref(false)
/** 右键菜单「编辑会话」的目标；非空即显示编辑弹窗 */
const editingSession = ref<Session | null>(null)
const isSettingsOpen = ref(false)
const isManageTagsOpen = ref(false)
let unsubscribeOpenSettings: Unsubscribe | null = null
const loadError = ref('')

// 工厂惰性读取：终端只会在会话列表加载之后创建，而列表加载在 getOsBuild 之后
let osBuild = 0
const core = new TerminalWorkspace({
  pty: window.tagterm.pty,
  createTerminal: createXtermFactory(() => buildTerminalOptions(osBuild)),
})
provide(TERMINAL_WORKSPACE_KEY, core)
const detachCore = workspace.attachCore(core)

function onCreated(session: Session): void {
  isNewModalOpen.value = false
  void workspace.select(session.id)
}

function onEdit(id: string): void {
  editingSession.value = sessions.byId(id) ?? null
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') isNewModalOpen.value = false
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  // 托盘「设置」→ 主进程广播 → 打开设置弹窗
  unsubscribeOpenSettings = window.tagterm.app.onOpenSettings(() => {
    isSettingsOpen.value = true
  })
  try {
    osBuild = await window.tagterm.app.getOsBuild()
    await settings.load()
    await update.load()
    await sessions.load()
    await tags.load()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  unsubscribeOpenSettings?.()
  detachCore()
  core.dispose()
})
</script>

<template>
  <AppBackground />
  <div class="app" :class="{ 'side-hidden': workspace.sideHidden }">
    <aside class="side">
      <SideHead />
      <TagFilter />
      <div v-if="loadError" class="empty-side" data-test="load-error">{{ loadError }}</div>
      <SessionGroups v-else @select="workspace.select" @edit="onEdit" />
      <SideFoot
        @new-session="isNewModalOpen = true"
        @manage-tags="isManageTagsOpen = true"
        @settings="isSettingsOpen = true"
      />
    </aside>
    <main class="main">
      <TabBar @select="workspace.select" @new-session="isNewModalOpen = true" />
      <div v-show="workspace.hasActive" class="work">
        <PathStrip />
        <TerminalPane />
      </div>
      <EmptyState v-if="!workspace.hasActive" />
      <StatusBar />
    </main>
    <NewSessionModal v-if="isNewModalOpen" @close="isNewModalOpen = false" @created="onCreated" />
    <EditSessionModal
      v-if="editingSession"
      :session="editingSession"
      @close="editingSession = null"
      @saved="editingSession = null"
    />
    <SettingsModal v-if="isSettingsOpen" @close="isSettingsOpen = false" />
    <ManageTagsModal v-if="isManageTagsOpen" @close="isManageTagsOpen = false" />
  </div>
</template>

<style scoped>
.app {
  position: relative; /* 盖在 fixed 的全局背景层之上；面板不透明度由 AppBackground 写在 <html> 上，这里不设 */
  z-index: 1;
  display: grid;
  grid-template-columns: 296px 1fr;
  height: 100vh;
  transition: grid-template-columns 0.15s;
}
.app.side-hidden {
  grid-template-columns: 0 1fr;
}
.app.side-hidden .side {
  overflow: hidden;
  border: 0;
}
.side {
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border-right: 1px solid var(--line);
  min-width: 0;
}
.empty-side {
  flex: 1;
  padding: 24px 12px;
  text-align: center;
  font-size: 12.5px;
  color: #b42318;
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg-soft);
}
.work {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>

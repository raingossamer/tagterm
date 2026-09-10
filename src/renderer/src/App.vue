<script setup lang="ts">
// 应用骨架：左栏（会话列表）+ 右栏（标签页 / 工作区 / 空状态 + 状态栏），布局照原型 .app 双栏 grid；
// 提供 TerminalPool 单例，并把「选中会话 → 打开终端」「pty 退出 → 重启」「会话被移除 → 销毁实例」编排在这里
import { onMounted, onUnmounted, provide, ref, watch } from 'vue'
import type { Session } from '@shared/models'
import SideHead from './components/SideHead.vue'
import SessionGroups from './components/SessionGroups.vue'
import SideFoot from './components/SideFoot.vue'
import TabBar from './components/TabBar.vue'
import PathStrip from './components/PathStrip.vue'
import TerminalPane from './components/TerminalPane.vue'
import EmptyState from './components/EmptyState.vue'
import StatusBar from './components/StatusBar.vue'
import NewSessionModal from './components/NewSessionModal.vue'
import { useSessionsStore } from './stores/sessions'
import { useWorkspaceStore } from './stores/workspace'
import { TerminalPool } from './terminal/TerminalPool'
import { TERMINAL_POOL_KEY } from './terminal/poolKey'
import { createXtermFactory } from './terminal/xtermFactory'
import { buildTerminalOptions } from './terminal/theme'

const sessions = useSessionsStore()
const workspace = useWorkspaceStore()
const isNewModalOpen = ref(false)
const loadError = ref('')

let osBuild = 0
const pool = new TerminalPool({
  pty: window.tagterm.pty,
  createTerminal: createXtermFactory(() => buildTerminalOptions(osBuild)),
  onExit: (e) => workspace.setExited(e.sessionId, e.exitCode),
  onRestartRequested: (id) => void restartSession(id),
})
provide(TERMINAL_POOL_KEY, pool)

/** 打开（或复用）会话的终端并显示；pty 已退出的会话再次选中即重启 */
async function selectSession(id: string): Promise<void> {
  const session = sessions.byId(id)
  if (!session) return
  workspace.select(id)
  if (!workspace.isAlive(id)) {
    await restartSession(id)
    return
  }
  await openAndShow(session)
}

async function restartSession(id: string): Promise<void> {
  const session = sessions.byId(id)
  if (!session) return
  pool.dispose(id)
  workspace.markAlive(id)
  await openAndShow(session)
}

async function openAndShow(session: Session): Promise<void> {
  try {
    await pool.open(session)
  } catch (err) {
    console.error('[terminal] 打开终端失败', err)
  }
  if (workspace.activeId === session.id) pool.show(session.id)
}

function onCreated(session: Session): void {
  isNewModalOpen.value = false
  void selectSession(session.id)
}

// 切换活动会话：只切 display；没有活动会话时隐藏全部实例（空状态）
watch(
  () => workspace.activeId,
  (id) => {
    if (id === null) pool.hide()
    else if (pool.has(id)) pool.show(id)
  },
)

// 会话被移除（本窗口或主进程广播）→ 销毁其实例并关其标签页
watch(
  () => sessions.sessions,
  (list) => {
    const alive = new Set(list.map((s) => s.id))
    for (const id of pool.sessionIds()) {
      if (!alive.has(id)) {
        pool.dispose(id)
        workspace.onSessionRemoved(id)
      }
    }
  },
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') isNewModalOpen.value = false
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  try {
    osBuild = await window.tagterm.app.getOsBuild()
    await sessions.load()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app" :class="{ 'side-hidden': workspace.sideHidden }">
    <aside class="side">
      <SideHead />
      <div v-if="loadError" class="empty-side" data-test="load-error">{{ loadError }}</div>
      <SessionGroups v-else @select="selectSession" />
      <SideFoot @new-session="isNewModalOpen = true" />
    </aside>
    <main class="main">
      <TabBar @select="selectSession" @new-session="isNewModalOpen = true" />
      <div v-show="workspace.hasActive" class="work">
        <PathStrip />
        <TerminalPane />
      </div>
      <EmptyState v-if="!workspace.hasActive" />
      <StatusBar />
    </main>
    <NewSessionModal v-if="isNewModalOpen" @close="isNewModalOpen = false" @created="onCreated" />
  </div>
</template>

<style scoped>
.app {
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
  background: var(--panel);
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
  background: var(--bg);
}
.work {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>

<script setup lang="ts">
// 应用骨架：左栏（会话列表）+ 右栏（工作区 / 空状态 + 状态栏），布局照原型 .app 双栏 grid
import { onMounted, onUnmounted, ref } from 'vue'
import type { Session } from '@shared/models'
import SideHead from './components/SideHead.vue'
import SessionGroups from './components/SessionGroups.vue'
import SideFoot from './components/SideFoot.vue'
import PathStrip from './components/PathStrip.vue'
import EmptyState from './components/EmptyState.vue'
import StatusBar from './components/StatusBar.vue'
import NewSessionModal from './components/NewSessionModal.vue'
import { useSessionsStore } from './stores/sessions'
import { useWorkspaceStore } from './stores/workspace'

const sessions = useSessionsStore()
const workspace = useWorkspaceStore()
const isNewModalOpen = ref(false)
const loadError = ref('')

function selectSession(id: string): void {
  workspace.select(id)
}

function onCreated(session: Session): void {
  isNewModalOpen.value = false
  selectSession(session.id)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') isNewModalOpen.value = false
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  try {
    await sessions.load()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app">
    <aside class="side">
      <SideHead />
      <div v-if="loadError" class="empty-side" data-test="load-error">{{ loadError }}</div>
      <SessionGroups v-else @select="selectSession" />
      <SideFoot @new-session="isNewModalOpen = true" />
    </aside>
    <main class="main">
      <div v-if="workspace.hasActive" class="work">
        <PathStrip />
        <div class="term"></div>
      </div>
      <EmptyState v-else />
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
.term {
  flex: 1;
  background: var(--t-bg);
  min-height: 0;
}
</style>

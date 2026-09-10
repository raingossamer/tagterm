<script setup lang="ts">
// 路径条：当前会话的固定路径、复制、移除会话（M4 起显示唤起 / 清屏在 Slice 4 接入）
import { computed } from 'vue'
import { useSessionsStore } from '../stores/sessions'
import { useWorkspaceStore } from '../stores/workspace'
import { useCopy } from '../composables/useCopy'

const sessions = useSessionsStore()
const workspace = useWorkspaceStore()
const { isCopied, copy } = useCopy()

const session = computed(() => (workspace.activeId ? sessions.byId(workspace.activeId) : undefined))

async function removeSession(): Promise<void> {
  const s = session.value
  if (!s) return
  if (!window.confirm(`移除会话 "${s.name}"？终端进程会被结束。`)) return
  await sessions.remove(s.id)
  workspace.onSessionRemoved(s.id)
}
</script>

<template>
  <div v-if="session" class="strip">
    <span class="path" title="会话固定在这个目录" data-test="strip-path">{{ session.cwd }}</span>
    <button class="btn sm" title="复制路径" data-test="strip-copy" @click="copy(session.cwd)">
      {{ isCopied ? '已复制' : '复制' }}
    </button>
    <span class="launch">
      <button class="btn sm danger" data-test="strip-remove" @click="removeSession">
        移除会话
      </button>
    </span>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--panel2);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.strip .path {
  font-family: var(--mono);
  font-size: 13px;
  padding: 3px 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  user-select: all;
}
.launch {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}
</style>

<script setup lang="ts">
// 路径条：当前会话的固定路径、复制、唤起区（settings.json 里的命令：pinned 平铺、其余收进「更多 ▾」、「编辑」）、清屏、移除会话
import { computed, onUnmounted, ref } from 'vue'
import { useSessionsStore } from '../stores/sessions'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import { useCopy } from '../composables/useCopy'
import LaunchCommandsModal from './LaunchCommandsModal.vue'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const { isCopied, copy } = useCopy()
const isMoreOpen = ref(false)
const isEditOpen = ref(false)
const moreEl = ref<HTMLElement | null>(null)

const session = computed(() => (workspace.activeId ? sessions.byId(workspace.activeId) : undefined))

/** 唤起按钮本质是向终端写入 `<cmd>\r` */
function runCommand(cmd: string): void {
  if (!session.value) return
  window.tagterm.pty.write(session.value.id, `${cmd}\r`)
}

/** 「更多 ▾」弹出层：点击弹出层外部即收起（监听只在打开期间挂着） */
function onDocumentMousedown(e: MouseEvent): void {
  if (!moreEl.value?.contains(e.target as Node)) closeMore()
}
function toggleMore(): void {
  if (isMoreOpen.value) closeMore()
  else {
    isMoreOpen.value = true
    document.addEventListener('mousedown', onDocumentMousedown)
  }
}
function closeMore(): void {
  isMoreOpen.value = false
  document.removeEventListener('mousedown', onDocumentMousedown)
}
onUnmounted(closeMore)

function runFromMore(cmd: string): void {
  closeMore()
  runCommand(cmd)
}

function clearScreen(): void {
  if (!session.value) return
  runCommand(session.value.shell === 'cmd.exe' ? 'cls' : 'clear')
}

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
      <span class="lab" data-test="launch-label">唤起</span>
      <button
        v-for="c in settings.pinnedCommands"
        :key="c.id"
        class="btn sm mono"
        :title="c.command"
        data-test="launch-cmd"
        @click="runCommand(c.command)"
      >
        {{ c.label }}
      </button>
      <span v-if="settings.moreCommands.length" ref="moreEl" class="more">
        <button class="btn sm" data-test="launch-more" @click="toggleMore">更多 ▾</button>
        <div v-if="isMoreOpen" class="pop" data-test="launch-more-pop">
          <button
            v-for="c in settings.moreCommands"
            :key="c.id"
            class="item mono"
            :title="c.command"
            data-test="launch-more-item"
            @click="runFromMore(c.command)"
          >
            {{ c.label }}
          </button>
        </div>
      </span>
      <button
        class="btn sm"
        title="编辑唤起命令"
        data-test="launch-edit"
        @click="isEditOpen = true"
      >
        编辑
      </button>
      <button class="btn sm" data-test="strip-clear" @click="clearScreen">清屏</button>
      <button class="btn sm danger" data-test="strip-remove" @click="removeSession">
        移除会话
      </button>
    </span>
    <LaunchCommandsModal v-if="isEditOpen" @close="isEditOpen = false" />
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
.launch .lab {
  font-size: 12px;
  color: var(--muted);
  margin-right: 2px;
}
.more {
  position: relative;
}
.pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  max-height: 60vh;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 10;
}
.pop .item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12.5px;
  white-space: nowrap;
}
.pop .item:hover {
  background: #f0f2f5;
}
</style>

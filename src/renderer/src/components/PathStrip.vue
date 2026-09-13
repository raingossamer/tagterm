<script setup lang="ts">
// 路径条：当前会话的固定路径、复制、标签胶囊（× 直接 detach）、「+ 标签」弹出层、
// 唤起区（settings.json 里的命令：pinned 平铺、其余收进「更多 ▾」、「编辑」）、清屏、移除会话
import { computed, ref } from 'vue'
import { useSessionsStore } from '../stores/sessions'
import { useSettingsStore } from '../stores/settings'
import { useTagsStore } from '../stores/tags'
import { useWorkspaceStore } from '../stores/workspace'
import { useCopy } from '../composables/useCopy'
import { usePopover } from '../composables/usePopover'
import LaunchCommandsModal from './LaunchCommandsModal.vue'
import TagPopover from './TagPopover.vue'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const tags = useTagsStore()
const workspace = useWorkspaceStore()
const { isCopied, copy } = useCopy()
const isEditOpen = ref(false)
// 两个弹出层：点击容器（按钮 + 弹出层）外部即关闭；TagPopover 的 Esc 由它自己 emit close
const moreEl = ref<HTMLElement | null>(null)
const tagPopEl = ref<HTMLElement | null>(null)
const { isOpen: isMoreOpen, toggle: toggleMore, close: closeMore } = usePopover(moreEl)
const { isOpen: isTagPopOpen, toggle: toggleTagPop, close: closeTagPop } = usePopover(tagPopEl)

const session = computed(() => (workspace.activeId ? sessions.byId(workspace.activeId) : undefined))
const sessionTags = computed(() => (session.value ? tags.tagsOf(session.value.id) : []))

/** 唤起按钮本质是向终端写入 `<cmd>\r` */
function runCommand(cmd: string): void {
  if (!session.value) return
  window.tagterm.pty.write(session.value.id, `${cmd}\r`)
}

function runFromMore(cmd: string): void {
  closeMore()
  runCommand(cmd)
}

function clearScreen(): void {
  if (!session.value) return
  runCommand(session.value.shell === 'cmd.exe' ? 'cls' : 'clear')
}

/** 移除只走主进程广播这一条路：session:changed 到达后由生命周期核心销毁实例并关标签页 */
async function removeSession(): Promise<void> {
  const s = session.value
  if (!s) return
  if (!window.confirm(`移除会话 "${s.name}"？终端进程会被结束。`)) return
  await sessions.remove(s.id)
}
</script>

<template>
  <div v-if="session" class="strip">
    <span class="path" title="会话固定在这个目录" data-test="strip-path">{{ session.cwd }}</span>
    <button class="btn sm" title="复制路径" data-test="strip-copy" @click="copy(session.cwd)">
      {{ isCopied ? '已复制' : '复制' }}
    </button>
    <span
      v-for="t in sessionTags"
      :key="t.id"
      class="stag"
      :style="{ '--c': t.color }"
      data-test="strip-tag"
      >{{ t.name
      }}<button
        title="从这个标签移除"
        data-test="strip-untag"
        @click="tags.detach(session.id, t.id)"
        v-text="'×'"
      ></button
    ></span>
    <span ref="tagPopEl" class="tagadd">
      <button class="btn sm" data-test="strip-add-tag" @click="toggleTagPop">+ 标签</button>
      <TagPopover v-if="isTagPopOpen" :session-id="session.id" @close="closeTagPop" />
    </span>
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
.stag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 2px 5px 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c) 12%, #fff);
  color: color-mix(in srgb, var(--c) 70%, #000);
  border: 1px solid color-mix(in srgb, var(--c) 35%, #fff);
}
.stag button {
  opacity: 0.55;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
}
.stag button:hover {
  opacity: 1;
}
.tagadd {
  position: relative;
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

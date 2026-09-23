<script setup lang="ts">
// 路径条：当前会话的当前目录（终端里 cd 之后追踪到的 cwdNow，没有则是固定目录；chip 本身是按钮，点击 = 在资源管理器打开它）、复制、
// 标签胶囊（× 直接 detach）、「+ 标签」弹出层、右侧唤起区（LaunchBar：唤起命令、「编辑」、清屏）。
// 移除会话的入口在左栏会话行的右键菜单
import { computed, onUnmounted, ref } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useSessionsStore } from '../stores/sessions'
import { useTagsStore } from '../stores/tags'
import { useWorkspaceStore } from '../stores/workspace'
import { createCooldown } from '../composables/cooldown'
import { pathHead } from '../composables/path'
import { useCopy } from '../composables/useCopy'
import { usePopover } from '../composables/usePopover'
import LaunchBar from './LaunchBar.vue'
import TagPopover from './TagPopover.vue'

const sessions = useSessionsStore()
const tags = useTagsStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const { isCopied, copy } = useCopy()
// 「+ 标签」弹出层：点击容器（按钮 + 弹出层）外部即关闭；TagPopover 的 Esc 由它自己 emit close
const tagPopEl = ref<HTMLElement | null>(null)
const { isOpen: isTagPopOpen, toggle: toggleTagPop, close: closeTagPop } = usePopover(tagPopEl)

// 路径条内的失败提示（打不开目录、拖动唤起按钮后保存失败等）：红字 1.2 s（规范：失败必须出现在用户看得见的地方）
const ERROR_FLASH_MS = 1200
const error = ref<string | null>(null)
let errorTimer: ReturnType<typeof setTimeout> | null = null
function flashError(message: string): void {
  error.value = message
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => {
    error.value = null
  }, ERROR_FLASH_MS)
}
onUnmounted(() => {
  if (errorTimer) clearTimeout(errorTimer)
})

const session = computed(() => (workspace.activeId ? sessions.byId(workspace.activeId) : undefined))
const sessionTags = computed(() => (session.value ? tags.tagsOf(session.value.id) : []))
// 显示的是当前目录：主进程从提示符解析到的 cwdNow，缺省回落到会话固定目录
const currentDir = computed(() =>
  session.value ? (agent.runtimeOf(session.value.id)?.cwdNow ?? session.value.cwd) : '',
)
// 路径条只显示到第三级，完整路径放 tooltip 与「复制」；cd 到别处时 tooltip 第二行仍给出固定目录；末行提示 chip 可点（它不再像原型那样单击全选）
const pathDisplay = computed(() => (currentDir.value ? pathHead(currentDir.value) : ''))
const pathTitle = computed(() => {
  if (!session.value) return ''
  const where =
    currentDir.value === session.value.cwd
      ? `${session.value.cwd}\n会话固定在这个目录`
      : `${currentDir.value}\n会话固定在：${session.value.cwd}`
  return `${where}\n点击在资源管理器中打开`
})

// 点路径 chip = 在资源管理器打开当前目录（与「复制」同一个路径）；路径由主进程从真相源解析，这里只传会话 id。
// 500 ms 冷却：shell.openPath 每调一次多开一个资源管理器窗口，沿原型「单击全选」旧习惯双击 chip 的人不该得到两个窗口
const canOpenDirectory = createCooldown(500)
function openDirectory(): void {
  if (!session.value || !canOpenDirectory()) return
  window.tagterm.session
    .openDirectory(session.value.id)
    .catch((err) => flashError(err instanceof Error ? err.message : String(err)))
}
</script>

<template>
  <div v-if="session" class="strip">
    <!-- chip 用 v-text：拆行的插值会带进首尾空格，烟测按 textContent 精确比对 -->
    <button
      class="path"
      :title="pathTitle"
      data-test="strip-path"
      @click="openDirectory"
      v-text="pathDisplay"
    ></button>
    <button class="btn sm" title="复制路径" data-test="strip-copy" @click="copy(currentDir)">
      {{ isCopied ? '已复制' : '复制' }}
    </button>
    <span v-if="error" class="err" data-test="strip-error">{{ error }}</span>
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
    <LaunchBar :session="session" @error="flashError" />
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--panel2-bg);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
/* 路径 chip 是按钮（偏离原型的 span + user-select: all，用户 2026-09-21 判定）：外观照原型，悬停边框换主色提示可点 */
.strip .path {
  font-family: var(--mono);
  font-size: 13px;
  padding: 3px 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
}
.strip .path:hover {
  border-color: var(--accent);
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
.err {
  font-size: 12px;
  color: var(--danger, #d14343);
}
.tagadd {
  position: relative;
}
</style>

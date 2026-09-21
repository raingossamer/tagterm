<script setup lang="ts">
// 路径条：当前会话的当前目录（终端里 cd 之后追踪到的 cwdNow，没有则是固定目录）、复制（悬停其上即露出「打开」= 在资源管理器打开当前目录）、
// 标签胶囊（× 直接 detach）、「+ 标签」弹出层、唤起区（settings.json 里的命令：pinned 平铺、其余收进「更多 ▾」、「编辑」）、清屏。
// 移除会话的入口在左栏会话行的右键菜单
import { computed, onUnmounted, ref } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useSessionsStore } from '../stores/sessions'
import { useSettingsStore } from '../stores/settings'
import { useTagsStore } from '../stores/tags'
import { useWorkspaceStore } from '../stores/workspace'
import { pathHead } from '../composables/path'
import { useCopy } from '../composables/useCopy'
import { usePopover } from '../composables/usePopover'
import LaunchCommandsModal from './LaunchCommandsModal.vue'
import TagPopover from './TagPopover.vue'

const sessions = useSessionsStore()
const settings = useSettingsStore()
const tags = useTagsStore()
const workspace = useWorkspaceStore()
const agent = useAgentStore()
const { isCopied, copy } = useCopy()
const isEditOpen = ref(false)
// 两个点击式弹出层：点击容器（按钮 + 弹出层）外部即关闭；TagPopover 的 Esc 由它自己 emit close
const moreEl = ref<HTMLElement | null>(null)
const tagPopEl = ref<HTMLElement | null>(null)
const { isOpen: isMoreOpen, toggle: toggleMore, close: closeMore } = usePopover(moreEl)
const { isOpen: isTagPopOpen, toggle: toggleTagPop, close: closeTagPop } = usePopover(tagPopEl)

// 「打开」是悬停式的：鼠标停在「复制」上即在它正下方露出，移开就收起，不占路径条的常驻宽度。
// 不走 usePopover（那套是给点击式弹出层管「点外面关闭」的）：这里鼠标离开容器就收起，不必监听 document。
// 弹出层是容器的子元素，鼠标从按钮滑到它身上不会触发容器的 mouseleave；键盘用户 Tab 到「复制」同样露出（focusin / focusout）
const copyWrapEl = ref<HTMLElement | null>(null)
const isOpenShown = ref(false)

function showOpen(): void {
  isOpenShown.value = true
}
function hideOpen(): void {
  isOpenShown.value = false
}
/** 焦点仍在容器内（从「复制」Tab 到「打开」）时不收起 */
function onCopyFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (!next || !copyWrapEl.value?.contains(next)) hideOpen()
}

// 路径条内的失败提示（打不开目录等）：红字 1.2 s（规范：失败必须出现在用户看得见的地方）
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
// 路径条只显示到第三级，完整路径放 tooltip 与「复制」；cd 到别处时 tooltip 第二行仍给出固定目录
const pathDisplay = computed(() => (currentDir.value ? pathHead(currentDir.value) : ''))
const pathTitle = computed(() => {
  if (!session.value) return ''
  return currentDir.value === session.value.cwd
    ? `${session.value.cwd}\n会话固定在这个目录`
    : `${currentDir.value}\n会话固定在：${session.value.cwd}`
})

/** 唤起按钮本质是向终端写入 `<cmd>\r` */
function runCommand(cmd: string): void {
  if (!session.value) return
  window.tagterm.pty.write(session.value.id, `${cmd}\r`)
}

function runFromMore(cmd: string): void {
  closeMore()
  runCommand(cmd)
}

/** 「打开」= 在资源管理器打开当前目录（与「复制」同一个路径）；路径由主进程从真相源解析，这里只传会话 id */
function openDirectory(): void {
  hideOpen()
  if (!session.value) return
  window.tagterm.session
    .openDirectory(session.value.id)
    .catch((err) => flashError(err instanceof Error ? err.message : String(err)))
}

function clearScreen(): void {
  if (!session.value) return
  runCommand(session.value.shell === 'cmd.exe' ? 'cls' : 'clear')
}
</script>

<template>
  <div v-if="session" class="strip">
    <span class="path" :title="pathTitle" data-test="strip-path">{{ pathDisplay }}</span>
    <span
      ref="copyWrapEl"
      class="copywrap"
      data-test="strip-copy-wrap"
      @mouseenter="showOpen"
      @mouseleave="hideOpen"
      @focusin="showOpen"
      @focusout="onCopyFocusOut"
    >
      <button class="btn sm" title="复制路径" data-test="strip-copy" @click="copy(currentDir)">
        {{ isCopied ? '已复制' : '复制' }}
      </button>
      <div v-if="isOpenShown" class="pop" data-test="strip-copy-pop">
        <button
          class="item"
          title="在资源管理器中打开当前目录"
          data-test="strip-open"
          @click="openDirectory"
          v-text="'打开'"
        ></button>
      </div>
    </span>
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
  background: var(--panel2-bg);
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
/* 悬停「复制」时在它正下方露出「打开」：定位基准是容器，弹出层与按钮之间不留空隙（留了鼠标滑过去就会先离开容器） */
.copywrap {
  position: relative;
  display: inline-flex;
}
.err {
  font-size: 12px;
  color: var(--danger, #d14343);
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
/* 「更多 ▾」弹出层：紧贴按钮左缘向下展开，至少与按钮同宽、随内容撑开、不超过 160px（超长省略） */
.pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  max-width: 160px;
  max-height: 60vh;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 4px;
  z-index: 10;
}
.pop .item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pop .item:hover {
  background: #f0f2f5;
}
</style>

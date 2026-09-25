<script setup lang="ts">
// 路径条右侧的唤起区：「唤起」小字、settings.json 里的命令（pinned 平铺、其余收进「更多 ▾」）、「编辑」、清屏。
// 唤起按钮本质是向当前会话的终端写入 `<cmd>\r` —— 所以终端里有程序在跑时（认出的工具或任何程序）唤起按钮与清屏置灰：
// 那时写进去的命令会被当成一条消息发给那个程序（用户 2026-09-23 判定）。置灰用 aria-disabled 而不是 disabled：
// disabled 的按钮收不到拖拽事件，置灰的按钮仍要能拖动调顺序。
// 按钮可以直接在路径条上拖（像浏览器收藏夹栏）：路径条内换位、拖进「更多 ▾」（停半秒自动展开）、从「更多」拖回来；
// 拖出去松手原样弹回、不删除（删除只在编辑弹窗里做）；松手即保存，顺序以主进程广播为准。
// 点完唤起命令 / 清屏后焦点直接落到终端：唤起的工具接着要在终端里选会话、按回车，不该还要先点一下终端
import { computed, onUnmounted, ref } from 'vue'
import type { Session } from '@shared/models'
import { useAgentStore } from '../stores/agent'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import { dropLaunchCommand, type LaunchDrop, type LaunchZone } from '../composables/launchCommands'
import { usePopover } from '../composables/usePopover'
import LaunchCommandsModal from './LaunchCommandsModal.vue'

const props = defineProps<{ session: Session }>()
/** 保存失败的原因交给路径条显示（红字 1.2 s） */
const emit = defineEmits<{ error: [message: string] }>()
const settings = useSettingsStore()
const agent = useAgentStore()
const workspace = useWorkspaceStore()
const isEditOpen = ref(false)
// 点击式弹出层：点击容器（按钮 + 弹出层）外部即关闭
const moreEl = ref<HTMLElement | null>(null)
const {
  isOpen: isMoreOpen,
  open: openMore,
  toggle: toggleMore,
  close: closeMore,
} = usePopover(moreEl)

/** 终端里正在跑的程序（工具正式名称或进程名）；回到提示符为 null */
const runningName = computed(() => agent.runningNameOf(props.session.id))
const busyTitle = computed(() =>
  runningName.value ? `当前在 ${runningName.value} 里，退出后再用` : undefined,
)

function runCommand(cmd: string): void {
  if (runningName.value) return
  window.tagterm.pty.write(props.session.id, `${cmd}\r`)
  workspace.focusActive()
}

function runFromMore(cmd: string): void {
  if (runningName.value) return // 置灰的项点了什么都不发生，弹出层也不收
  closeMore()
  runCommand(cmd)
}

function clearScreen(): void {
  runCommand(props.session.shell === 'cmd.exe' ? 'cls' : 'clear')
}

// ---- 拖拽 ----
/** 拖到「更多 ▾」上停多久自动展开 */
const MORE_HOVER_OPEN_MS = 500
/** 正在拖的命令 id；null = 没在拖 */
const dragId = ref<string | null>(null)
/** 当前落点（松手会插到哪）；null = 不在任何落点上，松手原样弹回 */
const dropAt = ref<LaunchDrop | null>(null)
/** 正悬停在「更多 ▾」按钮上（高亮它） */
const isOverMore = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

/** 「更多 ▾」在有非常用命令时显示；全是常用时拖动期间临时出现，当作落点 */
const isMoreShown = computed(() => settings.moreCommands.length > 0 || dragId.value !== null)

function cancelHoverTimer(): void {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = null
}
onUnmounted(cancelHoverTimer)

function startDrag(id: string, e: DragEvent): void {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

/** 悬停在一个按钮 / 列表项上：落在它哪半边决定插在它前还是后（平铺按钮看左右，「更多」列表看上下） */
function overItem(zone: LaunchZone, index: number, e: DragEvent): void {
  if (!dragId.value) return
  e.preventDefault() // 允许在这里放下
  isOverMore.value = false // 离开「更多 ▾」进了别的落点（dragleave 与 dragenter 的先后不可靠，这里再清一次）
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const isAfter =
    zone === 'pinned'
      ? e.clientX > rect.left + rect.width / 2
      : e.clientY > rect.top + rect.height / 2
  dropAt.value = { zone, index: isAfter ? index + 1 : index }
}

/** 「唤起」小字上 = 最前面的常用按钮 */
function overLabel(e: DragEvent): void {
  if (!dragId.value) return
  e.preventDefault()
  isOverMore.value = false
  dropAt.value = { zone: 'pinned', index: 0 }
}

/** 「更多 ▾」按钮上 = 「更多」末尾；停半秒自动展开，好放到列表中间 */
function overMore(e: DragEvent): void {
  if (!dragId.value) return
  e.preventDefault()
  isOverMore.value = true
  dropAt.value = { zone: 'more', index: settings.moreCommands.length }
  if (!isMoreOpen.value && !hoverTimer && settings.moreCommands.length > 0) {
    hoverTimer = setTimeout(() => {
      hoverTimer = null
      if (dragId.value) openMore()
    }, MORE_HOVER_OPEN_MS)
  }
}

function leaveTarget(): void {
  dropAt.value = null
}

function leaveMore(): void {
  isOverMore.value = false
  dropAt.value = null
  cancelHoverTimer()
}

/** 拖动结束（放下或松在别处）：清掉拖动状态；拖动中展开过的「更多」一并收起 */
function endDrag(): void {
  if (!dragId.value) return
  dragId.value = null
  dropAt.value = null
  isOverMore.value = false
  cancelHoverTimer()
  closeMore()
}

async function finishDrop(): Promise<void> {
  const id = dragId.value
  const at = dropAt.value
  endDrag()
  if (!id || !at) return
  const next = dropLaunchCommand(settings.launchCommands, id, at)
  if (!next) return // 松在原位
  try {
    await settings.saveLaunchCommands(next)
  } catch (err) {
    emit('error', err instanceof Error ? err.message : String(err))
  }
}

/** 落点标记（竖线 / 横线）画在哪个按钮的哪一边：插在第 i 个前 = 它的 before；插在末尾 = 最后一个的 after */
function dropMark(zone: LaunchZone, index: number, count: number): 'before' | 'after' | undefined {
  const at = dropAt.value
  if (!at || at.zone !== zone || (zone === 'more' && isOverMore.value)) return undefined
  if (at.index === index) return 'before'
  if (at.index === count && index === count - 1) return 'after'
  return undefined
}
</script>

<template>
  <span class="launch">
    <span
      class="lab"
      :data-drop="
        dragId && !settings.pinnedCommands.length && dropAt?.zone === 'pinned' ? 'after' : undefined
      "
      data-test="launch-label"
      @dragover="overLabel"
      @dragleave="leaveTarget"
      @drop.prevent="finishDrop"
      >唤起</span
    >
    <button
      v-for="(c, i) in settings.pinnedCommands"
      :key="c.id"
      class="btn sm mono"
      :class="{ busy: runningName }"
      :title="busyTitle ?? c.command"
      :aria-disabled="runningName ? 'true' : undefined"
      draggable="true"
      :data-drop="dropMark('pinned', i, settings.pinnedCommands.length)"
      data-test="launch-cmd"
      @click="runCommand(c.command)"
      @dragstart="startDrag(c.id, $event)"
      @dragover="overItem('pinned', i, $event)"
      @dragleave="leaveTarget"
      @drop.prevent="finishDrop"
      @dragend="endDrag"
    >
      {{ c.label }}
    </button>
    <span v-if="isMoreShown" ref="moreEl" class="more">
      <button
        class="btn sm"
        :data-drop="isOverMore ? 'into' : undefined"
        data-test="launch-more"
        @click="toggleMore"
        @dragover="overMore"
        @dragleave="leaveMore"
        @drop.prevent="finishDrop"
      >
        更多 ▾
      </button>
      <div
        v-if="isMoreOpen && settings.moreCommands.length"
        class="pop"
        data-test="launch-more-pop"
      >
        <button
          v-for="(c, i) in settings.moreCommands"
          :key="c.id"
          class="item mono"
          :class="{ busy: runningName }"
          :title="busyTitle ?? c.command"
          :aria-disabled="runningName ? 'true' : undefined"
          draggable="true"
          :data-drop="dropMark('more', i, settings.moreCommands.length)"
          data-test="launch-more-item"
          @click="runFromMore(c.command)"
          @dragstart="startDrag(c.id, $event)"
          @dragover="overItem('more', i, $event)"
          @dragleave="leaveTarget"
          @drop.prevent="finishDrop"
          @dragend="endDrag"
        >
          {{ c.label }}
        </button>
      </div>
    </span>
    <button class="btn sm" title="编辑唤起命令" data-test="launch-edit" @click="isEditOpen = true">
      编辑
    </button>
    <button
      class="btn sm"
      :class="{ busy: runningName }"
      :title="busyTitle"
      :aria-disabled="runningName ? 'true' : undefined"
      data-test="strip-clear"
      @click="clearScreen"
    >
      清屏
    </button>
    <LaunchCommandsModal v-if="isEditOpen" @close="isEditOpen = false" />
  </span>
</template>

<style scoped>
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
/* 拖拽落点：插在按钮左 / 右（「更多」列表里是上 / 下）画一条主色线；悬停「更多 ▾」时整个按钮高亮 */
.btn[data-drop='before'],
.lab[data-drop='after'] {
  box-shadow: inset 3px 0 0 var(--accent);
}
.btn[data-drop='after'] {
  box-shadow: inset -3px 0 0 var(--accent);
}
.pop .item[data-drop='before'] {
  box-shadow: inset 0 2px 0 var(--accent);
}
.pop .item[data-drop='after'] {
  box-shadow: inset 0 -2px 0 var(--accent);
}
.btn[data-drop='into'] {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, #fff);
}
/* 置灰：看得出点不动，但仍可拖动（不是 disabled） */
.busy {
  opacity: 0.45;
  cursor: default;
}
.pop .item.busy:hover {
  background: none;
}
</style>

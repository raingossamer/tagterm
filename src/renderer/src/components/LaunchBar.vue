<script setup lang="ts">
// 路径条右侧的唤起区：「唤起」小字、settings.json 里的命令（pinned 平铺、其余收进「更多 ▾」）、「编辑」、清屏。
// 唤起按钮本质是向当前会话的终端写入 `<cmd>\r` —— 所以终端里有程序在跑时（认出的工具或任何程序）唤起按钮与清屏置灰：
// 那时写进去的命令会被当成一条消息发给那个程序（用户 2026-09-23 判定）。置灰用 aria-disabled 而不是 disabled：
// disabled 的按钮收不到拖拽事件，置灰的按钮仍要能拖动调顺序
import { computed, ref } from 'vue'
import type { Session } from '@shared/models'
import { useAgentStore } from '../stores/agent'
import { useSettingsStore } from '../stores/settings'
import { usePopover } from '../composables/usePopover'
import LaunchCommandsModal from './LaunchCommandsModal.vue'

const props = defineProps<{ session: Session }>()
const settings = useSettingsStore()
const agent = useAgentStore()
const isEditOpen = ref(false)
// 点击式弹出层：点击容器（按钮 + 弹出层）外部即关闭
const moreEl = ref<HTMLElement | null>(null)
const { isOpen: isMoreOpen, toggle: toggleMore, close: closeMore } = usePopover(moreEl)

/** 终端里正在跑的程序（工具正式名称或进程名）；回到提示符为 null */
const runningName = computed(() => agent.runningNameOf(props.session.id))
const busyTitle = computed(() =>
  runningName.value ? `当前在 ${runningName.value} 里，退出后再用` : undefined,
)

function runCommand(cmd: string): void {
  if (runningName.value) return
  window.tagterm.pty.write(props.session.id, `${cmd}\r`)
}

function runFromMore(cmd: string): void {
  if (runningName.value) return // 置灰的项点了什么都不发生，弹出层也不收
  closeMore()
  runCommand(cmd)
}

function clearScreen(): void {
  runCommand(props.session.shell === 'cmd.exe' ? 'cls' : 'clear')
}
</script>

<template>
  <span class="launch">
    <span class="lab" data-test="launch-label">唤起</span>
    <button
      v-for="c in settings.pinnedCommands"
      :key="c.id"
      class="btn sm mono"
      :class="{ busy: runningName }"
      :title="busyTitle ?? c.command"
      :aria-disabled="runningName ? 'true' : undefined"
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
          :class="{ busy: runningName }"
          :title="busyTitle ?? c.command"
          :aria-disabled="runningName ? 'true' : undefined"
          data-test="launch-more-item"
          @click="runFromMore(c.command)"
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
/* 置灰：看得出点不动，但仍可拖动（不是 disabled） */
.busy {
  opacity: 0.45;
  cursor: default;
}
.pop .item.busy:hover {
  background: none;
}
</style>

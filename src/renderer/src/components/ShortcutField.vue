<script setup lang="ts">
// 设置「启动」段里的一个全局快捷键：开关 + 键位框（点框录制新组合）+ 说明 + 红字。
// 两个热键（唤出 / 隐藏窗口、本周备忘）共用：data-test 前缀与提交函数由父组件给，状态以主进程返回的为准回填。
// 录制期间暂停全部热键（免得按到旧键把窗口藏掉或开出备忘录），录完 / Esc / 失焦 / 卸载都恢复。
import { computed, onUnmounted, ref } from 'vue'
import type { GlobalShortcutStatus } from '@shared/ipc'
import type { GlobalShortcutConfig } from '@shared/models'
import { captureAccelerator } from '../composables/shortcutCapture'

const SHORTCUT_OCCUPIED = '该快捷键已被其他程序占用，换一个组合'
const SHORTCUT_RULE = '需要包含 Ctrl 或 Alt，再加字母、数字或 F1–F12'

const props = defineProps<{
  status: GlobalShortcutStatus
  /** data-test 前缀：<id>-section / -label / -enabled / -key / -hint / -error */
  testId: string
  label: string
  hint: string
  /** 提交新配置（主进程先注册、成功才落盘），返回实际状态；被占用等 reject */
  submit: (config: GlobalShortcutConfig) => Promise<GlobalShortcutStatus>
}>()
const emit = defineEmits<{ 'update:status': [status: GlobalShortcutStatus] }>()

const isCapturing = ref(false)
const error = ref('')
/** 键位框下的红字：这次操作的错误优先，否则启动时没注册上（被别的程序占着）也要说 */
const problem = computed(
  () => error.value || (props.status.enabled && !props.status.registered ? SHORTCUT_OCCUPIED : ''),
)

async function submitConfig(config: GlobalShortcutConfig): Promise<boolean> {
  error.value = ''
  try {
    emit('update:status', await props.submit(config))
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    return false
  }
}

async function onEnabledChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const isOk = await submitConfig({ enabled: input.checked, accelerator: props.status.accelerator })
  if (!isOk) input.checked = props.status.enabled
}

/** 点键位框开始录制：先暂停热键；关着开关时框是置灰的，点了不录 */
function startCapture(): void {
  if (!props.status.enabled || isCapturing.value) return
  error.value = ''
  isCapturing.value = true
  void window.tagterm.app.pauseGlobalShortcut(true)
}

async function stopCapture(): Promise<void> {
  if (!isCapturing.value) return
  isCapturing.value = false
  await window.tagterm.app.pauseGlobalShortcut(false)
}

/** 录制中的按键全部截下（Esc 也不冒泡到弹窗的关闭监听）：只按修饰键继续等、不合法提示规则、合法即提交 */
async function onKeydown(e: KeyboardEvent): Promise<void> {
  if (!isCapturing.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    error.value = ''
    await stopCapture()
    return
  }
  const result = captureAccelerator(e)
  if (result.kind === 'pending') return
  if (result.kind === 'invalid') {
    error.value = SHORTCUT_RULE
    return
  }
  await stopCapture()
  await submitConfig({ enabled: true, accelerator: result.value })
}

function onBlur(): void {
  if (!isCapturing.value) return
  error.value = ''
  void stopCapture()
}

// 录制中关掉弹窗：把暂停的热键恢复
onUnmounted(() => {
  if (isCapturing.value) void window.tagterm.app.pauseGlobalShortcut(false)
})
</script>

<template>
  <div class="shortcut" :data-test="`${testId}-section`">
    <label class="check" :data-test="`${testId}-label`">
      <input
        type="checkbox"
        :checked="status.enabled"
        :data-test="`${testId}-enabled`"
        @change="onEnabledChange"
      />
      <span v-text="label"></span>
    </label>
    <div class="row">
      <button
        class="key-box mono"
        :class="{ capturing: isCapturing }"
        type="button"
        :data-test="`${testId}-key`"
        :aria-disabled="status.enabled ? undefined : 'true'"
        :title="status.enabled ? '点击后按下新的组合键' : '先打开左边的开关'"
        @click="startCapture"
        @keydown="onKeydown"
        @blur="onBlur"
        v-text="isCapturing ? '按下新的组合键…' : status.accelerator"
      ></button>
    </div>
    <p class="hint" :data-test="`${testId}-hint`" v-text="hint"></p>
    <p v-if="problem" class="error" :data-test="`${testId}-error`" v-text="problem"></p>
  </div>
</template>

<style scoped>
/* 与 SettingsModal 里同名类的写法一致（scoped 样式不进子组件，这里各写一份） */
.shortcut {
  margin-top: 18px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0 6px;
}
.mono {
  font-family: var(--mono);
}
.key-box {
  min-width: 140px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  text-align: left;
}
.key-box.capturing {
  border-color: var(--accent);
  color: var(--accent);
}
.key-box[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}
.error {
  margin: 10px 0 0;
  font-size: 12px;
  color: #b42318;
}
</style>

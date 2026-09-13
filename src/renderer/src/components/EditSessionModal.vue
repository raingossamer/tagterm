<script setup lang="ts">
// 编辑会话弹窗（右键菜单「编辑会话」打开）：名称 / 目录（可手输或「浏览…」）/ Shell（只列可用）预填；
// 「保存」只提交变了的字段，没变直接关闭；改目录 / Shell 由主进程判定 shell 是否空闲：有程序在跑 → reject 红字显示、弹窗保持，
// 空闲 → 主进程先结束 pty 再改记录。保存成功后若该会话的终端打开过（phase 不是 closed）就重新选中 = 按新配置重启并切到该页
import { onMounted, onUnmounted, ref } from 'vue'
import type { SessionPatch } from '@shared/ipc'
import type { Session } from '@shared/models'
import { useShells } from '../composables/useShells'
import { useSessionsStore } from '../stores/sessions'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{ session: Session }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const sessions = useSessionsStore()
const workspace = useWorkspaceStore()

const name = ref(props.session.name)
const cwd = ref(props.session.cwd)
const error = ref('')
const { shell, shells } = useShells(props.session.shell, (message) => (error.value = message))
const pathPlaceholder = ref('D:\\Projects\\...')
const nameInput = ref<HTMLInputElement | null>(null)
const pathInput = ref<HTMLInputElement | null>(null)

/** 只含变了的字段；名称留空视为不改（主进程也会保留原名） */
function buildPatch(dir: string): SessionPatch {
  const patch: SessionPatch = {}
  const nextName = name.value.trim()
  if (nextName && nextName !== props.session.name) patch.name = nextName
  if (dir !== props.session.cwd) patch.cwd = dir
  if (shell.value !== props.session.shell) patch.shell = shell.value
  return patch
}

async function save(): Promise<void> {
  const dir = cwd.value.trim()
  if (!dir) {
    pathPlaceholder.value = '需要一个目录'
    pathInput.value?.focus()
    return
  }
  const patch = buildPatch(dir)
  if (Object.keys(patch).length === 0) {
    emit('close')
    return
  }
  error.value = ''
  try {
    await sessions.update(props.session.id, patch)
    // 主进程已结束空闲 pty 并等到 exit 广播，这里的运行态已是 exited：再选中即按新配置重启
    if (workspace.phaseOf(props.session.id) !== 'closed') await workspace.select(props.session.id)
    emit('saved')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function browse(): Promise<void> {
  const picked = await window.tagterm.session.pickDirectory()
  if (picked) cwd.value = picked
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close')
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  nameInput.value?.focus()
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="backdrop show"
    data-test="edit-session-modal"
    @mousedown="onBackdropMousedown"
    @keydown.enter="save"
  >
    <div class="modal">
      <h3>编辑会话</h3>
      <div class="field">
        <label for="esName">名称</label>
        <input id="esName" ref="nameInput" v-model="name" data-test="es-name" />
      </div>
      <div class="field">
        <label for="esPath">目录</label>
        <div class="path-row">
          <input
            id="esPath"
            ref="pathInput"
            v-model="cwd"
            class="mono"
            :placeholder="pathPlaceholder"
            data-test="es-path"
          />
          <button class="btn" type="button" data-test="es-browse" @click="browse">浏览…</button>
        </div>
      </div>
      <div class="field">
        <label for="esShell">Shell</label>
        <select id="esShell" v-model="shell" data-test="es-shell">
          <option v-for="s in shells" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <p class="hint" data-test="es-hint">更改目录或 Shell 会重启这个会话的终端</p>
      <p v-if="error" class="error" data-test="es-error">{{ error }}</p>
      <div class="actions">
        <button class="btn" type="button" data-test="es-cancel" @click="emit('close')">取消</button>
        <button class="btn primary" type="button" data-test="es-save" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  width: 460px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  padding: 18px 20px;
}
.modal h3 {
  margin: 0 0 14px;
  font-size: 16px;
}
.path-row {
  display: flex;
  gap: 8px;
}
.path-row input {
  flex: 1;
  min-width: 0;
}
.hint {
  margin: 0;
}
.error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #b42318;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>

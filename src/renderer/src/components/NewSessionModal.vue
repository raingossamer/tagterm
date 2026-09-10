<script setup lang="ts">
// 新建会话弹窗：名称 / 目录（可手输或「浏览…」）/ Shell；目录必填，名称缺省由主进程取目录末段
import { onMounted, ref } from 'vue'
import type { Session, ShellKind } from '@shared/models'
import { DEFAULT_SHELL } from '@shared/models'
import { useSessionsStore } from '../stores/sessions'

const emit = defineEmits<{ close: []; created: [session: Session] }>()
const sessions = useSessionsStore()

const name = ref('')
const cwd = ref('')
const shell = ref<ShellKind>(DEFAULT_SHELL)
const shells = ref<ShellKind[]>([DEFAULT_SHELL])
const pathPlaceholder = ref('D:\\Projects\\...')
const error = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const pathInput = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  nameInput.value?.focus()
  try {
    const available = await window.tagterm.app.listShells()
    if (available.length) {
      shells.value = available
      if (!available.includes(shell.value)) shell.value = available[0]!
    }
  } catch (err) {
    error.value = String(err)
  }
})

async function browse(): Promise<void> {
  const picked = await window.tagterm.session.pickDirectory()
  if (picked) cwd.value = picked
}

async function create(): Promise<void> {
  const dir = cwd.value.trim()
  if (!dir) {
    pathPlaceholder.value = '需要一个目录'
    pathInput.value?.focus()
    return
  }
  error.value = ''
  try {
    const session = await sessions.create({
      cwd: dir,
      name: name.value.trim() || undefined,
      shell: shell.value,
    })
    emit('created', session)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <div class="backdrop show" @mousedown="onBackdropMousedown" @keydown.enter="create">
    <div class="modal">
      <h3>新建会话</h3>
      <div class="field">
        <label for="nsName">名称</label>
        <input
          id="nsName"
          ref="nameInput"
          v-model="name"
          placeholder="例如 simba-api"
          data-test="ns-name"
        />
      </div>
      <div class="field">
        <label for="nsPath">目录</label>
        <div class="path-row">
          <input
            id="nsPath"
            ref="pathInput"
            v-model="cwd"
            class="mono"
            :placeholder="pathPlaceholder"
            data-test="ns-path"
          />
          <button class="btn" type="button" data-test="ns-browse" @click="browse">浏览…</button>
        </div>
      </div>
      <div class="field">
        <label for="nsShell">Shell</label>
        <select id="nsShell" v-model="shell" data-test="ns-shell">
          <option v-for="s in shells" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <p v-if="error" class="error" data-test="ns-error">{{ error }}</p>
      <div class="actions">
        <button class="btn" type="button" data-test="ns-cancel" @click="emit('close')">取消</button>
        <button class="btn primary" type="button" data-test="ns-create" @click="create">
          创建并打开
        </button>
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
.error {
  margin: 0 0 8px;
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

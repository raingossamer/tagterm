<script setup lang="ts">
// 「唤起命令」编辑弹窗：每行 = 拖拽手柄 / 显示名 / 命令 / 「常用」开关 / 删除；「新增」；行间 HTML5 拖拽排序；「完成」整体保存
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { LaunchCommandInput } from '@shared/ipc'
import { useSettingsStore } from '../stores/settings'
import { moveItem } from '../composables/launchCommands'

const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()

const rows = ref<LaunchCommandInput[]>(
  [...settings.launchCommands].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ ...c })),
)
const error = ref('')
const isSaving = ref(false)
const commandInputs = ref<HTMLInputElement[]>([])
let dragFrom = -1

async function addRow(): Promise<void> {
  rows.value.push({ label: '', command: '', pinned: true, sortOrder: rows.value.length + 1 })
  await nextTick()
  commandInputs.value[rows.value.length - 1]?.focus()
}

function removeRow(i: number): void {
  rows.value.splice(i, 1)
}

function onDragStart(i: number, e: DragEvent): void {
  dragFrom = i
  e.dataTransfer?.setData('text/plain', String(i))
}

function onDrop(to: number): void {
  if (dragFrom < 0) return
  rows.value = moveItem(rows.value, dragFrom, to)
  dragFrom = -1
}

async function done(): Promise<void> {
  error.value = ''
  isSaving.value = true
  try {
    await settings.saveLaunchCommands(rows.value)
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isSaving.value = false
  }
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="backdrop show" data-test="launch-modal" @mousedown="onBackdropMousedown">
    <div class="modal">
      <h3>唤起命令</h3>
      <p class="hint">「常用」的命令平铺在路径条，其余收进「更多 ▾」；拖动左侧手柄调整顺序。</p>
      <div v-if="rows.length" class="head">
        <span></span>
        <span>显示名</span>
        <span>命令</span>
        <span>常用</span>
        <span></span>
      </div>
      <div
        v-for="(row, i) in rows"
        :key="row.id ?? `new-${i}`"
        class="row"
        data-test="lc-row"
        @dragover.prevent
        @drop.prevent="onDrop(i)"
      >
        <span
          class="handle"
          title="拖动排序"
          draggable="true"
          data-test="lc-handle"
          @dragstart="onDragStart(i, $event)"
          >⋮⋮</span
        >
        <input v-model="row.label" placeholder="缺省 = 命令" data-test="lc-label" />
        <input
          ref="commandInputs"
          v-model="row.command"
          class="mono"
          placeholder="例如 claude --continue"
          data-test="lc-command"
        />
        <input v-model="row.pinned" type="checkbox" title="常用" data-test="lc-pinned" />
        <button class="btn sm danger" type="button" data-test="lc-delete" @click="removeRow(i)">
          删除
        </button>
      </div>
      <p v-if="!rows.length" class="empty" data-test="lc-empty">还没有唤起命令，点「新增」添加</p>
      <p v-if="error" class="error" data-test="lc-error">{{ error }}</p>
      <div class="actions">
        <button class="btn" type="button" data-test="lc-add" @click="addRow">新增</button>
        <span class="spacer"></span>
        <button class="btn" type="button" data-test="lc-cancel" @click="emit('close')">取消</button>
        <button
          class="btn primary"
          type="button"
          :disabled="isSaving"
          data-test="lc-done"
          @click="done"
        >
          完成
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
  width: 620px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  padding: 18px 20px;
}
.modal h3 {
  margin: 0 0 6px;
  font-size: 16px;
}
.modal .hint {
  margin: 0 0 12px;
}
.head,
.row {
  display: grid;
  grid-template-columns: 20px 1fr 1.6fr 40px auto;
  gap: 8px;
  align-items: center;
}
.head {
  font-size: 12px;
  color: var(--muted);
  padding: 0 0 4px;
}
.head span:nth-child(4) {
  text-align: center;
}
.row {
  padding: 4px 0;
}
.row input[type='text'],
.row input:not([type]) {
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
}
.row input.mono {
  font-family: var(--mono);
}
.row input[type='checkbox'] {
  justify-self: center;
  width: 16px;
  height: 16px;
}
.handle {
  cursor: grab;
  color: var(--muted);
  user-select: none;
  letter-spacing: -2px;
  text-align: center;
}
.empty {
  margin: 8px 0;
  font-size: 12.5px;
  color: var(--muted);
  text-align: center;
}
.error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #b42318;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.spacer {
  flex: 1;
}
</style>

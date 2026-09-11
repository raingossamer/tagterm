<script setup lang="ts">
// 「管理标签」弹窗：每行 = 色块（点击按八色表轮转到下一色，即时提交）/ 可编辑名称（change 即提交；空则还原；
// 撞名则还原为原名并在行下红字提示 1.2 s）/ 「N 个会话」/ 「删除」（confirm 后 tag.remove，并从筛选选中集合移除）；
// 底部「新标签名，回车添加」；「完成」/ Esc / 点遮罩关闭。所有改动即时提交，列表以主进程广播为准
import { onMounted, onUnmounted, ref } from 'vue'
import { TAG_COLORS, type Tag } from '@shared/models'
import { useFilterStore } from '../stores/filter'
import { useTagsStore } from '../stores/tags'

const FLASH_MS = 1200

const emit = defineEmits<{ close: [] }>()
const tags = useTagsStore()
const filter = useFilterStore()
const newName = ref('')
/** 行内错误：tagId → 文案，1.2 s 后自动清除 */
const rowErrors = ref<Record<string, string>>({})
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>()

function flashError(tagId: string, message: string): void {
  rowErrors.value = { ...rowErrors.value, [tagId]: message }
  const prev = flashTimers.get(tagId)
  if (prev) clearTimeout(prev)
  flashTimers.set(
    tagId,
    setTimeout(() => {
      const { [tagId]: _removed, ...rest } = rowErrors.value
      rowErrors.value = rest
      flashTimers.delete(tagId)
    }, FLASH_MS),
  )
}

function nextColor(tag: Tag): void {
  const i = TAG_COLORS.indexOf(tag.color)
  const color = TAG_COLORS[(i + 1) % TAG_COLORS.length]!
  void tags.update(tag.id, { color }).catch((err) => flashError(tag.id, messageOf(err)))
}

/** 空名还原，不提交；撞名（SDK reject）还原并红字提示 */
async function rename(tag: Tag, e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  if (!input.value.trim()) {
    input.value = tag.name
    return
  }
  try {
    await tags.update(tag.id, { name: input.value })
  } catch (err) {
    input.value = tag.name
    flashError(tag.id, messageOf(err))
  }
}

async function remove(tag: Tag): Promise<void> {
  if (!window.confirm(`删除标签 "${tag.name}"？会话本身会保留。`)) return
  try {
    await tags.remove(tag.id)
    filter.deselect(tag.id)
  } catch (err) {
    flashError(tag.id, messageOf(err))
  }
}

async function create(): Promise<void> {
  if (!newName.value.trim()) return
  await tags.create(newName.value)
  newName.value = ''
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close')
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  for (const t of flashTimers.values()) clearTimeout(t)
})
</script>

<template>
  <div class="backdrop show" data-test="manage-tags-modal" @mousedown="onBackdropMousedown">
    <div class="modal">
      <h3>管理标签</h3>
      <div
        v-for="t in tags.sortedTags"
        :key="t.id"
        class="tagrow"
        :style="{ '--c': t.color }"
        data-test="mt-row"
      >
        <button class="sw" title="换颜色" data-test="mt-color" @click="nextColor(t)"></button>
        <input :value="t.name" data-test="mt-name" @change="rename(t, $event)" />
        <em data-test="mt-count">{{ tags.countOf(t.id) }} 个会话</em>
        <button class="btn sm danger" data-test="mt-delete" @click="remove(t)">删除</button>
        <div v-if="rowErrors[t.id]" class="row-error" data-test="mt-error">
          {{ rowErrors[t.id] }}
        </div>
      </div>
      <div v-if="!tags.sortedTags.length" class="hint" data-test="mt-empty">还没有标签</div>
      <div class="field new">
        <input
          v-model="newName"
          placeholder="新标签名，回车添加"
          data-test="mt-new"
          @keydown.enter.prevent="create"
        />
      </div>
      <div class="actions">
        <button class="btn primary" data-test="mt-done" @click="emit('close')">完成</button>
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
.tagrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #eef0f3;
}
.tagrow .sw {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--c);
  flex: none;
}
.tagrow input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  min-width: 0;
}
.tagrow input:hover,
.tagrow input:focus {
  border-color: var(--line);
}
.tagrow em {
  font-style: normal;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.row-error {
  flex-basis: 100%;
  font-size: 12px;
  color: #b42318;
}
.new {
  margin-top: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>

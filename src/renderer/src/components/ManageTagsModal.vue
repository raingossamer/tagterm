<script setup lang="ts">
// 「管理标签」弹窗（改动即时提交，列表以主进程广播为准）。每行：
//   拖拽手柄（松手即 tags.reorder 整体重排）/ 色块（点击按八色表轮转）/ 名称输入框（常显边框，change 即提交，
//   空则还原，撞名还原并红字 1.2 s）/ 「左栏显示」复选框（取消 → hidden:true 且该行变淡并从筛选取消选中；勾上 → hidden:false）
//   / 「N 个会话」/ 「删除」。底部「新标签名，回车添加」；「完成」/ Esc / 点遮罩关闭。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { TAG_COLORS, type Tag } from '@shared/models'
import { moveItem } from '../composables/launchCommands'
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

/** 本地展示顺序（标签 id）：跟随广播的 sortedTags；拖拽时先本地重排，松手提交，广播到达后归位 */
const order = ref<string[]>([])
watch(
  () => tags.sortedTags.map((t) => t.id),
  (ids) => {
    order.value = ids
  },
  { immediate: true },
)
/** 按本地顺序取标签行（广播替换 tags 后 byId 仍能取到，避免拖拽瞬间闪一下） */
const rows = computed<Tag[]>(() =>
  order.value.map((id) => tags.byId(id)).filter((t): t is Tag => !!t),
)

let dragFrom = -1
function onDragStart(i: number, e: DragEvent): void {
  dragFrom = i
  e.dataTransfer?.setData('text/plain', String(i)) // Firefox 需要设点数据才启动拖拽
}
function onDrop(to: number): void {
  if (dragFrom < 0 || dragFrom === to) return
  order.value = moveItem(order.value, dragFrom, to)
  dragFrom = -1
  void tags.reorder([...order.value]).catch((err) => {
    order.value = tags.sortedTags.map((t) => t.id) // 失败还原为已保存顺序
    flashError('*', messageOf(err))
  })
}

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

/** 「左栏显示」复选框：取消勾选 = 隐藏（并从筛选选中集合移除，与删除一致）；勾选 = 取消隐藏 */
async function toggleVisible(tag: Tag, e: Event): Promise<void> {
  const shown = (e.target as HTMLInputElement).checked
  try {
    await tags.update(tag.id, { hidden: !shown })
    if (!shown) filter.deselect(tag.id)
  } catch (err) {
    ;(e.target as HTMLInputElement).checked = !tag.hidden
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
      <p v-if="rowErrors['*']" class="row-error" data-test="mt-error">{{ rowErrors['*'] }}</p>
      <div
        v-for="t in rows"
        :key="t.id"
        class="tagrow"
        :class="{ 'is-hidden': t.hidden }"
        :style="{ '--c': t.color }"
        data-test="mt-row"
        @dragover.prevent
        @drop.prevent="onDrop(order.indexOf(t.id))"
      >
        <span
          class="handle"
          title="拖动排序"
          draggable="true"
          data-test="mt-handle"
          @dragstart="onDragStart(order.indexOf(t.id), $event)"
          >⋮⋮</span
        >
        <button class="sw" title="换颜色" data-test="mt-color" @click="nextColor(t)"></button>
        <input :value="t.name" data-test="mt-name" @change="rename(t, $event)" />
        <label class="show" title="在左栏显示这个标签">
          <input
            type="checkbox"
            :checked="!t.hidden"
            data-test="mt-visible"
            @change="toggleVisible(t, $event)"
          />
          左栏显示
        </label>
        <em data-test="mt-count">{{ tags.countOf(t.id) }} 个会话</em>
        <button class="btn sm danger" data-test="mt-delete" @click="remove(t)">删除</button>
        <div v-if="rowErrors[t.id]" class="row-error" data-test="mt-error">
          {{ rowErrors[t.id] }}
        </div>
      </div>
      <div v-if="!rows.length" class="hint" data-test="mt-empty">还没有标签</div>
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
/* 隐藏的标签整行变淡，但仍可操作（改名 / 换色 / 勾回 / 删除 / 拖拽） */
.tagrow.is-hidden .sw,
.tagrow.is-hidden input[data-test='mt-name'],
.tagrow.is-hidden em {
  opacity: 0.45;
}
.tagrow .handle {
  cursor: grab;
  color: var(--muted);
  user-select: none;
  flex: none;
  padding: 0 2px;
}
.tagrow .sw {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--c);
  flex: none;
}
.tagrow input[data-test='mt-name'] {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--line); /* 常显边框，一眼看出可编辑 */
  border-radius: 5px;
  min-width: 0;
  background: #fff;
}
.tagrow input[data-test='mt-name']:hover,
.tagrow input[data-test='mt-name']:focus {
  border-color: var(--accent);
}
.tagrow .show {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  flex: none;
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
.new input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>

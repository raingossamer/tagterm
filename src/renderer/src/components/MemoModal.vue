<script setup lang="ts">
// 「本周备忘」弹窗：本周的待办清单（回车添加可连记、勾选、点文字就地改、删除不确认），‹ › 翻往周只读。
// 归哪一周由 shared/week 推算：未完成一律在本周（创建于往周的标「自 Wxx」），已完成按完成时间归周。
// 关闭只 emit close（Esc / 点遮罩 / 「完成」），存在与否由父组件 v-if 控制。
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { MEMO_TEXT_MAX, type MemoItem } from '@shared/models'
import {
  addWeeks,
  carriedFromLabel,
  compareWeeks,
  earliestMemoWeek,
  isoWeekOf,
  memosOfWeek,
  weekLabel,
  type IsoWeek,
} from '@shared/week'
import { useMemoStore } from '../stores/memo'

const props = withDefaults(defineProps<{ now?: Date }>(), { now: () => new Date() })
const emit = defineEmits<{ close: [] }>()
const memo = useMemoStore()

const thisWeek = computed(() => isoWeekOf(props.now))
const viewWeek = ref<IsoWeek>(isoWeekOf(props.now))
const isCurrent = computed(() => compareWeeks(viewWeek.value, thisWeek.value) === 0)
const canPrev = computed(
  () => compareWeeks(viewWeek.value, earliestMemoWeek(memo.items, props.now)) > 0,
)
const rows = computed(() => memosOfWeek(memo.items, viewWeek.value, props.now))

const newText = ref('')
const error = ref('')
const input = ref<HTMLInputElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
const editInput = ref<HTMLInputElement[]>([])

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 失败一律写在弹窗顶部红字；成功的操作清掉它 */
async function run(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action()
    error.value = ''
    return true
  } catch (err) {
    error.value = messageOf(err)
    return false
  }
}

async function add(): Promise<void> {
  const text = newText.value.trim()
  if (!text) return
  if (await run(() => memo.create(text))) newText.value = ''
  input.value?.focus()
}

function toggle(item: MemoItem, e: Event): void {
  void run(() => memo.update(item.id, { done: (e.target as HTMLInputElement).checked }))
}

function remove(item: MemoItem): void {
  void run(() => memo.remove(item.id))
}

async function startEdit(item: MemoItem): Promise<void> {
  if (!isCurrent.value) return
  editingId.value = item.id
  editText.value = item.text
  await nextTick()
  editInput.value[0]?.focus()
}

/** 失焦或回车提交；改成空白 = 还原不提交；没变不提交 */
function commitEdit(item: MemoItem): void {
  if (editingId.value !== item.id) return
  editingId.value = null
  const text = editText.value.trim()
  if (text && text !== item.text) void run(() => memo.update(item.id, { text }))
}

/** 编辑框里的 Esc 只取消编辑：截停，不让 document 上的「Esc 关弹窗」收到 */
function cancelEdit(e: KeyboardEvent): void {
  e.stopPropagation()
  editingId.value = null
}

function go(delta: number): void {
  viewWeek.value = addWeeks(viewWeek.value, delta)
  editingId.value = null
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit('close')
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  input.value?.focus()
})
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="backdrop show" data-test="memo-modal" @mousedown="onBackdropMousedown">
    <div class="modal">
      <div class="head">
        <h3>本周备忘</h3>
        <button
          class="nav"
          title="上一周"
          data-test="memo-prev"
          :disabled="!canPrev"
          @click="go(-1)"
        >
          ‹
        </button>
        <span class="week" data-test="memo-week">{{ weekLabel(viewWeek, props.now) }}</span>
        <button
          class="nav"
          title="下一周"
          data-test="memo-next"
          :disabled="isCurrent"
          @click="go(1)"
        >
          ›
        </button>
        <span v-if="!isCurrent" class="readonly">只读</span>
      </div>
      <p v-if="error" class="err" data-test="memo-error">{{ error }}</p>
      <div v-if="isCurrent" class="field new">
        <input
          ref="input"
          v-model="newText"
          :maxlength="MEMO_TEXT_MAX"
          placeholder="新事项，回车添加"
          data-test="memo-input"
          @keydown.enter.prevent="add"
        />
      </div>
      <ul class="list">
        <li
          v-for="item in rows"
          :key="item.id"
          class="item"
          :class="{ done: item.done }"
          data-test="memo-item"
        >
          <input
            type="checkbox"
            :checked="item.done"
            :disabled="!isCurrent"
            data-test="memo-done"
            @change="toggle(item, $event)"
          />
          <input
            v-if="editingId === item.id"
            ref="editInput"
            v-model="editText"
            class="edit"
            :maxlength="MEMO_TEXT_MAX"
            data-test="memo-edit"
            @keydown.enter.prevent="commitEdit(item)"
            @keydown.esc="cancelEdit"
            @blur="commitEdit(item)"
          />
          <span
            v-else
            class="text"
            :class="{ editable: isCurrent }"
            :title="isCurrent ? '点击修改' : undefined"
            data-test="memo-text"
            @click="startEdit(item)"
            v-text="item.text"
          ></span>
          <em
            v-if="carriedFromLabel(item, props.now)"
            class="carried"
            data-test="memo-carried"
            v-text="`自 ${carriedFromLabel(item, props.now)}`"
          ></em>
          <button
            v-if="isCurrent"
            class="x"
            title="删除"
            data-test="memo-remove"
            @click="remove(item)"
          >
            ×
          </button>
        </li>
      </ul>
      <div v-if="!rows.length" class="hint" data-test="memo-empty">
        {{ isCurrent ? '本周还没有事项' : '这一周没有完成的事项' }}
      </div>
      <div class="actions">
        <button class="btn primary" data-test="memo-close" @click="emit('close')">完成</button>
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
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  padding: 18px 20px;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.head h3 {
  margin: 0 8px 0 0;
  font-size: 16px;
}
.head .week {
  font-size: 13px;
  color: var(--muted);
  min-width: 128px;
  text-align: center;
}
.head .nav {
  padding: 0 8px;
  border-radius: 5px;
  font-size: 16px;
  line-height: 22px;
  color: var(--muted);
}
.head .nav:hover:not(:disabled) {
  background: #eef0f3;
  color: var(--text);
}
.head .nav:disabled {
  opacity: 0.35;
  cursor: default;
}
.head .readonly {
  font-size: 12px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 8px;
}
.err {
  margin: 0 0 8px;
  font-size: 12px;
  color: #b42318;
}
.new input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
}
.new input:focus {
  border-color: var(--accent);
}
.list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #eef0f3;
  font-size: 13px;
}
.item .text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.item .text.editable {
  cursor: text;
}
.item.done .text {
  color: var(--muted);
  text-decoration: line-through;
}
.item .edit {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  font-size: 13px;
}
.item .carried {
  font-style: normal;
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 6px;
  white-space: nowrap;
  flex: none;
}
.item .x {
  opacity: 0.45;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1;
  flex: none;
}
.item .x:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.08);
}
.hint {
  padding: 16px 0 4px;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>

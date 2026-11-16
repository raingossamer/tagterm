<script setup lang="ts">
// 备忘小窗的整页（memo-floating-window）：标题栏（拖动窗口、周号与起止、‹ ›、×）、进度、输入框、待办 / 已完成两组
//（已完成可折叠，记在 localStorage）、往周只读条、空态、失败红字、底部提示。事项按把手拖出（text/plain = 文字），
// 拖到 TagTerm 的终端上即插入光标处。Esc / × 请主进程关掉（隐藏）小窗；编辑框里的 Esc 只取消编辑。
// 归哪一周由 shared/week 推算：未完成一律在本周（创建于往周的标「自 Wxx」），已完成按完成时间归周；往周只读。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { MEMO_TEXT_MAX, type MemoItem } from '@shared/models'
import {
  addWeeks,
  carriedFromLabel,
  compareWeeks,
  earliestMemoWeek,
  isoWeekOf,
  memosOfWeek,
  weekName,
  weekRange,
  type IsoWeek,
} from '@shared/week'
import type { Unsubscribe } from '@shared/api'
import { useMemoStore } from '../stores/memo'
import { memoApi } from '../memo/memoApi'
import { useNow } from '../composables/useNow'

/** now 只给测试固定时间；不给时用每分钟走一次的时钟（小窗可能开好几天） */
const props = defineProps<{ now?: Date }>()
const memo = useMemoStore()
const liveNow = useNow()
const now = computed(() => props.now ?? liveNow.value)

const thisWeek = computed(() => isoWeekOf(now.value))
const viewWeek = ref<IsoWeek>(isoWeekOf(now.value))
// 跨周了：原本看着本周的跟到新的一周
watch(thisWeek, (next, prev) => {
  if (compareWeeks(viewWeek.value, prev) === 0) viewWeek.value = next
})
const isCurrent = computed(() => compareWeeks(viewWeek.value, thisWeek.value) === 0)
const canPrev = computed(
  () => compareWeeks(viewWeek.value, earliestMemoWeek(memo.items, now.value)) > 0,
)
const rows = computed(() => memosOfWeek(memo.items, viewWeek.value, now.value))
const todo = computed(() => rows.value.filter((m) => !m.done))
const done = computed(() => rows.value.filter((m) => m.done))
const progress = computed(() =>
  rows.value.length ? Math.round((done.value.length / rows.value.length) * 100) : 0,
)

const COLLAPSED_KEY = 'tagterm.memoDoneCollapsed'
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}
const isDoneCollapsed = ref(readCollapsed())
function toggleDone(): void {
  isDoneCollapsed.value = !isDoneCollapsed.value
  try {
    localStorage.setItem(COLLAPSED_KEY, isDoneCollapsed.value ? '1' : '0')
  } catch (err) {
    console.warn('[memo] 折叠状态写入 localStorage 失败', err)
  }
}

const newText = ref('')
const error = ref('')
const input = ref<HTMLInputElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
const editInput = ref<HTMLInputElement[]>([])
const draggingId = ref<string | null>(null)

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 失败一律写在标题栏下的红字；成功的操作清掉它 */
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

/** 编辑框里的 Esc 只取消编辑：截停，不让 document 上的「Esc 关小窗」收到 */
function cancelEdit(e: KeyboardEvent): void {
  e.stopPropagation()
  editingId.value = null
}

function go(delta: number): void {
  viewWeek.value = addWeeks(viewWeek.value, delta)
  editingId.value = null
}

function backToThisWeek(): void {
  viewWeek.value = thisWeek.value
  editingId.value = null
}

/** 拖出：把这条事项的文字交给系统拖放（拖到 TagTerm 的终端上即插入光标处） */
function onDragStart(item: MemoItem, e: DragEvent): void {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/plain', item.text)
  e.dataTransfer.effectAllowed = 'copy'
  draggingId.value = item.id
}

function close(): void {
  memoApi().memoWindow.close()
}

async function focusInput(): Promise<void> {
  backToThisWeek()
  await nextTick()
  input.value?.focus()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

let unsubscribeFocus: Unsubscribe | null = null
onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  unsubscribeFocus = memoApi().memoWindow.onFocusInput(() => void focusInput())
  input.value?.focus()
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  unsubscribeFocus?.()
})
</script>

<template>
  <div class="mw" data-test="memo-panel">
    <div class="mw-title">
      <svg
        class="ico"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        aria-hidden="true"
      >
        <rect x="3" y="2.5" width="10" height="12" rx="1.5" />
        <path d="M6 2.5h4v2H6zM5.5 8h5M5.5 10.5h3.5" />
      </svg>
      <span class="name">本周备忘</span>
      <span class="wk">
        <button
          class="nav"
          title="上一周"
          data-test="memo-prev"
          :disabled="!canPrev"
          @click="go(-1)"
        >
          ‹
        </button>
        <span class="wk-label">
          <b data-test="memo-week-name" v-text="weekName(viewWeek, now)"></b>
          <span data-test="memo-week-range" v-text="weekRange(viewWeek)"></span>
        </span>
        <button
          class="nav"
          title="下一周"
          data-test="memo-next"
          :disabled="isCurrent"
          @click="go(1)"
        >
          ›
        </button>
      </span>
      <button class="close" title="关闭（Esc）" data-test="memo-close" @click="close">×</button>
    </div>

    <p
      v-if="error || memo.loadError"
      class="mw-err"
      data-test="memo-error"
      v-text="error || memo.loadError"
    ></p>

    <div v-if="!isCurrent" class="mw-ro" data-test="memo-readonly">
      <span class="pill" v-text="`${weekName(viewWeek, now)} · 只读`"></span>
      <span v-text="`这一周完成了 ${rows.length} 项`"></span>
      <button class="back" data-test="memo-back" @click="backToThisWeek">回到本周</button>
    </div>

    <div class="mw-body">
      <template v-if="isCurrent">
        <div v-if="rows.length" class="prog">
          <span data-test="memo-progress" v-text="`已完成 ${done.length} / ${rows.length}`"></span>
          <span class="bar"><i :style="{ width: `${progress}%` }"></i></span>
        </div>
        <div class="add">
          <span class="plus">＋</span>
          <input
            ref="input"
            v-model="newText"
            :maxlength="MEMO_TEXT_MAX"
            placeholder="新事项，回车添加"
            data-test="memo-input"
            @keydown.enter.prevent="add"
          />
        </div>

        <div v-if="todo.length" data-test="memo-todo">
          <div class="grp-h">
            待办 <span class="n" data-test="memo-todo-count" v-text="todo.length"></span>
          </div>
          <ul class="items">
            <li
              v-for="item in todo"
              :key="item.id"
              class="it"
              :class="{ dragging: draggingId === item.id }"
              data-test="memo-item"
            >
              <span
                class="grip"
                draggable="true"
                title="拖到终端，插入到光标处"
                data-test="memo-grip"
                @dragstart="onDragStart(item, $event)"
                @dragend="draggingId = null"
                >⠿</span
              >
              <input
                type="checkbox"
                class="ck"
                :checked="item.done"
                data-test="memo-done"
                @change="toggle(item, $event)"
              />
              <input
                v-if="editingId === item.id"
                ref="editInput"
                v-model="editText"
                class="ed"
                :maxlength="MEMO_TEXT_MAX"
                data-test="memo-edit"
                @keydown.enter.prevent="commitEdit(item)"
                @keydown.esc="cancelEdit"
                @blur="commitEdit(item)"
              />
              <span
                v-else
                class="tx editable"
                title="点击修改"
                data-test="memo-text"
                @click="startEdit(item)"
                v-text="item.text"
              ></span>
              <em
                v-if="carriedFromLabel(item, now)"
                class="carried"
                data-test="memo-carried"
                v-text="`自 ${carriedFromLabel(item, now)}`"
              ></em>
              <button class="del" title="删除" data-test="memo-remove" @click="remove(item)">
                ×
              </button>
            </li>
          </ul>
        </div>

        <template v-if="done.length">
          <button
            class="grp-h fold"
            :class="{ closed: isDoneCollapsed }"
            data-test="memo-done-toggle"
            @click="toggleDone"
          >
            <span class="chev">▾</span>已完成
            <span class="n" data-test="memo-done-count" v-text="done.length"></span>
          </button>
          <ul v-if="!isDoneCollapsed" class="items" data-test="memo-done-list">
            <li
              v-for="item in done"
              :key="item.id"
              class="it done"
              :class="{ dragging: draggingId === item.id }"
              data-test="memo-item"
            >
              <span
                class="grip"
                draggable="true"
                title="拖到终端，插入到光标处"
                data-test="memo-grip"
                @dragstart="onDragStart(item, $event)"
                @dragend="draggingId = null"
                >⠿</span
              >
              <input
                type="checkbox"
                class="ck"
                :checked="item.done"
                data-test="memo-done"
                @change="toggle(item, $event)"
              />
              <input
                v-if="editingId === item.id"
                ref="editInput"
                v-model="editText"
                class="ed"
                :maxlength="MEMO_TEXT_MAX"
                data-test="memo-edit"
                @keydown.enter.prevent="commitEdit(item)"
                @keydown.esc="cancelEdit"
                @blur="commitEdit(item)"
              />
              <span
                v-else
                class="tx editable"
                title="点击修改"
                data-test="memo-text"
                @click="startEdit(item)"
                v-text="item.text"
              ></span>
              <button class="del" title="删除" data-test="memo-remove" @click="remove(item)">
                ×
              </button>
            </li>
          </ul>
        </template>

        <div v-if="!rows.length" class="empty" data-test="memo-empty">
          <div class="big">📋</div>
          <b>本周还没有事项</b>在上面输入，回车添加
        </div>
      </template>

      <template v-else>
        <template v-if="rows.length">
          <div class="grp-h">已完成 <span class="n" v-text="rows.length"></span></div>
          <ul class="items">
            <li
              v-for="item in rows"
              :key="item.id"
              class="it done ro"
              :class="{ dragging: draggingId === item.id }"
              data-test="memo-item"
            >
              <span
                class="grip"
                draggable="true"
                title="拖到终端，插入到光标处"
                data-test="memo-grip"
                @dragstart="onDragStart(item, $event)"
                @dragend="draggingId = null"
                >⠿</span
              >
              <input
                type="checkbox"
                class="ck"
                :checked="item.done"
                disabled
                data-test="memo-done"
              />
              <span
                class="tx"
                data-test="memo-text"
                @click="startEdit(item)"
                v-text="item.text"
              ></span>
            </li>
          </ul>
        </template>
        <div v-else class="empty" data-test="memo-empty">这一周没有完成的事项</div>
      </template>
    </div>

    <div class="mw-foot" data-test="memo-hint">
      <span class="g">⠿</span>拖动 ⠿ 到终端，可把事项插入光标处
    </div>
  </div>
</template>

<style scoped>
/* 本功能内的派生色（页面稿 :root 的局部变量，不进全局主题） */
.mw {
  --row-hover: #f2f4f7;
  --soft-line: #e7eaee;
  --carried-bg: #fdf3dc;
  --carried-fg: #8a5a00;
  --err-bg: #fdecec;
  --err-fg: #b42318;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--panel2);
  color: var(--text);
  font: 14px/1.45 var(--font);
}
.mw-title {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--soft-line);
  user-select: none;
  /* 无边框窗口：标题栏空白处按住拖动窗口；上面的按钮必须 no-drag 才点得到 */
  -webkit-app-region: drag;
}
.mw-title button {
  -webkit-app-region: no-drag;
}
.mw-title .ico {
  width: 16px;
  height: 16px;
  color: var(--accent);
  flex: none;
}
.mw-title .name {
  font-size: 13px;
  font-weight: 600;
  margin-right: auto;
}
.wk {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
}
.wk-label b {
  font-weight: 600;
  color: var(--text);
  margin-right: 4px;
}
.nav {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  font-size: 16px;
  line-height: 22px;
  color: var(--muted);
}
.nav:hover:not(:disabled) {
  background: #e6e9ee;
  color: var(--text);
}
.nav:disabled {
  opacity: 0.35;
  cursor: default;
}
.close {
  width: 30px;
  height: 28px;
  margin-left: 4px;
  border-radius: 5px;
  font-size: 17px;
  line-height: 1;
  color: var(--muted);
}
.close:hover {
  background: #e81123;
  color: #fff;
}
.mw-err {
  flex: none;
  margin: 0;
  padding: 7px 14px;
  font-size: 12px;
  background: var(--err-bg);
  color: var(--err-fg);
  border-bottom: 1px solid #f6d3d0;
}
.mw-ro {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #f1f3f6;
  border-bottom: 1px solid var(--soft-line);
  font-size: 12px;
  color: var(--muted);
}
.mw-ro .pill {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 8px;
  background: #fff;
  color: var(--text);
}
.mw-ro .back {
  margin-left: auto;
  color: var(--accent);
  font-weight: 600;
}
.mw-ro .back:hover {
  text-decoration: underline;
}
.mw-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 12px 8px;
}
.prog {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 2px 10px;
  font-size: 12px;
  color: var(--muted);
}
.prog .bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: #e6e9ee;
  overflow: hidden;
}
.prog .bar i {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.2s;
}
.add {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 10px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.add:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.add .plus {
  color: var(--accent);
  font-size: 18px;
  line-height: 1;
  flex: none;
}
.add input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 13.5px;
}
.add input::placeholder {
  color: var(--st-idle);
}
.grp-h {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
}
.grp-h .n {
  font-weight: 400;
  background: #eef0f3;
  border-radius: 999px;
  padding: 0 6px;
}
.grp-h.fold {
  cursor: pointer;
}
.grp-h .chev {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.12s;
}
.grp-h.closed .chev {
  transform: rotate(-90deg);
}
.items {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}
.it {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px 7px 22px;
  border-radius: 8px;
  font-size: 13.5px;
}
.it:hover {
  background: var(--row-hover);
}
.grip {
  position: absolute;
  left: 4px;
  top: 7px;
  width: 14px;
  height: 20px;
  display: grid;
  place-items: center;
  color: #a3abb6;
  cursor: grab;
  font-size: 13px;
  letter-spacing: -1px;
  opacity: 0;
}
.it:hover .grip,
.it.dragging .grip {
  opacity: 1;
}
.grip:hover {
  color: var(--text);
}
.ck {
  appearance: none;
  flex: none;
  width: 17px;
  height: 17px;
  margin: 1.5px 0 0;
  border-radius: 50%;
  border: 1.5px solid #b4bcc6;
  background: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ck:hover:not(:disabled) {
  border-color: var(--accent);
}
.ck:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.ck:checked::after {
  content: '';
  width: 8px;
  height: 4px;
  border: 2px solid #fff;
  border-top: 0;
  border-right: 0;
  transform: translateY(-1px) rotate(-45deg);
}
.ck:disabled {
  cursor: default;
  opacity: 0.7;
}
.tx {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tx.editable {
  cursor: text;
}
.it.done .tx {
  color: var(--muted);
  text-decoration: line-through;
  text-decoration-color: #b4bcc6;
}
.carried {
  flex: none;
  margin-top: 1px;
  font-style: normal;
  font-size: 11px;
  line-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--carried-bg);
  color: var(--carried-fg);
  white-space: nowrap;
}
.del {
  flex: none;
  width: 22px;
  height: 22px;
  margin: -1px -2px 0 0;
  border-radius: 5px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1;
  opacity: 0;
}
.it:hover .del {
  opacity: 0.7;
}
.del:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.07);
  color: var(--text);
}
.ed {
  flex: 1;
  min-width: 0;
  margin: -3px 0;
  padding: 2px 6px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  outline: 0;
  font-size: 13.5px;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.it.dragging {
  opacity: 0.45;
  background: var(--accent-soft);
}
.empty {
  text-align: center;
  padding: 40px 12px 20px;
  color: var(--muted);
  font-size: 13px;
}
.empty .big {
  font-size: 30px;
  line-height: 1;
  margin-bottom: 10px;
  opacity: 0.55;
}
.empty b {
  display: block;
  color: var(--text);
  font-weight: 600;
  margin-bottom: 4px;
}
.mw-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-top: 1px solid var(--soft-line);
  font-size: 11.5px;
  color: var(--muted);
  background: #fbfbfc;
}
.mw-foot .g {
  font-size: 12px;
  letter-spacing: -1px;
  color: #a3abb6;
}
</style>

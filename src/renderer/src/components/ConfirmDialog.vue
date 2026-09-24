<script setup lang="ts">
// 应用内确认弹窗（取代 window.confirm，原因见 stores/confirm）：App 挂载一次，confirm.request 非空即显示。
// 打开时记下原来的焦点、焦点落在「确定」（Enter 即确认）；关掉后焦点还回去（原元素还在页面上时）。
// Esc / 点遮罩 / 「取消」为否。键盘在 window 捕获阶段处理并截停：压在别的弹窗上时 Esc 只关这一层
// （管理标签、设置等弹窗在 document 上监听 Esc）；Tab 只在两个按钮之间切换，焦点不跑到底下的页面。
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useConfirmStore } from '../stores/confirm'

const confirm = useConfirmStore()
const okBtn = ref<HTMLButtonElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

watch(
  () => confirm.request,
  async (request, previous) => {
    if (!request || previous) return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    okBtn.value?.focus()
  },
)

function close(ok: boolean): void {
  const back = returnFocus
  returnFocus = null
  confirm.answer(ok)
  if (back?.isConnected) back.focus()
}

function onKeydown(e: KeyboardEvent): void {
  if (!confirm.request) return
  if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== 'Tab') return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') close(false)
  else if (e.key === 'Enter') close(document.activeElement !== cancelBtn.value)
  else (document.activeElement === okBtn.value ? cancelBtn.value : okBtn.value)?.focus()
}

function onBackdropMousedown(e: MouseEvent): void {
  if (e.target === e.currentTarget) close(false)
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div
    v-if="confirm.request"
    class="backdrop"
    data-test="confirm-dialog"
    @mousedown="onBackdropMousedown"
  >
    <div class="modal" role="alertdialog" aria-modal="true" aria-describedby="confirm-message">
      <p id="confirm-message" class="message" data-test="confirm-message">
        {{ confirm.request.message }}
      </p>
      <div class="actions">
        <button
          ref="cancelBtn"
          class="btn"
          data-test="confirm-cancel"
          @click="close(false)"
          v-text="'取消'"
        ></button>
        <button
          ref="okBtn"
          class="btn"
          :class="confirm.request.danger ? 'danger' : 'primary'"
          data-test="confirm-ok"
          @click="close(true)"
          v-text="'确定'"
        ></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 压在所有弹窗（z-index 20）与弹出层之上 */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}
.modal {
  width: 380px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  padding: 18px 20px;
}
.message {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-line; /* 多行问句（导入配置前的说明）按换行显示 */
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>

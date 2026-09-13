<script setup lang="ts">
// 新建会话弹窗：名称 / 目录（可手输或「浏览…」）/ Shell / 标签 chips（打开时预选当前筛选选中的标签）+
// 「新标签名，回车添加」（立即创建标签并选中，取消新建会话该标签也保留）；目录必填，名称缺省由主进程取目录末段；
// 提交时把选中标签作为 tagIds 发送，attach 失败错误内联显示、弹窗保持打开（会话已创建）
import { onMounted, ref } from 'vue'
import type { Session } from '@shared/models'
import { DEFAULT_SHELL } from '@shared/models'
import { useShells } from '../composables/useShells'
import { useFilterStore } from '../stores/filter'
import { useSessionsStore } from '../stores/sessions'
import { useTagsStore } from '../stores/tags'

const emit = defineEmits<{ close: []; created: [session: Session] }>()
const sessions = useSessionsStore()
const tags = useTagsStore()
const filter = useFilterStore()

const name = ref('')
const cwd = ref('')
const error = ref('')
const { shell, shells } = useShells(DEFAULT_SHELL, (message) => (error.value = message))
const pathPlaceholder = ref('D:\\Projects\\...')
const nameInput = ref<HTMLInputElement | null>(null)
const pathInput = ref<HTMLInputElement | null>(null)
const selectedTags = ref<Set<string>>(new Set(filter.selected))
const newTag = ref('')

onMounted(() => nameInput.value?.focus())

function toggleTag(id: string): void {
  const next = new Set(selectedTags.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedTags.value = next
}

/** 回车即创建标签（同名返回已有）并选中；此输入框内的 Enter 不触发创建会话（stop） */
async function addTag(): Promise<void> {
  if (!newTag.value.trim()) return
  error.value = ''
  try {
    const tag = await tags.create(newTag.value)
    selectedTags.value = new Set([...selectedTags.value, tag.id])
    newTag.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

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
    const tagIds = [...selectedTags.value]
    const session = await sessions.create({
      cwd: dir,
      name: name.value.trim() || undefined,
      shell: shell.value,
      tagIds: tagIds.length ? tagIds : undefined,
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
      <div class="field">
        <label>标签（可多选）</label>
        <div class="chips">
          <template v-if="tags.sortedTags.length">
            <button
              v-for="t in tags.sortedTags"
              :key="t.id"
              type="button"
              class="chip"
              :class="{ on: selectedTags.has(t.id) }"
              :style="{ '--c': t.color }"
              data-test="ns-chip"
              @click="toggleTag(t.id)"
            >
              <i></i>{{ t.name }}
            </button>
          </template>
          <span v-else class="hint" data-test="ns-tags-hint">还没有标签</span>
        </div>
        <input
          v-model="newTag"
          class="new-tag"
          placeholder="新标签名，回车添加"
          data-test="ns-new-tag"
          @keydown.enter.stop.prevent="addTag"
        />
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
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.new-tag {
  margin-top: 8px;
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

<script setup lang="ts">
// 给当前会话加减标签的弹出层（由 PathStrip 绝对定位在「+ 标签」按钮下方）：列出全部标签，已加的显示 ✓，
// 点击切换 attach / detach 且保持打开；底部输入「新标签名，回车创建并加上」（create 后 attach）；
// Esc 关闭（emit close）；点击外部关闭由 PathStrip 的 document mousedown 处理（与「更多 ▾」同一模式）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useTagsStore } from '../stores/tags'

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ close: [] }>()
const tags = useTagsStore()
const input = ref<HTMLInputElement | null>(null)
const newName = ref('')
const error = ref('')

const attached = computed(() => new Set(tags.tagsOf(props.sessionId).map((t) => t.id)))

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function toggle(tagId: string): Promise<void> {
  return run(() =>
    attached.value.has(tagId)
      ? tags.detach(props.sessionId, tagId)
      : tags.attach(props.sessionId, tagId),
  )
}

/** 同名返回已有标签（主进程幂等），再 attach；空名不创建 */
function createAndAttach(): Promise<void> {
  const name = newName.value
  if (!name.trim()) return Promise.resolve()
  return run(async () => {
    const tag = await tags.create(name)
    await tags.attach(props.sessionId, tag.id)
    newName.value = ''
  })
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
  input.value?.focus()
})
onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown))
</script>

<template>
  <div class="pop" data-test="tag-pop">
    <button
      v-for="t in tags.sortedTags"
      :key="t.id"
      class="opt"
      :style="{ '--c': t.color }"
      data-test="tag-pop-opt"
      @click="toggle(t.id)"
    >
      <i></i>{{ t.name
      }}<span v-if="attached.has(t.id)" class="ck" data-test="tag-pop-check">✓</span>
    </button>
    <input
      ref="input"
      v-model="newName"
      placeholder="新标签名，回车创建并加上"
      data-test="tag-pop-new"
      @keydown.enter.prevent="createAndAttach"
    />
    <div v-if="error" class="err" data-test="tag-pop-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 15;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  padding: 6px;
  width: 230px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 5px;
  text-align: left;
  font-size: 13px;
}
.opt:hover {
  background: #f0f2f5;
}
.opt i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c);
}
.opt .ck {
  margin-left: auto;
  color: var(--accent);
  font-weight: 600;
}
.pop input {
  width: 100%;
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
}
.err {
  margin-top: 6px;
  font-size: 12px;
  color: #b42318;
}
</style>

<script setup lang="ts">
// 会话右键菜单：fixed 定位在鼠标位置（挂载后按实际尺寸与视口用 placeMenu 翻转），项「编辑会话」「重启终端」「移除会话」；
// 终端还没打开时「重启终端」置灰（项数与位置固定，不隐藏）；
// Esc 在 document 上监听并 emit close；点外部关闭由 SessionGroups 的 usePopover 处理（与「更多 ▾」同一模式）
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { placeMenu } from '../composables/menuPosition'

const props = defineProps<{ x: number; y: number; canRestart: boolean }>()
const emit = defineEmits<{ edit: []; restart: []; remove: []; close: [] }>()
const el = ref<HTMLElement | null>(null)
const style = ref({ left: `${props.x}px`, top: `${props.y}px` })

function reposition(): void {
  const rect = el.value?.getBoundingClientRect()
  const pos = placeMenu({
    x: props.x,
    y: props.y,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })
  style.value = { left: `${pos.left}px`, top: `${pos.top}px` }
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

watch(() => [props.x, props.y], reposition)
onMounted(() => {
  reposition()
  document.addEventListener('keydown', onDocumentKeydown)
})
onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown))
</script>

<template>
  <div ref="el" class="menu" :style="style" data-test="session-menu">
    <button class="item" type="button" data-test="menu-edit" @click="emit('edit')">编辑会话</button>
    <button
      class="item"
      :class="{ off: !canRestart }"
      type="button"
      :aria-disabled="canRestart ? undefined : 'true'"
      :title="canRestart ? undefined : '终端还没打开'"
      data-test="menu-restart"
      @click="canRestart && emit('restart')"
    >
      重启终端
    </button>
    <button class="item danger" type="button" data-test="menu-remove" @click="emit('remove')">
      移除会话
    </button>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 15;
  min-width: 120px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 4px;
}
.item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12.5px;
  white-space: nowrap;
}
.item:hover {
  background: #f0f2f5;
}
.item.off {
  color: var(--muted);
  cursor: default;
}
.item.off:hover {
  background: none;
}
.item.danger {
  color: #b42318;
}
.item.danger:hover {
  background: #fcebea;
}
</style>

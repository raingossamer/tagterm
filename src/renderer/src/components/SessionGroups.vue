<script setup lang="ts">
// 会话列表：M1 为单组平铺（无分组头，按 sortOrder），M2 起按标签分组
import { computed } from 'vue'
import SessionRow from './SessionRow.vue'
import { useSessionsStore } from '../stores/sessions'
import { useWorkspaceStore } from '../stores/workspace'

const sessions = useSessionsStore()
const workspace = useWorkspaceStore()
const emit = defineEmits<{ select: [id: string] }>()

const ordered = computed(() => [...sessions.sessions].sort((a, b) => a.sortOrder - b.sortOrder))
</script>

<template>
  <div class="groups">
    <div v-if="ordered.length === 0" class="empty-side">
      没有匹配的会话。换个标签组合，或新建一个会话。
    </div>
    <div v-else class="group open">
      <div class="group-body">
        <SessionRow
          v-for="s in ordered"
          :key="s.id"
          :session="s"
          :active="s.id === workspace.activeId"
          @select="emit('select', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.groups {
  flex: 1;
  overflow: auto;
  padding: 6px 6px 8px;
}
.group {
  margin-bottom: 4px;
}
.group-body {
  display: none;
}
.group.open .group-body {
  display: block;
}
.empty-side {
  padding: 24px 12px;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}
</style>

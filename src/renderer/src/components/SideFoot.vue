<script setup lang="ts">
// 左栏底部：「新建会话」与「管理标签」
const emit = defineEmits<{ newSession: []; manageTags: [] }>()
</script>

<template>
  <div class="side-foot">
    <button class="btn primary" data-test="new-session" @click="emit('newSession')">
      新建会话
    </button>
    <button class="btn" data-test="manage-tags" @click="emit('manageTags')">管理标签</button>
  </div>
</template>

<style scoped>
.side-foot {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--line);
}
</style>

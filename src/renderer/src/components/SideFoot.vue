<script setup lang="ts">
// 左栏底部：「新建会话」「管理标签」与右侧齿轮（打开设置弹窗；托盘「设置」入口保留）
const emit = defineEmits<{ newSession: []; manageTags: []; settings: [] }>()
</script>

<template>
  <div class="side-foot">
    <button class="btn primary" data-test="new-session" @click="emit('newSession')">
      新建会话
    </button>
    <button class="btn" data-test="manage-tags" @click="emit('manageTags')">管理标签</button>
    <button
      class="btn gear"
      type="button"
      title="设置"
      data-test="open-settings"
      @click="emit('settings')"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="2.2" />
        <path
          d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.side-foot {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--line);
}
.gear {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  padding: 5px 8px;
}
.gear:hover {
  color: var(--text);
}
</style>

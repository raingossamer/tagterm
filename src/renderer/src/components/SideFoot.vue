<script setup lang="ts">
// 左栏底部：「新建会话」「管理标签」与右侧两个图标按钮 —— 本周备忘（tooltip 带当前键位）、齿轮（打开设置弹窗；托盘「设置」入口保留）
import { computed } from 'vue'
import { DEFAULT_MEMO_SHORTCUT } from '@shared/accelerator'
import { useSettingsStore } from '../stores/settings'

const emit = defineEmits<{ newSession: []; manageTags: []; memo: []; settings: [] }>()
const settings = useSettingsStore()

/** 键位随设置里的修改走（settings:changed 广播带着 memoShortcut）；关掉热键时只写名字 */
const memoTitle = computed(() => {
  const config = settings.settings.memoShortcut ?? {
    enabled: true,
    accelerator: DEFAULT_MEMO_SHORTCUT,
  }
  // 名字与键位之间是一个全角空格（与搜索框占位的写法一致）
  return config.enabled ? `本周备忘\u3000${config.accelerator}` : '本周备忘'
})
</script>

<template>
  <div class="side-foot">
    <button class="btn primary" data-test="new-session" @click="emit('newSession')">
      新建会话
    </button>
    <button class="btn" data-test="manage-tags" @click="emit('manageTags')">管理标签</button>
    <button
      class="btn icon memo"
      type="button"
      :title="memoTitle"
      data-test="open-memo"
      @click="emit('memo')"
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
        <rect x="3" y="2.5" width="10" height="11.5" rx="1.5" />
        <path d="M6 1.8h4v1.6H6zM5.5 7l1 1 2-2M5.5 11l1 1 2-2M10 7.5h1M10 11.5h1" />
      </svg>
    </button>
    <button
      class="btn icon"
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
.icon {
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  padding: 5px 8px;
}
.icon:hover {
  color: var(--text);
}
/* 两个图标按钮一起靠右：备忘在左、齿轮在右 */
.memo {
  margin-left: auto;
}
</style>

<script setup lang="ts">
// 状态栏：会话数、三项状态计数（取 agent store）、右侧应用版本（来自主进程）
import { onMounted, ref } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useSessionsStore } from '../stores/sessions'

const sessions = useSessionsStore()
const agent = useAgentStore()
const version = ref('')

onMounted(async () => {
  version.value = await window.tagterm.app.getVersion()
})
</script>

<template>
  <div class="status">
    <span data-test="status-sessions">{{ sessions.count }} 个会话</span>
    <span class="k" data-test="status-working">
      <span class="dot working"></span>{{ agent.countBy('working') }} 运行中
    </span>
    <span class="k" data-test="status-blocked">
      <span class="dot blocked" style="animation: none"></span>{{ agent.countBy('blocked') }} 等待你
    </span>
    <span class="k" data-test="status-done">
      <span class="dot done"></span>{{ agent.countBy('done') }} 已完成未查看
    </span>
    <span class="sp" data-test="status-version">TagTerm v{{ version }}</span>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  gap: 16px;
  padding: 4px 14px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel-bg);
  border-top: 1px solid var(--line);
  flex-wrap: wrap;
}
.status .sp {
  margin-left: auto;
}
.status .k {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>

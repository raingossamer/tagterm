<script setup lang="ts">
// 状态栏：会话数、三项状态计数（M3 填充，M1 为 0）、右侧应用版本（来自主进程）
import { onMounted, ref } from 'vue'

const version = ref('')

onMounted(async () => {
  version.value = await window.tagterm.app.getVersion()
})
</script>

<template>
  <div class="status">
    <span data-test="status-sessions">0 个会话</span>
    <span class="k"><span class="dot working"></span>0 运行中</span>
    <span class="k"><span class="dot blocked" style="animation: none"></span>0 等待你</span>
    <span class="k"><span class="dot done"></span>0 已完成未查看</span>
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
  background: var(--panel);
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

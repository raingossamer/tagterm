<script setup lang="ts">
// 左栏头部：品牌行（搜索框属 M2，M1 不渲染）
</script>

<template>
  <div class="side-head">
    <div class="brand"><b>TagTerm</b><span>会话即路径，标签可交叉</span></div>
  </div>
</template>

<style scoped>
.side-head {
  padding: 12px 12px 8px;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.brand b {
  font-size: 15px;
  font-weight: 600;
}
.brand span {
  color: var(--muted);
  font-size: 12px;
}
</style>

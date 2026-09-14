<script setup lang="ts">
// 空状态：没有活动会话时显示（文案与原型一字不差）
</script>

<template>
  <div class="empty">
    <div>
      <h2 data-test="empty-title">选一个会话开始</h2>
      <p>左侧每一行都是一个固定路径的 cmd，一个会话可以同时挂在多个标签下。</p>
      <p>
        点击行即打开，终端里输入 <kbd>claude</kbd>、<kbd>gemini</kbd> 或
        <kbd>codex</kbd> 唤起对应工具。
      </p>
    </div>
  </div>
</template>

<style scoped>
.empty {
  flex: 1;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 40px;
  background: var(--t-bg-soft);
  color: #9aa3ae;
}
.empty h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}
.empty p {
  margin: 0 0 4px;
  font-size: 13px;
}
.empty kbd {
  font-family: var(--mono);
  background: #1f2328;
  padding: 1px 6px;
  border-radius: 4px;
  color: #ccc;
}
</style>

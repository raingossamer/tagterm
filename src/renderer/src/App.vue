<script setup lang="ts">
// 应用骨架：左栏（会话列表）+ 右栏（工作区 / 空状态 + 状态栏），布局照原型 .app 双栏 grid
import SideHead from './components/SideHead.vue'
import EmptyState from './components/EmptyState.vue'
import StatusBar from './components/StatusBar.vue'
</script>

<template>
  <div class="app">
    <aside class="side">
      <SideHead />
      <div class="groups"></div>
    </aside>
    <main class="main">
      <EmptyState />
      <StatusBar />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 296px 1fr;
  height: 100vh;
  transition: grid-template-columns 0.15s;
}
.app.side-hidden {
  grid-template-columns: 0 1fr;
}
.app.side-hidden .side {
  overflow: hidden;
  border: 0;
}
.side {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--line);
  min-width: 0;
}
.groups {
  flex: 1;
  overflow: auto;
  padding: 6px 6px 8px;
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg);
}
</style>

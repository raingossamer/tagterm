/**
 * 工作区 UI 状态 + TerminalWorkspace 的薄适配器（只在渲染进程）：
 * 标签页 / 当前页 / 每会话运行态来自核心的不可变快照（shallowRef 整体替换），写操作一律委托核心，
 * 组件不能直接改 activeId / openTabs；sideHidden / hoveredId 是纯 UI 状态，不进核心。
 * 会话镜像（sessions store）每次变化都喂给核心 syncSessions —— 移除会话只走主进程广播这一条路。
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { Unsubscribe } from '@shared/api'
import type { PtyPhase, TerminalWorkspace, WorkspaceSnapshot } from '../terminal/TerminalWorkspace'
import { useSessionsStore } from './sessions'

const EMPTY_SNAPSHOT: WorkspaceSnapshot = { openTabs: [], activeId: null, runtime: {} }

export const useWorkspaceStore = defineStore('workspace', () => {
  const sessions = useSessionsStore()
  const snap = shallowRef<WorkspaceSnapshot>(EMPTY_SNAPSHOT)
  let core: TerminalWorkspace | null = null
  const sideHidden = ref(false)
  /** 鼠标悬停的会话：同一会话在各分组的副本一起高亮 */
  const hoveredId = ref<string | null>(null)

  const openTabs = computed(() => snap.value.openTabs)
  const activeId = computed(() => snap.value.activeId)
  const hasActive = computed(() => snap.value.activeId !== null)
  const runtime = computed(() => snap.value.runtime)
  const isOpen = (id: string): boolean => snap.value.openTabs.includes(id)
  /** 没有实例（从未打开或已移除）视为 closed */
  const phaseOf = (id: string): PtyPhase | 'closed' => snap.value.runtime[id]?.phase ?? 'closed'

  /** 装配根调用一次：喂入当前会话列表、镜像快照、订阅变化、watch 会话镜像；返回拆除函数 */
  function attachCore(next: TerminalWorkspace): Unsubscribe {
    core = next
    next.syncSessions(sessions.sessions)
    snap.value = next.snapshot()
    const unsubscribe = next.subscribe((s) => {
      snap.value = s
    })
    const stop = watch(
      () => sessions.sessions,
      (list) => next.syncSessions(list),
    )
    return () => {
      unsubscribe()
      stop()
      if (core === next) core = null
    }
  }

  const select = (id: string): Promise<void> => core?.select(id) ?? Promise.resolve()

  function closeTab(id: string): void {
    core?.closeTab(id)
  }

  function toggleSide(): void {
    sideHidden.value = !sideHidden.value
  }

  function setHovered(id: string | null): void {
    hoveredId.value = id
  }

  return {
    openTabs,
    activeId,
    hasActive,
    runtime,
    sideHidden,
    hoveredId,
    isOpen,
    phaseOf,
    attachCore,
    select,
    closeTab,
    toggleSide,
    setHovered,
  }
})

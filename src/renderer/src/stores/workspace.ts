/**
 * 工作区 UI 状态 + TerminalWorkspace 的薄适配器（只在渲染进程）：
 * 标签页 / 当前页 / 每会话运行态来自核心的不可变快照（shallowRef 整体替换），写操作一律委托核心，
 * 组件不能直接改 activeId / openTabs；sideHidden / hoveredId 是纯 UI 状态，不进核心。
 * 会话镜像（sessions store）每次变化都喂给核心 syncSessions —— 移除会话只走主进程广播这一条路。
 * 标签页与当前页在每次快照变化时写入 localStorage 键 tagterm.openTabs（读写包 try / catch，坏数据视为空），
 * 启动时由 App 在会话列表到位后调 restore() 恢复：只填标签页，再 select 上次的当前页 —— 只有它会 spawn。
 * 终端字号（全部终端共用）同样是本机偏好：键 tagterm.terminalFontSize，attachCore 时读回交给核心，变了才写回。
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { Unsubscribe } from '@shared/api'
import type { PtyPhase, TerminalWorkspace, WorkspaceSnapshot } from '../terminal/TerminalWorkspace'
import { DEFAULT_FONT_SIZE, parseFontSize } from '../terminal/fontSize'
import { useSessionsStore } from './sessions'

const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  openTabs: [],
  activeId: null,
  runtime: {},
  fontSize: DEFAULT_FONT_SIZE,
}

export const OPEN_TABS_STORAGE_KEY = 'tagterm.openTabs'
export const FONT_SIZE_STORAGE_KEY = 'tagterm.terminalFontSize'

/** 上次退出时的标签页与当前页 */
interface StoredTabs {
  ids: string[]
  activeId: string | null
}

const EMPTY_STORED: StoredTabs = { ids: [], activeId: null }

function readOpenTabs(): StoredTabs {
  try {
    const raw = localStorage.getItem(OPEN_TABS_STORAGE_KEY)
    if (!raw) return EMPTY_STORED
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_STORED
    const { ids, activeId } = parsed as Record<string, unknown>
    if (!Array.isArray(ids)) return EMPTY_STORED
    return {
      ids: ids.filter((id): id is string => typeof id === 'string'),
      activeId: typeof activeId === 'string' ? activeId : null,
    }
  } catch {
    return EMPTY_STORED
  }
}

function writeOpenTabs(snapshot: WorkspaceSnapshot): void {
  try {
    const stored: StoredTabs = { ids: [...snapshot.openTabs], activeId: snapshot.activeId }
    localStorage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(stored))
  } catch (err) {
    console.warn('[workspace] 标签页写入 localStorage 失败', err)
  }
}

function readFontSize(): number {
  try {
    return parseFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

function writeFontSize(size: number): void {
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(size))
  } catch (err) {
    console.warn('[workspace] 终端字号写入 localStorage 失败', err)
  }
}

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
  const fontSize = computed(() => snap.value.fontSize)
  const isOpen = (id: string): boolean => snap.value.openTabs.includes(id)
  /** 没有实例（从未打开或已移除）视为 closed */
  const phaseOf = (id: string): PtyPhase | 'closed' => snap.value.runtime[id]?.phase ?? 'closed'

  /** 上次退出时的标签页：store 创建时读一次，之后的快照写入不会覆盖它 */
  const stored = readOpenTabs()

  /** 装配根调用一次：喂入当前会话列表、镜像快照、订阅变化、watch 会话镜像；返回拆除函数 */
  function attachCore(next: TerminalWorkspace): Unsubscribe {
    core = next
    next.syncSessions(sessions.sessions)
    next.setFontSize(readFontSize())
    snap.value = next.snapshot()
    let storedFontSize = snap.value.fontSize
    const unsubscribe = next.subscribe((s) => {
      snap.value = s
      writeOpenTabs(s)
      if (s.fontSize !== storedFontSize) {
        storedFontSize = s.fontSize
        writeFontSize(s.fontSize)
      }
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

  /**
   * 恢复上次的标签页与当前页：必须在会话列表到位后调用（--hidden 自启同样走这里）。
   * 先把当前列表喂给核心（watch 是异步的，这里不能等它），核心 restoreTabs 丢掉已删除的会话、去重、不 spawn；
   * 再 select 上次的当前页（仍存在才选），只有这一个会 spawn
   */
  async function restore(): Promise<void> {
    if (!core) return
    core.syncSessions(sessions.sessions)
    core.restoreTabs(stored.ids)
    if (stored.activeId !== null && sessions.byId(stored.activeId))
      await core.select(stored.activeId)
  }

  function closeTab(id: string): void {
    core?.closeTab(id)
  }

  /** 重启该会话的终端并切过去（左栏右键「重启终端」）；未 attach 时无副作用 */
  async function restart(id: string): Promise<void> {
    await core?.restart(id)
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
    fontSize,
    sideHidden,
    hoveredId,
    isOpen,
    phaseOf,
    attachCore,
    select,
    restore,
    closeTab,
    restart,
    toggleSide,
    setHovered,
  }
})

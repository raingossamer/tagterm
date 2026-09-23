/**
 * 每会话运行时状态镜像（M3）：主进程 AgentDetector 是真相源，load() 取一次 agent:list 并订阅 agent:status 逐条替换；
 * alive 为 false 的记录（pty 退出 / 会话移除）直接删掉。无记录 = 空闲。
 * 「正被查看」由 composables/useViewedSession 在当前页 / 焦点 / 可见性变化时经 setViewed 上报。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { AGENT_LABELS, type AgentStatus, type SessionRuntime } from '@shared/models'
import type { Unsubscribe } from '@shared/api'

export const useAgentStore = defineStore('agent', () => {
  const runtime = ref<Record<string, SessionRuntime>>({})
  let unsubscribe: Unsubscribe | null = null

  function apply(next: SessionRuntime): void {
    const copy = { ...runtime.value }
    if (next.alive) copy[next.sessionId] = next
    else delete copy[next.sessionId]
    runtime.value = copy
  }

  async function load(): Promise<void> {
    unsubscribe?.()
    unsubscribe = window.tagterm.agent.onStatus(apply)
    const list = await window.tagterm.agent.list()
    runtime.value = Object.fromEntries(list.filter((r) => r.alive).map((r) => [r.sessionId, r]))
  }

  const runtimeOf = (id: string): SessionRuntime | undefined => runtime.value[id]
  /**
   * 终端里正在跑的程序怎么称呼：认出的工具用正式名称，认不出的用进程名；回到提示符（没有程序在跑）为 null。
   * 唤起区置灰与「重启终端」的确认都看它（进程树每 2 s 一轮，最多慢这么久）
   */
  const runningNameOf = (id: string): string | null => {
    const r = runtime.value[id]
    if (!r) return null
    return r.agent ? AGENT_LABELS[r.agent] : (r.program ?? null)
  }
  const statusOf = (id: string): AgentStatus => runtime.value[id]?.status ?? 'idle'
  const countBy = (status: AgentStatus): number =>
    Object.values(runtime.value).filter((r) => r.status === status).length
  const blockedCount = computed(() => countBy('blocked'))

  const setViewed = (id: string | null): Promise<void> => window.tagterm.agent.setViewed(id)

  return { runtime, load, runtimeOf, runningNameOf, statusOf, countBy, blockedCount, setViewed }
})

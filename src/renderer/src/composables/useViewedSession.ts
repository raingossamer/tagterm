/**
 * 「正被查看」的会话上报：窗口可见且聚焦时是当前页，否则 null。
 * 三类触发点各上报一次：当前页变化（watch workspace.activeId）、窗口 focus / blur、document 可见性变化（隐藏到托盘 / 显示）。
 * 挂载时先上报一次让主进程拿到初值；卸载时移除监听。主进程据此决定 Stop 后是 idle 还是 done、done 何时回 idle、要不要弹通知。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useWorkspaceStore } from '../stores/workspace'

export function useViewedSession(): void {
  const workspace = useWorkspaceStore()
  const agent = useAgentStore()
  let isFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true

  function report(): void {
    const isVisible = !document.hidden && isFocused
    void agent.setViewed(isVisible ? workspace.activeId : null)
  }
  const onFocus = (): void => {
    isFocused = true
    report()
  }
  const onBlur = (): void => {
    isFocused = false
    report()
  }

  watch(() => workspace.activeId, report)
  onMounted(() => {
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', report)
    report()
  })
  onUnmounted(() => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', report)
  })
}

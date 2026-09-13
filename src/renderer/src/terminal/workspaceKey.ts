import type { InjectionKey } from 'vue'
import type { TerminalWorkspace } from './TerminalWorkspace'

/** App 提供、TerminalPane / SideHead 注入的会话生命周期核心单例（全项目唯一的 provide / inject） */
export const TERMINAL_WORKSPACE_KEY: InjectionKey<TerminalWorkspace> = Symbol('terminal-workspace')

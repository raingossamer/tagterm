import type { InjectionKey } from 'vue'
import type { TerminalPool } from './TerminalPool'

/** App 提供、TerminalPane / PathStrip 注入的实例池单例 */
export const TERMINAL_POOL_KEY: InjectionKey<TerminalPool> = Symbol('terminal-pool')

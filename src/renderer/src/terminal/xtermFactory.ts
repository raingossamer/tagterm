/**
 * 真实 xterm 实例工厂：把 xterm + fit / unicode11 / search / webgl addon 封装成 TerminalInstance。
 * WebGL 只在 setWebgl(true) 时加载；上下文丢失即退回 DOM 渲染器，内容不丢。
 */
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { TerminalFactory, TerminalInstance, TerminalSize } from './TerminalInstance'

export function createXtermFactory(getOptions: () => ITerminalOptions): TerminalFactory {
  return (): TerminalInstance => {
    const term = new Terminal(getOptions())
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(new SearchAddon()) // M2 搜索时接线
    let webgl: WebglAddon | null = null

    const disposeWebgl = (): void => {
      webgl?.dispose()
      webgl = null
    }

    return {
      open: (host) => term.open(host),
      write: (data) => term.write(data),
      focus: () => term.focus(),
      fit: (): TerminalSize | null => {
        if (!fit.proposeDimensions()) return null
        fit.fit()
        return { cols: term.cols, rows: term.rows }
      },
      onData: (cb) => term.onData(cb),
      onResize: (cb) => term.onResize(cb),
      setWebgl: (enabled) => {
        if (enabled && !webgl) {
          try {
            const addon = new WebglAddon()
            addon.onContextLoss(() => {
              console.warn('[terminal] WebGL 上下文丢失，退回 DOM 渲染器')
              disposeWebgl()
            })
            term.loadAddon(addon)
            webgl = addon
          } catch (err) {
            console.warn('[terminal] WebGL 不可用，使用 DOM 渲染器', err)
            webgl = null
          }
        } else if (!enabled && webgl) {
          disposeWebgl()
        }
      },
      dispose: () => {
        disposeWebgl()
        term.dispose()
      },
    }
  }
}

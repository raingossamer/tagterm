/**
 * 真实 xterm 实例工厂：把 xterm + fit / unicode11 / search / webgl addon 封装成 TerminalInstance。
 * WebGL 只在 setWebgl(true) 时加载；上下文丢失即退回 DOM 渲染器，内容不丢。
 * 剪贴板：Ctrl+V 等粘贴键交给浏览器原生 paste 事件（xterm 自行处理），右键无选区时读剪贴板粘贴。
 * Ctrl+K：xterm 不处理、不写 pty，事件继续冒泡到 document，由 SideHead 的全局监听聚焦搜索框。
 */
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { TerminalFactory, TerminalInstance, TerminalSize } from './TerminalInstance'
import { clipboardActionForRightClick, terminalKeyAction } from './clipboardKeys'

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

    /**
     * 退回 DOM 渲染器后强制整屏重绘：xterm 换渲染器不会自动重画已有内容，
     * 上下文丢失（GPU 驱动重置、睡眠唤醒、上下文过多）时画面会停在丢失那一刻不动 ——
     * 键入其实照样送到 pty，但屏幕不更新，看起来就是终端卡死
     */
    const repaint = (): void => {
      try {
        term.refresh(0, term.rows - 1)
      } catch (err) {
        console.warn('[terminal] 重绘失败', err)
      }
    }

    const copySelection = (): void => {
      const text = term.getSelection()
      if (text) void navigator.clipboard.writeText(text)
      term.clearSelection()
    }
    const pasteFromClipboard = async (): Promise<void> => {
      const text = await navigator.clipboard.readText()
      if (text) term.paste(text)
    }

    // 返回 false 表示 xterm 不处理该键：粘贴键由此落到浏览器原生 paste 事件，xterm 的 paste 监听器接手；
    // 搜索键（Ctrl+K）同样返回 false 且不 preventDefault，让它冒泡到 document 的全局监听
    term.attachCustomKeyEventHandler((ev) => {
      const action = terminalKeyAction(ev, term.hasSelection())
      if (action === 'copy') {
        ev.preventDefault()
        copySelection()
        return false
      }
      return action === null
    })

    const onContextMenu = (e: MouseEvent): void => {
      // 程序开了鼠标追踪时右键让给它（xterm 已把它作为鼠标事件报上去），我们不 preventDefault、不粘贴
      const action = clipboardActionForRightClick(
        term.hasSelection(),
        term.modes.mouseTrackingMode !== 'none',
        e.shiftKey,
      )
      if (action === null) return
      e.preventDefault()
      if (action === 'copy') copySelection()
      else void pasteFromClipboard()
    }

    return {
      open: (host) => {
        term.open(host)
        host.addEventListener('contextmenu', onContextMenu)
      },
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
              repaint()
            })
            term.loadAddon(addon)
            webgl = addon
          } catch (err) {
            console.warn('[terminal] WebGL 不可用，使用 DOM 渲染器', err)
            webgl = null
          }
        } else if (!enabled && webgl) {
          disposeWebgl()
          repaint()
        }
      },
      dispose: () => {
        term.element?.parentElement?.removeEventListener('contextmenu', onContextMenu)
        disposeWebgl()
        term.dispose()
      },
    }
  }
}

/**
 * 真实 xterm 实例工厂：把 xterm + fit / unicode11 / search / webgl addon 封装成 TerminalInstance。
 * WebGL 只在 setWebgl(true) 时加载；上下文丢失即退回 DOM 渲染器，内容不丢。
 * 剪贴板：Ctrl+V 等粘贴键交给浏览器原生 paste 事件（xterm 自行处理），右键无选区时读剪贴板粘贴。
 * Ctrl+K：xterm 不处理、不写 pty，事件继续冒泡到 document，由 SideHead 的全局监听聚焦搜索框。
 * Ctrl+滚轮 / Ctrl+0：截下不滚回滚区、不写 pty，只经 onFontZoom 上报（字号全部终端共用一份，由上层决定）。
 */
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type {
  FontZoom,
  SearchResult,
  TerminalFactory,
  TerminalInstance,
  TerminalSize,
} from './TerminalInstance'
import { clipboardActionForRightClick, terminalKeyAction } from './clipboardKeys'
import { createWheelZoom } from './fontSize'
import { SEARCH_DECORATIONS, SEARCH_HIGHLIGHT_LIMIT } from './theme'

export function createXtermFactory(getOptions: () => ITerminalOptions): TerminalFactory {
  return (): TerminalInstance => {
    const term = new Terminal(getOptions())
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    // 终端内查找（Ctrl+Shift+F）：不区分大小写的普通文本，带高亮才会有结果计数事件
    const search = new SearchAddon({ highlightLimit: SEARCH_HIGHLIGHT_LIMIT })
    term.loadAddon(search)
    const searchOptions = {
      caseSensitive: false,
      regex: false,
      wholeWord: false,
      decorations: SEARCH_DECORATIONS,
    }
    let webgl: WebglAddon | null = null
    const zoomListeners = new Set<(zoom: FontZoom) => void>()
    const emitZoom = (zoom: FontZoom): void => {
      for (const listener of [...zoomListeners]) listener(zoom)
    }
    const wheelZoom = createWheelZoom()

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
      if (action === 'font-reset') {
        ev.preventDefault()
        emitZoom('reset')
        return false
      }
      return action === null
    })

    // Ctrl+滚轮调字号（触摸板双指捏合同为 Ctrl+滚轮）：不滚回滚区；增量攒够一格才上报一步
    term.attachCustomWheelEventHandler((ev) => {
      if (!ev.ctrlKey) return true
      ev.preventDefault()
      const steps = wheelZoom.push(ev.deltaY, ev.deltaMode)
      if (steps !== 0) emitZoom(steps)
      return false
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
      onFontZoom: (cb) => {
        zoomListeners.add(cb)
        return { dispose: () => zoomListeners.delete(cb) }
      },
      setFontSize: (size) => {
        if (term.options.fontSize !== size) term.options.fontSize = size
      },
      findNext: (query, options) => {
        search.findNext(query, { ...searchOptions, incremental: options?.incremental ?? false })
      },
      findPrevious: (query) => {
        search.findPrevious(query, searchOptions)
      },
      clearSearch: () => {
        search.clearDecorations()
        term.clearSelection()
      },
      onSearchResults: (cb) =>
        search.onDidChangeResults((e) =>
          cb({ index: e.resultIndex, count: e.resultCount } satisfies SearchResult),
        ),
      // 活动缓冲区自底向上取非空行：普通模式含回滚区末尾，alt-screen（TUI）时就是当前画面底部
      readTail: (lines) => {
        const buffer = term.buffer.active
        const out: string[] = []
        for (let i = buffer.length - 1; i >= 0 && out.length < lines; i -= 1) {
          const text = buffer.getLine(i)?.translateToString(true).trimEnd() ?? ''
          if (text) out.push(text)
        }
        return out.reverse()
      },
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

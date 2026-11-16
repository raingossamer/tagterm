/**
 * 备忘小窗端口的假实现：记录建了几次窗口、每个窗口收到的调用与发出的事件；
 * 可见 / 焦点状态由 show / showInactive / focus / hide 维护，测试也可以直接改（模拟用户点了别的程序）。
 */
import type { MemoWindowHandle, MemoWindowPort } from '../../src/main/memo/MemoWindow'
import type { Rect } from '../../src/main/memo/memoWindowBounds'

export interface FakeMemoWindow extends MemoWindowHandle {
  visible: boolean
  focused: boolean
  bounds: Rect
  calls: string[]
  sent: { channel: string; args: unknown[] }[]
  /** 模拟用户拖动 / 拉伸结束 */
  moveTo(bounds: Rect): void
  /** 模拟 Alt+F4 / 系统的关闭请求 */
  requestClose(): void
}

export interface FakeMemoWindowPort extends MemoWindowPort {
  windows: FakeMemoWindow[]
  areas: Rect[]
  main: Rect
}

export function createFakeMemoWindowPort(
  areas: Rect[] = [{ x: 0, y: 0, width: 1920, height: 1040 }],
): FakeMemoWindowPort {
  const port: FakeMemoWindowPort = {
    windows: [],
    areas,
    main: areas[0]!,
    workAreas: () => port.areas,
    mainArea: () => port.main,
    create(bounds, events) {
      const win: FakeMemoWindow = {
        visible: false,
        focused: false,
        bounds: { ...bounds },
        calls: [],
        sent: [],
        isVisible: () => win.visible,
        isFocused: () => win.focused,
        show() {
          win.calls.push('show')
          win.visible = true
          win.focused = true
        },
        showInactive() {
          win.calls.push('showInactive')
          win.visible = true
        },
        focus() {
          win.calls.push('focus')
          win.focused = true
        },
        hide() {
          win.calls.push('hide')
          win.visible = false
          win.focused = false
        },
        getBounds: () => ({ ...win.bounds }),
        send(channel, ...args) {
          win.sent.push({ channel, args })
        },
        moveTo(next) {
          win.bounds = { ...next }
          events.onBoundsChanged()
        },
        requestClose: () => events.onCloseRequest(),
      }
      port.windows.push(win)
      return win
    },
  }
  return port
}

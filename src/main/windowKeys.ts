/**
 * 主窗口按键判定（纯函数，不 import electron）。
 * 应用不装菜单（去掉 Electron 默认菜单的 Ctrl+R 重载、Ctrl+= 整窗缩放、Alt 菜单栏等隐藏快捷键），
 * 开发模式另用 F12 开关开发者工具，安装版没有。
 */

/** 与 Electron `before-input-event` 的 Input 同形的最小子集 */
export interface WindowKeyInput {
  type: string
  key: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export function isDevToolsToggle(input: WindowKeyInput): boolean {
  return (
    input.type === 'keyDown' &&
    input.key === 'F12' &&
    !input.control &&
    !input.shift &&
    !input.alt &&
    !input.meta
  )
}

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 渲染进程不用原生 JS 对话框（window.confirm / alert / prompt），确认一律走应用内确认弹窗（stores/confirm）：
 * Electron 在 Windows 上原生对话框关掉后页面丢焦点（窗口与 webContents 都以为自己有焦点，document.hasFocus() 却为 false），
 * 之后点输入框没反应，要切走窗口再切回来才好（2026-09-24 管理标签里删完标签点不进输入框）
 */
const RENDERER_SRC = join(process.cwd(), 'src', 'renderer', 'src')
const NATIVE_DIALOG = /(?<![\w.$])(?:window\.)?(?:confirm|alert|prompt)\s*\(/

/** 去掉注释再查：注释里会提到这几个名字 */
function stripComments(code: string): string {
  return code
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function rendererSources(): string[] {
  return readdirSync(RENDERER_SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') || f.endsWith('.vue'))
    .map((f) => join(RENDERER_SRC, f))
}

describe('渲染进程不用原生 JS 对话框', () => {
  it('扫描自检：认得出调用、放过注释与 store 的 ask', () => {
    expect(NATIVE_DIALOG.test(stripComments("if (!window.confirm('删？')) return"))).toBe(true)
    expect(NATIVE_DIALOG.test(stripComments("alert('x')"))).toBe(true)
    expect(NATIVE_DIALOG.test(stripComments('// 取代 window.confirm(…)'))).toBe(false)
    expect(NATIVE_DIALOG.test(stripComments("await confirmDialog.ask('删？')"))).toBe(false)
    expect(rendererSources().length).toBeGreaterThan(20)
  })

  it('src/renderer 下没有 window.confirm / alert / prompt 调用', () => {
    const offenders = rendererSources().filter((file) =>
      NATIVE_DIALOG.test(stripComments(readFileSync(file, 'utf8'))),
    )
    expect(offenders).toEqual([])
  })
})

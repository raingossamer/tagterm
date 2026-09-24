import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 守住 @xterm/addon-webgl 的补丁（patches/@xterm__addon-webgl@0.19.0.patch，pnpm install 时应用）：
 * 上游 0.19.0 的 RectangleRenderer.updateBackgrounds 用 `bg !== 0` 判「非默认背景」，而 bg 字里还有 ITALIC / DIM /
 * OVERLINE / 扩展下划线四个标志位，这些格子被画了一块 alpha 强制为 1 的主题底色 —— 透明背景下暗淡字、斜体、下划线都垫黑。
 * 补丁只比较颜色位（CM_MASK | RGB_MASK = 0x3FFFFFF = 67108863）。包有两份产物：`module` 入口 lib/addon-webgl.mjs 是 Vite
 * 真正打进 out/renderer 的（第一版补丁只改了 UMD 的 .js，烟测像素核查照样黑），`main` 入口 lib/addon-webgl.js 是 UMD，两份都守。
 * 升级 addon 时 pnpm 会因版本键不匹配报错，这里再守一道：补丁不在就等于有背景图时暗淡字又垫黑
 */
const ROOT = process.cwd()
const LIB_DIR = join(ROOT, 'node_modules/@xterm/addon-webgl/lib')
/** 两份产物各自压缩后的变量名不同，条件的写法也不同 */
const CONDITIONS = [
  { file: 'addon-webgl.mjs', patched: '(u&67108863)!==0||d&&c!==0', upstream: 'u!==0||d&&c!==0' },
  { file: 'addon-webgl.js', patched: '0!==(67108863&a)||h&&0!==l', upstream: '0!==a||h&&0!==l' },
]

describe('xterm WebGL 渲染器补丁（暗淡字 / 斜体不垫黑底）', () => {
  it.each(CONDITIONS)(
    'node_modules 里的 $file 是补丁后的：两处「需要画背景矩形」的判定只比较颜色位',
    ({ file, patched, upstream }) => {
      const lib = readFileSync(join(LIB_DIR, file), 'utf8')
      expect(lib.split(patched).length - 1).toBe(2)
      expect(lib.includes(upstream)).toBe(false)
    },
  )

  it('补丁登记在 pnpm-workspace.yaml 的 patchedDependencies 里，补丁文件在仓库 patches/ 下且两份产物都改了', () => {
    const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toContain(
      "'@xterm/addon-webgl@0.19.0': patches/@xterm__addon-webgl@0.19.0.patch",
    )
    const patch = readFileSync(join(ROOT, 'patches/@xterm__addon-webgl@0.19.0.patch'), 'utf8')
    for (const { patched } of CONDITIONS) expect(patch).toContain(patched)
  })
})

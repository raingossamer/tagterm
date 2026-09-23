import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

/**
 * 安装包的依赖边界：electron-builder 把 package.json 的 dependencies 整个当运行时依赖打进包，
 * 而渲染进程的库早已被 Vite 打进 out/renderer —— 写进 dependencies 只会在包里多一份运行时从不加载的副本
 * （0.3.8 的 app.asar 27.5 MB 里有 23.7 MB 是这种副本）
 */
const ROOT = process.cwd()

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g

/** 说明符 → 第三方包名；相对路径、node 内置、@shared 别名、electron 本身（运行时自带）都不算 */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@shared/')) return null
  if (spec.startsWith('node:')) return null
  const parts = spec.split('/')
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  if (name === 'electron' || builtinModules.includes(name)) return null
  return name
}

/** 这些目录的源码在运行时会加载的第三方包（import type 不算） */
function runtimePackages(dirs: string[]): Set<string> {
  const names = new Set<string>()
  for (const dir of dirs) {
    const files = readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    for (const file of files.filter((f) => /\.(ts|vue)$/.test(f))) {
      const text = readFileSync(join(ROOT, dir, file), 'utf8')
      for (const m of text.matchAll(IMPORT_PATTERN)) {
        if (m[1]) continue // import type
        const name = packageOf(m[2] ?? m[3] ?? m[4])
        if (name) names.add(name)
      }
    }
  }
  return names
}

describe('安装包依赖边界', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const mainSide = runtimePackages(['src/main', 'src/preload', 'src/shared'])
  const rendererSide = runtimePackages(['src/renderer'])

  it('dependencies 恰好是主进程侧（main / preload / shared）运行时 import 的第三方包', () => {
    // 扫描本身要认得出来，否则下面的断言会空转
    expect(mainSide).toContain('node-pty')
    expect(rendererSide).toContain('@xterm/xterm')
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...mainSide].sort())
  })

  it('只有渲染进程用的库都在 devDependencies：由 Vite 打进 out/renderer，不进安装包的 node_modules', () => {
    const rendererOnly = [...rendererSide].filter((name) => !mainSide.has(name))
    expect(rendererOnly.filter((name) => !(name in pkg.devDependencies))).toEqual([])
  })
})

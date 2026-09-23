import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HookInstaller } from '../../src/main/agent/HookInstaller'
import { hasOurHooks } from '../../src/main/agent/hookSettings'

const PORT = 51233

describe('HookInstaller（改用户的 hooks 配置文件，真实临时目录）', () => {
  let dir: string
  let now: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tagterm-hooks-'))
    now = Date.parse('2026-09-17T10:20:30Z')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))
  const backupsOf = (name: string): string[] =>
    readdirSync(dir).filter((f) => f.startsWith(`${name}.tagterm-bak-`))

  function claude(): { installer: HookInstaller; file: string } {
    const file = join(dir, 'settings.json')
    return {
      file,
      installer: new HookInstaller(
        { agent: 'claude', settingsPath: file, createIfMissing: false },
        { now: () => now },
      ),
    }
  }
  function codex(): { installer: HookInstaller; file: string } {
    const file = join(dir, 'hooks.json')
    return {
      file,
      installer: new HookInstaller(
        { agent: 'codex', settingsPath: file, createIfMissing: true },
        { now: () => now },
      ),
    }
  }

  it('Claude：安装前备份（内容等于原文件、文件名带 tagterm）、只追加我们的六条、别人的原样；status 报告已安装与端口；重复安装幂等（不再备份）', async () => {
    const { installer, file } = claude()
    const original = {
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    }
    writeFileSync(file, JSON.stringify(original, null, 2))
    await expect(installer.status(PORT)).resolves.toEqual({
      installed: false,
      port: PORT,
      settingsPath: file,
    })

    const status = await installer.install(PORT)
    expect(status).toEqual({ installed: true, port: PORT, settingsPath: file })
    const backups = backupsOf('settings.json')
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/settings\.json\.tagterm-bak-\d{8}-\d{6}(-\d+)?$/)
    expect(readJson(join(dir, backups[0]!))).toEqual(original)
    const written = readJson(file) as { model: string; hooks: Record<string, unknown[]> }
    expect(written.model).toBe('opus')
    expect(written.hooks['Stop']).toHaveLength(2)
    expect(written.hooks['Stop']![0]).toEqual(original.hooks.Stop[0])
    expect(Object.keys(written.hooks).sort()).toEqual(
      [
        'Notification',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'StopFailure',
        'UserPromptSubmit',
      ].sort(),
    )
    expect(hasOurHooks(written)).toEqual({ installed: true, port: PORT })
    await expect(installer.status(PORT)).resolves.toEqual({
      installed: true,
      port: PORT,
      settingsPath: file,
    })

    const before = readFileSync(file, 'utf8')
    await installer.install(PORT)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(backupsOf('settings.json')).toHaveLength(1)
  })

  it('Claude：文件缺失 / 坏 JSON / 顶层不是对象 → reject 中文文案且目标文件未被改动、不生成备份；status 带 error', async () => {
    const { installer, file } = claude()
    await expect(installer.install(PORT)).rejects.toThrow('未找到 Claude Code 配置文件')
    expect(readdirSync(dir)).toEqual([])
    expect((await installer.status(PORT)).error).toContain('未找到')

    writeFileSync(file, '{ not json')
    await expect(installer.install(PORT)).rejects.toThrow('不是合法 JSON')
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
    expect(backupsOf('settings.json')).toHaveLength(0)
    expect((await installer.status(PORT)).error).toContain('不是合法 JSON')
    await expect(installer.uninstall(PORT)).rejects.toThrow('不是合法 JSON')

    writeFileSync(file, '[1, 2]')
    await expect(installer.install(PORT)).rejects.toThrow('顶层不是对象')
    expect(readFileSync(file, 'utf8')).toBe('[1, 2]')
  })

  it('Claude：卸载只删我们的，与安装前等价（hooks 空了则删键）；未安装时卸载不写文件；refresh 把已装命令换成本次端口', async () => {
    const { installer, file } = claude()
    const original = { model: 'opus', permissions: { allow: ['Bash'] } }
    writeFileSync(file, JSON.stringify(original))
    await installer.install(PORT)
    expect(readJson(file)).not.toEqual(original)

    const status = await installer.uninstall(PORT)
    expect(status).toEqual({ installed: false, port: PORT, settingsPath: file })
    expect(readJson(file)).toEqual(original)
    expect(backupsOf('settings.json')).toHaveLength(2)

    const untouched = readFileSync(file, 'utf8')
    await installer.uninstall(PORT)
    expect(readFileSync(file, 'utf8')).toBe(untouched)
    expect(backupsOf('settings.json')).toHaveLength(2)

    await installer.install(PORT)
    now += 1000
    await installer.refresh(60000)
    const moved = readJson(file) as { model: string }
    expect(hasOurHooks(moved)).toEqual({ installed: true, port: 60000 })
    expect(moved.model).toBe('opus')
    expect(JSON.stringify(moved)).not.toContain(String(PORT))
    await expect(installer.status(60000)).resolves.toEqual({
      installed: true,
      port: 60000,
      settingsPath: file,
    })
    // 端口一致、内容已是当前版本时不写
    const stable = readFileSync(file, 'utf8')
    await installer.refresh(60000)
    expect(readFileSync(file, 'utf8')).toBe(stable)
    // 未安装时 refresh 不写
    await installer.uninstall(PORT)
    const bare = readFileSync(file, 'utf8')
    await installer.refresh(1234)
    expect(readFileSync(file, 'utf8')).toBe(bare)
  })

  it('Claude：refresh 启动补装 —— 旧版本装的条目（缺事件、旧命令、废弃事件）按当前版本重建并先备份；再 refresh 不写不备份；别的程序只调了键顺序也不写', async () => {
    const { installer, file } = claude()
    const old = 'curl.exe -s -m 3 -X POST -T - http://127.0.0.1:40000/tagterm/hook/claude'
    writeFileSync(
      file,
      JSON.stringify({
        model: 'opus',
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'echo mine' }] },
            { hooks: [{ type: 'command', command: old }] },
          ],
          PreCompact: [{ hooks: [{ type: 'command', command: old }] }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: old }] }],
        },
      }),
    )

    await expect(installer.refresh(PORT)).resolves.toBe(true)
    expect(backupsOf('settings.json')).toHaveLength(1)
    const written = readJson(file) as {
      model: string
      hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>
    }
    expect(written.model).toBe('opus')
    expect(Object.keys(written.hooks).sort()).toEqual(
      [
        'Notification',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'StopFailure',
        'UserPromptSubmit',
      ].sort(),
    )
    expect(written.hooks['Stop']![0]).toEqual({
      hooks: [{ type: 'command', command: 'echo mine' }],
    })
    expect(JSON.stringify(written)).not.toContain('40000')
    expect(JSON.stringify(written)).toContain('--noproxy')
    expect(hasOurHooks(written)).toEqual({ installed: true, port: PORT })

    // 已是当前版本：不写、不备份
    now += 1000
    const current = readFileSync(file, 'utf8')
    await expect(installer.refresh(PORT)).resolves.toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(current)
    expect(backupsOf('settings.json')).toHaveLength(1)

    // 别的程序（如 Claude Code 自己保存设置）把事件键顺序倒过来写回：内容相同 → 仍不写、不备份
    const reordered = {
      hooks: Object.fromEntries(Object.entries(written.hooks).reverse()),
      model: written.model,
    }
    const reorderedText = JSON.stringify(reordered, null, 2)
    writeFileSync(file, reorderedText)
    now += 1000
    await expect(installer.refresh(PORT)).resolves.toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(reorderedText)
    expect(backupsOf('settings.json')).toHaveLength(1)
  })

  it('Claude：refresh 遇到文件缺失不新建、坏 JSON 时 reject 且不动文件；打开开关（install）同样清掉废弃事件里我们的条目', async () => {
    const { installer, file } = claude()
    await expect(installer.refresh(PORT)).resolves.toBe(false)
    expect(readdirSync(dir)).toEqual([])

    writeFileSync(file, '{ not json')
    await expect(installer.refresh(PORT)).rejects.toThrow('不是合法 JSON')
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
    expect(backupsOf('settings.json')).toHaveLength(0)

    const old = 'curl.exe -s -m 3 -X POST -T - http://127.0.0.1:40000/tagterm/hook/claude'
    writeFileSync(file, JSON.stringify({ hooks: { PreCompact: [{ hooks: [{ command: old }] }] } }))
    await installer.install(PORT)
    const written = readJson(file) as { hooks: Record<string, unknown> }
    expect(written.hooks['PreCompact']).toBeUndefined()
    expect(hasOurHooks(written)).toEqual({ installed: true, port: PORT })
  })

  it('Codex：文件不存在时新建（无备份）并写六条带 commandWindows 的条目；同目录 config.toml 内容与 mtime 不变；卸载后保留空 hooks 骨架', async () => {
    const { installer, file } = codex()
    const toml = join(dir, 'config.toml')
    writeFileSync(toml, 'notify = ["codex-computer-use.exe", "turn-ended"]\n')
    const tomlStat = statSync(toml)
    await expect(installer.status(PORT)).resolves.toEqual({
      installed: false,
      port: PORT,
      settingsPath: file,
    })

    const status = await installer.install(PORT)
    expect(status).toEqual({ installed: true, port: PORT, settingsPath: file })
    expect(backupsOf('hooks.json')).toHaveLength(0)
    const written = readJson(file) as {
      hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>
    }
    expect(Object.keys(written.hooks).sort()).toEqual(
      [
        'Interrupt',
        'PermissionRequest',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'UserPromptSubmit',
      ].sort(),
    )
    for (const entries of Object.values(written.hooks)) {
      expect(entries[0]!.hooks[0]!['commandWindows']).toBe(entries[0]!.hooks[0]!['command'])
    }
    expect(written.hooks['Interrupt']![0]!.hooks[0]!['timeout']).toBe(1)

    await installer.uninstall(PORT)
    expect(readJson(file)).toEqual({ hooks: {} })
    expect(backupsOf('hooks.json')).toHaveLength(1)
    expect(readFileSync(toml, 'utf8')).toBe('notify = ["codex-computer-use.exe", "turn-ended"]\n')
    expect(statSync(toml).mtimeMs).toBe(tomlStat.mtimeMs)
  })

  it('Codex：文件已存在时先备份再只追加，别人的条目原样', async () => {
    const { installer, file } = codex()
    const original = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'lint' }] }] } }
    writeFileSync(file, JSON.stringify(original))
    await installer.install(PORT)
    expect(backupsOf('hooks.json')).toHaveLength(1)
    const written = readJson(file) as { hooks: Record<string, unknown[]> }
    expect(written.hooks['PreToolUse']).toEqual(original.hooks.PreToolUse)
    expect(Object.keys(written.hooks)).toHaveLength(7)
    await installer.uninstall(PORT)
    expect(readJson(file)).toEqual(original)
  })
})

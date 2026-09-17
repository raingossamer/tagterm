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

  it('Claude：安装前备份（内容等于原文件、文件名带 tagterm）、只追加我们的五条、别人的原样；status 报告已安装与端口；重复安装幂等（不再备份）', async () => {
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
      ['Notification', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
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

  it('Claude：卸载只删我们的，与安装前等价（hooks 空了则删键）；未安装时卸载不写文件；syncPort 只改命令里的端口', async () => {
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
    await installer.syncPort(60000)
    const moved = readJson(file) as { model: string }
    expect(hasOurHooks(moved)).toEqual({ installed: true, port: 60000 })
    expect(moved.model).toBe('opus')
    expect(JSON.stringify(moved)).not.toContain(String(PORT))
    await expect(installer.status(60000)).resolves.toEqual({
      installed: true,
      port: 60000,
      settingsPath: file,
    })
    // 端口一致时不写
    const stable = readFileSync(file, 'utf8')
    await installer.syncPort(60000)
    expect(readFileSync(file, 'utf8')).toBe(stable)
    // 未安装时 syncPort 不写
    await installer.uninstall(PORT)
    const bare = readFileSync(file, 'utf8')
    await installer.syncPort(1234)
    expect(readFileSync(file, 'utf8')).toBe(bare)
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

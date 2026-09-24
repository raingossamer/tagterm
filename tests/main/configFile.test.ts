import { describe, expect, it } from 'vitest'
import {
  CONFIG_FILE_VERSION,
  CONFIG_FORMAT,
  composeConfigFile,
  parseConfigFile,
  type ConfigFileData,
} from '../../src/main/config/configFile'

const FULL: ConfigFileData = {
  tags: [
    { name: 'simba', color: '#2F6FDB' },
    { name: '归档', color: '#6B7280', hidden: true },
  ],
  launchCommands: [
    { label: 'claude', command: 'claude', pinned: true },
    { label: 'pi x', command: 'pi --model x', pinned: false },
  ],
  appearance: { fit: 'cover', imageOpacity: 0.5, panelOpacity: 0.8, blurPx: 6 },
  globalShortcut: { enabled: true, accelerator: 'Ctrl+Alt+Y' },
  autoLaunch: true,
  hooks: { claude: true, codex: false },
  terminalFontSize: 16,
}

describe('配置文件（导出 / 导入的 JSON）', () => {
  it('组装：带格式标记、版本、导出时间与应用版本，各项按给定内容写出，2 空格缩进、末尾换行；解析回来一致', () => {
    const text = composeConfigFile(FULL, {
      appVersion: '0.3.11',
      now: new Date('2026-09-24T08:00:00.000Z'),
    })
    const raw = JSON.parse(text)
    expect(raw).toMatchObject({
      format: CONFIG_FORMAT,
      version: CONFIG_FILE_VERSION,
      exportedAt: '2026-09-24T08:00:00.000Z',
      appVersion: '0.3.11',
    })
    expect(Object.keys(raw)).toEqual([
      'format',
      'version',
      'exportedAt',
      'appVersion',
      'tags',
      'launchCommands',
      'appearance',
      'globalShortcut',
      'autoLaunch',
      'hooks',
      'terminalFontSize',
    ])
    expect(text.startsWith('{\n  "format"')).toBe(true)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseConfigFile(text)).toEqual(FULL)
  })

  it('组装只写给了的项；解析时文件里没有的项就是没有（导入时不动本机），未知的顶层键忽略', () => {
    const text = composeConfigFile(
      { tags: [{ name: 'a', color: '#2F6FDB' }] },
      { appVersion: '0.3.11' },
    )
    const raw = JSON.parse(text)
    expect('launchCommands' in raw).toBe(false)
    expect(parseConfigFile(text)).toEqual({ tags: [{ name: 'a', color: '#2F6FDB' }] })

    const withExtra = JSON.stringify({
      format: CONFIG_FORMAT,
      version: 1,
      terminalFontSize: 12,
      somethingNew: { a: 1 },
    })
    expect(parseConfigFile(withExtra)).toEqual({ terminalFontSize: 12 })
  })

  it('不是 JSON / 不是对象 / 格式标记不对 →「不是 TagTerm 配置文件」；版本高于本程序支持的 → 提示升级', () => {
    for (const bad of [
      '{ not json',
      '[]',
      '"x"',
      JSON.stringify({ version: 1 }),
      JSON.stringify({ format: 'other', version: 1 }),
    ]) {
      expect(() => parseConfigFile(bad)).toThrow('不是 TagTerm 配置文件')
    }
    expect(() => parseConfigFile(JSON.stringify({ format: CONFIG_FORMAT, version: 2 }))).toThrow(
      '配置文件版本 2 高于本程序支持的版本 1，请升级 TagTerm',
    )
    expect(() => parseConfigFile(JSON.stringify({ format: CONFIG_FORMAT, version: 'v1' }))).toThrow(
      '不是 TagTerm 配置文件',
    )
  })

  it('整份校验：任一项不合法即整份拒绝并写明是哪一项', () => {
    const file = (data: Record<string, unknown>) =>
      JSON.stringify({ format: CONFIG_FORMAT, version: 1, ...data })
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ tags: {} }, '配置文件里的标签格式不正确'],
      [{ tags: [{ name: '  ', color: '#2F6FDB' }] }, '配置文件里的标签名不能为空'],
      [{ tags: [{ name: 'a', color: '#123456' }] }, '配置文件里的标签颜色不支持：#123456'],
      [
        {
          tags: [
            { name: 'a', color: '#2F6FDB' },
            { name: ' a ', color: '#2A9D5C' },
          ],
        },
        '配置文件里的标签重名：a',
      ],
      [{ tags: [{ name: 'a', color: '#2F6FDB', hidden: 'yes' }] }, '配置文件里的标签格式不正确'],
      [{ launchCommands: 'claude' }, '配置文件里的唤起命令格式不正确'],
      [
        { launchCommands: [{ label: 'x', command: ' ', pinned: true }] },
        '配置文件里的唤起命令不能为空',
      ],
      [
        { launchCommands: [{ label: 'x', command: 'x', pinned: 'yes' }] },
        '配置文件里的唤起命令格式不正确',
      ],
      [
        { appearance: { fit: 'zoom', imageOpacity: 0.5, panelOpacity: 0.8, blurPx: 6 } },
        '配置文件里的外观：不支持的显示方式：zoom',
      ],
      [
        { appearance: { fit: 'cover', imageOpacity: 1.5, panelOpacity: 0.8, blurPx: 6 } },
        '配置文件里的外观：背景不透明度必须在 0 到 1 之间',
      ],
      [
        { appearance: { fit: 'cover', imageOpacity: 0.5, panelOpacity: 0.2, blurPx: 6 } },
        '配置文件里的外观：面板不透明度必须在 0.4 到 1 之间',
      ],
      [
        { appearance: { fit: 'cover', imageOpacity: 0.5, panelOpacity: 0.8, blurPx: 6.5 } },
        '配置文件里的外观：背景模糊必须是 0 到 20 之间的整数',
      ],
      [{ globalShortcut: { enabled: true, accelerator: 'T' } }, '配置文件里的全局快捷键格式不正确'],
      [
        { globalShortcut: { enabled: 'yes', accelerator: 'Ctrl+Alt+T' } },
        '配置文件里的全局快捷键格式不正确',
      ],
      [{ autoLaunch: 1 }, '配置文件里的开机自启格式不正确'],
      [{ hooks: { claude: 'on' } }, '配置文件里的 hooks 开关格式不正确'],
      [{ hooks: [] }, '配置文件里的 hooks 开关格式不正确'],
      [{ terminalFontSize: 9 }, '配置文件里的终端字号必须是 10 到 32 之间的整数'],
      [{ terminalFontSize: 14.5 }, '配置文件里的终端字号必须是 10 到 32 之间的整数'],
    ]
    for (const [data, message] of cases) expect(() => parseConfigFile(file(data))).toThrow(message)
  })

  it('解析时标签名与命令 trim；显示名缺省 = 命令；hooks 只给一个也行；外观里的图片路径不认（不带）', () => {
    const text = JSON.stringify({
      format: CONFIG_FORMAT,
      version: 1,
      tags: [{ name: ' simba ', color: '#2F6FDB', hidden: false }],
      launchCommands: [{ command: ' claude ', pinned: true }],
      appearance: {
        fit: 'contain',
        imageOpacity: 0.35,
        panelOpacity: 0.75,
        blurPx: 4,
        imagePath: 'D:/bg.png',
      },
      hooks: { codex: true },
    })
    expect(parseConfigFile(text)).toEqual({
      tags: [{ name: 'simba', color: '#2F6FDB' }],
      launchCommands: [{ label: 'claude', command: 'claude', pinned: true }],
      appearance: { fit: 'contain', imageOpacity: 0.35, panelOpacity: 0.75, blurPx: 4 },
      hooks: { codex: true },
    })
  })
})

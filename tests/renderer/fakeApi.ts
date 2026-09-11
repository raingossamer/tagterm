import { vi } from 'vitest'
import type { TagTermApi } from '@shared/api'
import type { TagListResult } from '@shared/ipc'
import {
  TAG_COLORS,
  type LaunchCommand,
  type Session,
  type Settings,
  type ShellKind,
  type Tag,
  type UpdateStatus,
} from '@shared/models'

type Overrides = {
  [K in keyof TagTermApi]?: Partial<TagTermApi[K]>
}

/**
 * 渲染进程测试用的 window.tagterm 假实现：SDK 风格，每个函数独立 mock。
 * 传入 overrides 覆盖需要的函数，其余为带合理缺省返回值的 vi.fn()。
 */
export function installFakeApi(overrides: Overrides = {}): TagTermApi {
  const api = createFakeApi(overrides)
  Object.defineProperty(window, 'tagterm', { value: api, configurable: true, writable: true })
  return api
}

export function createFakeApi(overrides: Overrides = {}): TagTermApi {
  return {
    app: {
      getVersion: vi.fn(async () => '0.0.0-test'),
      getOsBuild: vi.fn(async () => 26200),
      listShells: vi.fn(async (): Promise<ShellKind[]> => ['cmd.exe', 'powershell.exe']),
      getDataDir: vi.fn(async () => 'C:/Users/test/AppData/Roaming/TagTerm'),
      pickImage: vi.fn(async () => null),
      onOpenSettings: vi.fn(() => () => {}),
      ...overrides.app,
    },
    settings: {
      get: vi.fn(async () => makeSettings()),
      update: vi.fn(async (patch) => ({ ...makeSettings(), ...patch }) as Settings),
      readBackgroundImage: vi.fn(async () => null),
      onChanged: vi.fn(() => () => {}),
      ...overrides.settings,
    },
    session: {
      list: vi.fn(async () => [] as Session[]),
      create: vi.fn(async (input) => makeSession({ cwd: input.cwd, name: input.name ?? 'new' })),
      update: vi.fn(async (id, patch) => makeSession({ id, ...patch })),
      remove: vi.fn(async () => {}),
      pickDirectory: vi.fn(async () => null),
      onChanged: vi.fn(() => () => {}),
      ...overrides.session,
    },
    update: {
      getStatus: vi.fn(async (): Promise<UpdateStatus> => ({ state: 'idle' })),
      check: vi.fn(async () => {}),
      download: vi.fn(async () => {}),
      install: vi.fn(async () => {}),
      onStatus: vi.fn(() => () => {}),
      ...overrides.update,
    },
    tag: {
      list: vi.fn(async (): Promise<TagListResult> => ({ tags: [], sessionTags: [] })),
      create: vi.fn(async (name, color) => makeTag(color ? { name, color } : { name })),
      update: vi.fn(async (id, patch) => makeTag({ id, ...patch })),
      remove: vi.fn(async () => {}),
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      onChanged: vi.fn(() => () => {}),
      ...overrides.tag,
    },
    pty: {
      open: vi.fn(async () => ({ created: true, pid: 4242 })),
      write: vi.fn(),
      resize: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      isAlive: vi.fn(async () => true),
      onData: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
      ...overrides.pty,
    },
  }
}

let seq = 0
/** 构造一条测试会话，字段可覆盖 */
export function makeSession(partial: Partial<Session> = {}): Session {
  seq += 1
  return {
    id: `s${seq}`,
    name: `session-${seq}`,
    cwd: `D:\\Projects\\p${seq}`,
    shell: 'cmd.exe',
    sortOrder: seq,
    createdAt: '2026-09-10T00:00:00.000Z',
    ...partial,
  }
}

let tagSeq = 0
/** 构造一个测试标签：颜色按八色表轮转，sortOrder 递增，字段可覆盖 */
export function makeTag(partial: Partial<Tag> = {}): Tag {
  tagSeq += 1
  return {
    id: `t${tagSeq}`,
    name: `tag-${tagSeq}`,
    color: TAG_COLORS[(tagSeq - 1) % TAG_COLORS.length]!,
    sortOrder: tagSeq,
    ...partial,
  }
}

/** 构造一条唤起命令，字段可覆盖 */
export function makeCommand(partial: Partial<LaunchCommand> & { command: string }): LaunchCommand {
  return {
    id: `c-${partial.command}`,
    label: partial.command,
    pinned: true,
    sortOrder: 0,
    ...partial,
  }
}

/** 缺省设置：claude / gemini / pi 平铺，背景纯色 */
export function makeSettings(partial: Partial<Settings> = {}): Settings {
  return {
    launchCommands: [
      makeCommand({ command: 'claude', sortOrder: 1 }),
      makeCommand({ command: 'gemini', sortOrder: 2 }),
      makeCommand({ command: 'pi', sortOrder: 3 }),
    ],
    terminalBackground: { imagePath: null, dimOpacity: 0.6 },
    ...partial,
  }
}

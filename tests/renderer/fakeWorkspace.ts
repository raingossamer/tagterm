/**
 * 组件测试一行装配：真 TerminalWorkspace + 假端口（FakePty / FakeTerminal / 同步 raf）+ 已 attachCore 的 workspace store。
 * 传入会话列表则同时写入 sessions store。核心未接管容器（需要时由 TerminalPane 或测试自己 attach）。
 */
import type { Session } from '@shared/models'
import { useSessionsStore } from '../../src/renderer/src/stores/sessions'
import { useWorkspaceStore } from '../../src/renderer/src/stores/workspace'
import { TerminalWorkspace } from '../../src/renderer/src/terminal/TerminalWorkspace'
import { FakePty } from './fakePty'
import { FakeTerminal } from './fakeTerminal'

export interface FakeWorkspace {
  core: TerminalWorkspace
  pty: FakePty
  /** 按创建顺序记录的假终端（重启后同一会话会有多个） */
  terminals: FakeTerminal[]
  workspace: ReturnType<typeof useWorkspaceStore>
}

export function installFakeWorkspace(sessions?: Session[]): FakeWorkspace {
  if (sessions) useSessionsStore().sessions = sessions
  const pty = new FakePty()
  const terminals: FakeTerminal[] = []
  const core = new TerminalWorkspace({
    pty,
    createTerminal: () => {
      const t = new FakeTerminal()
      terminals.push(t)
      return t
    },
    raf: (fn) => fn(),
  })
  const workspace = useWorkspaceStore()
  workspace.attachCore(core)
  return { core, pty, terminals, workspace }
}

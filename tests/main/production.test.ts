import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hookHomeOf } from '../../src/main/agent/production'

describe('production（AgentSubsystem 的生产装配）', () => {
  it('hooks 目标的主目录：正常运行是用户主目录；烟测隔离到数据目录下的 fake-home，绝不指向真实的 ~/.claude / ~/.codex', () => {
    const dataDir = 'C:\\Users\\x\\AppData\\Local\\Temp\\tagterm-smoke'
    expect(hookHomeOf('C:\\Users\\x\\AppData\\Roaming\\tagterm', false)).toBe(homedir())

    const smokeHome = hookHomeOf(dataDir, true)
    expect(smokeHome).toBe(join(dataDir, 'fake-home'))
    expect(smokeHome.startsWith(dataDir)).toBe(true)
    expect(smokeHome).not.toBe(homedir())
    // 隔离的意义：start() 的端口同步只会改写这棵假主目录里的文件
    expect(join(smokeHome, '.claude', 'settings.json')).not.toBe(
      join(homedir(), '.claude', 'settings.json'),
    )
  })
})

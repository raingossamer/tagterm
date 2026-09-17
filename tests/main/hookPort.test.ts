import { describe, expect, it } from 'vitest'
import { derivePort, HOOK_PORT_MAX, HOOK_PORT_MIN } from '../../src/main/agent/hookPort'

describe('derivePort（数据目录路径 → 稳定端口）', () => {
  it('同一路径每次相同、不同路径大概率不同，且落在 49152–65535', () => {
    const a = derivePort('C:/Users/k/AppData/Roaming/TagTerm')
    expect(derivePort('C:/Users/k/AppData/Roaming/TagTerm')).toBe(a)
    expect(a).toBeGreaterThanOrEqual(HOOK_PORT_MIN)
    expect(a).toBeLessThanOrEqual(HOOK_PORT_MAX)
    expect(HOOK_PORT_MIN).toBe(49152)
    expect(HOOK_PORT_MAX).toBe(65535)

    const others = ['D:/x', 'C:/Users/other/AppData/Roaming/TagTerm', '%TEMP%/tagterm-smoke'].map(
      derivePort,
    )
    for (const p of others) {
      expect(p).toBeGreaterThanOrEqual(HOOK_PORT_MIN)
      expect(p).toBeLessThanOrEqual(HOOK_PORT_MAX)
    }
    expect(new Set([a, ...others]).size).toBeGreaterThan(1)
  })
})

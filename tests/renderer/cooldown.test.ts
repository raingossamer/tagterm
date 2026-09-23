import { describe, expect, it } from 'vitest'
import { createCooldown } from '../../src/renderer/src/composables/cooldown'

describe('createCooldown（打开外部窗口的控件防双击）', () => {
  it('距上次生效的点击不足冷却时间的点击被忽略，被忽略的点击不重置冷却；满冷却时间后再放行', () => {
    let now = 1000
    const canFire = createCooldown(500, () => now)
    expect(canFire()).toBe(true)
    now += 300
    expect(canFire()).toBe(false)
    now += 199 // 距第一次 499 ms：仍在冷却；被忽略的那次（第 300 ms）没有重置起点
    expect(canFire()).toBe(false)
    now += 1
    expect(canFire()).toBe(true)
  })
})

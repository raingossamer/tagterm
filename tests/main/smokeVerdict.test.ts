import { describe, expect, it } from 'vitest'
import { MUST_BE_FALSE, NOT_JUDGED, judgeSmoke } from '../../src/main/smokeVerdict'

/** 一份「全部通过」的最小烟测结果：必须为假的反例都在且为假，其余核查为真 */
function passing(): Record<string, unknown> {
  return {
    hasProcess: false,
    hasRequire: false,
    hasApi: true,
    version: '0.3.6',
    edit: { menuShown: true, s2AliveAfterRemove: false },
    tags: {
      gotTagged: true,
      untaggedWhenAHidden: false,
      searchFindsHidden: false,
      popOptions: [
        ['A', true],
        ['B', false],
      ],
    },
    search: { focusedAfterCtrlK: 'search-input', outputGrew: false },
    settings: { autoLaunch: { shown: true, checked: false, blocked: false }, download: null },
    hooks: { claudeBlocked: true, viewDiag: { hasFocus: false, hidden: false } },
    remaining: 0,
    consoleErrors: [],
  }
}

describe('judgeSmoke（烟测结论：发布流水线只认它）', () => {
  it('全部核查为真、反例为假、控制台无报错、会话清理干净 → 通过；数字 / 字符串 / null 这类数据不判', () => {
    expect(judgeSmoke(passing())).toEqual({ ok: true, failures: [] })
  })

  it('任一布尔核查为假 → 失败，失败项写出键路径（数组下标也是一段）', () => {
    const r = passing()
    ;(r['tags'] as Record<string, unknown>)['gotTagged'] = false
    ;(r['hooks'] as Record<string, unknown>)['claudeBlocked'] = false
    const verdict = judgeSmoke(r)
    expect(verdict.ok).toBe(false)
    expect(verdict.failures).toEqual(['tags.gotTagged', 'hooks.claudeBlocked'])
  })

  it('「必须为假」的反例变成真 → 失败并写明是哪条反例；缺了这个字段也算失败（反例不能悄悄消失）', () => {
    const leaked = passing()
    leaked['hasProcess'] = true
    expect(judgeSmoke(leaked).failures).toEqual(['hasProcess 应为假'])

    const missing = passing()
    delete (missing['search'] as Record<string, unknown>)['outputGrew']
    expect(judgeSmoke(missing).failures).toEqual(['search.outputGrew 缺失'])
  })

  it('「不判」清单下的整棵子树都跳过：登录项状态、焦点诊断、弹出层勾选数据取什么值都不影响结论', () => {
    const r = passing()
    ;(r['settings'] as { autoLaunch: Record<string, unknown> }).autoLaunch['checked'] = true
    ;(r['hooks'] as { viewDiag: Record<string, unknown> }).viewDiag['hasFocus'] = true
    ;(r['tags'] as Record<string, unknown>)['popOptions'] = [['A', false]]
    expect(judgeSmoke(r)).toEqual({ ok: true, failures: [] })
  })

  it('有 error 字段、控制台有报错、烟测会话没清理干净或结论字段缺失 → 失败', () => {
    const errored = passing()
    errored['error'] = 'Error: 渲染进程烟测脚本 超时 60000ms'
    expect(judgeSmoke(errored).failures).toEqual(['error: Error: 渲染进程烟测脚本 超时 60000ms'])

    const noisy = passing()
    noisy['consoleErrors'] = ['Uncaught TypeError: x is undefined']
    expect(judgeSmoke(noisy).failures).toEqual(['consoleErrors: 1 条'])

    const leftover = passing()
    leftover['remaining'] = 2
    expect(judgeSmoke(leftover).failures).toEqual(['remaining: 2'])

    const bare = passing()
    delete bare['remaining']
    delete bare['consoleErrors']
    expect(judgeSmoke(bare).failures).toEqual(['remaining: 缺失', 'consoleErrors: 缺失'])
  })

  it('核查找不到元素时会给出 null：null 视为没拿到结果，算失败；「不判」清单里的 null（如没有新版本时的下载结果）不算', () => {
    const r = passing()
    ;(r['tags'] as Record<string, unknown>)['nameAlignedTagged'] = null
    expect(judgeSmoke(r).failures).toEqual(['tags.nameAlignedTagged 为 null'])
    expect(Object.keys(NOT_JUDGED)).toContain('settings.download')
  })

  it('某一段烟测出错时整段换成 { error }：任意层级的 error 字段都算失败（否则那段的核查全消失、反而「通过」）', () => {
    const r = passing()
    r['heuristic'] = { error: 'Error: 真实链路超时' }
    expect(judgeSmoke(r).failures).toEqual(['heuristic.error: Error: 真实链路超时'])
  })

  it('不是对象（烟测根本没产出结果）→ 失败', () => {
    expect(judgeSmoke(null)).toEqual({ ok: false, failures: ['结果不是对象'] })
  })

  it('两张清单每条都写了理由，且互不重叠', () => {
    for (const reason of [...Object.values(MUST_BE_FALSE), ...Object.values(NOT_JUDGED)]) {
      expect(reason.length).toBeGreaterThan(4)
    }
    for (const path of Object.keys(MUST_BE_FALSE)) {
      expect(Object.keys(NOT_JUDGED).some((p) => path === p || path.startsWith(`${p}.`))).toBe(
        false,
      )
    }
  })
})

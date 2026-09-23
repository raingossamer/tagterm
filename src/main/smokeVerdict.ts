/**
 * 纯函数：把烟测结果判成「通过 / 失败项清单」。发布流水线只认这个结论（reliability-hardening 决策 2），
 * 本机跑烟测也看它，不再靠肉眼翻几百个字段。不 import electron。
 *
 * 规则：任何层级都没有非空的 error 字段（某段烟测出错时整段会换成 { error }，那段的核查随之消失，不能因此「通过」）；
 *   remaining（烟测会话清理后剩下的会话数）为 0；consoleErrors 为空；所有布尔核查为真。
 * 两张例外清单，每条写明理由：
 *   MUST_BE_FALSE —— 真正的反例，变成真就是事故，所以反过来要求为假，且字段必须在（反例不能悄悄消失）；
 *   NOT_JUDGED    —— 环境 / 诊断数据，取什么值取决于在哪台机器上跑，整棵子树都不判。
 * 数字、字符串这类数据不判；要进门槛的数据先在烟测里改写成布尔核查。null 算失败：核查找不到元素时会给出 null（`?? null`），
 * 跳过它就等于那条核查悄悄消失；本来就可能为 null 的数据列进 NOT_JUDGED。
 * 路径用 '.' 分隔键（数组下标也是一段）；NOT_JUDGED 前缀匹配即覆盖其下全部叶子。
 */

export const MUST_BE_FALSE: Readonly<Record<string, string>> = {
  hasProcess: '渲染进程拿不到 Node 的 process（安全基线：contextIsolation + sandbox）',
  hasRequire: '渲染进程拿不到 require（安全基线）',
  'edit.s2AliveAfterRemove': '右键「移除会话」后它的终端进程已被结束',
  'tags.untaggedWhenAHidden': '隐藏标签 A 时，只挂 A 的会话随组收起，不会掉进「未打标签」组',
  'tags.searchFindsHidden': '被隐藏的会话，左栏搜索同样搜不到',
  'search.outputGrew': '终端里按 Ctrl+K 被搜索框接走，一个字也没有进 shell',
}

export const NOT_JUDGED: Readonly<Record<string, string>> = {
  'settings.autoLaunch.checked': '登录项当前是否开启，取决于这台机器设没设开机自启',
  'settings.autoLaunch.blocked': '登录项是否被系统禁用，同上',
  'hooks.viewDiag': '「正被查看」的焦点诊断数据，只在失败时帮助排查',
  'tags.popOptions': '「+ 标签」弹出层的选项与勾选数据；勾选对不对由 tags.popChecksRight 核查',
  'settings.download': '只有更新源上真有新版本时才会去下载，平时为 null',
}

export interface SmokeVerdict {
  ok: boolean
  failures: string[]
}

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 按路径取值；路径上任何一段不存在即 found 为假 */
function lookup(root: unknown, path: string): { found: boolean; value: unknown } {
  let current: unknown = root
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined }
      }
      current = current[index]
    } else if (isObject(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment]
    } else {
      return { found: false, value: undefined }
    }
  }
  return { found: true, value: current }
}

export function judgeSmoke(result: unknown): SmokeVerdict {
  if (!isObject(result)) return { ok: false, failures: ['结果不是对象'] }
  const failures: string[] = []

  const remaining = result['remaining']
  if (remaining === undefined) failures.push('remaining: 缺失')
  else if (remaining !== 0) failures.push(`remaining: ${String(remaining)}`)
  const consoleErrors = result['consoleErrors']
  if (!Array.isArray(consoleErrors)) failures.push('consoleErrors: 缺失')
  else if (consoleErrors.length > 0) failures.push(`consoleErrors: ${consoleErrors.length} 条`)

  const mustBeFalse = Object.keys(MUST_BE_FALSE)
  for (const path of mustBeFalse) {
    const { found, value } = lookup(result, path)
    if (!found) failures.push(`${path} 缺失`)
    else if (value !== false) failures.push(`${path} 应为假`)
  }

  const notJudged = Object.keys(NOT_JUDGED)
  const isSkipped = (path: string): boolean =>
    mustBeFalse.includes(path) || notJudged.some((p) => path === p || path.startsWith(`${p}.`))
  const walk = (value: unknown, path: string): void => {
    if (path && isSkipped(path)) return
    if ((path === 'error' || path.endsWith('.error')) && value !== null && value !== undefined) {
      failures.push(`${path}: ${String(value)}`)
      return
    }
    if (value === null) {
      failures.push(`${path} 为 null`)
      return
    }
    if (typeof value === 'boolean') {
      if (!value) failures.push(path)
      return
    }
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, path ? `${path}.${i}` : `${i}`))
    else if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key)
    }
  }
  walk(result, '')

  return { ok: failures.length === 0, failures }
}
